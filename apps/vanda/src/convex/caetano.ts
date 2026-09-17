import {
  abortStream,
  createThread,
  getThreadMetadata,
  listStreams,
  listUIMessages,
  saveMessage,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { AGENT_MAX_OUTPUT_TOKENS } from "./agentModels";
import { requireOwnedAccount, requireUser } from "./authz";
import { caetano, caetanoSystemPrompt } from "./caetanoAgent";
import { resolveMessageImages } from "./messageImages";
import { budgetOf, USAGE_LIMIT_MESSAGE } from "./usage";

const threadKey = (userId: Id<"users">): string => `caetano:${userId}`;

const requireCaetanoThread = async (
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  threadId: string,
) => {
  const metadata = await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null);
  if (!metadata || metadata.userId !== threadKey(userId))
    throw new Error("conversa não encontrada");
  return metadata;
};

export const state = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    let threadId = user.caetanoThreadId ?? null;
    if (threadId) {
      const metadata = await getThreadMetadata(ctx, components.agent, { threadId }).catch(
        () => null,
      );
      if (!metadata || metadata.userId !== threadKey(user._id)) threadId = null;
    }
    const activity = await ctx.db
      .query("caetanoThreadActivity")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const queued = await ctx.db
      .query("caetanoInbox")
      .withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "queued"))
      .first();
    return {
      threadId,
      processing:
        !!queued ||
        activity.some(
          (row) => row.threadId === threadId && row.startedAt >= Date.now() - 15 * 60_000,
        ),
      activeAccountId: user.activeAccountId ?? null,
    };
  },
});

const submitMessage = async (
  ctx: MutationCtx,
  user: Doc<"users">,
  input: {
    readonly threadId?: string | undefined;
    readonly prompt: string;
    readonly connectionId?: Id<"whatsappConnections"> | undefined;
    readonly externalMessageId?: string | undefined;
    readonly images?: ReadonlyArray<{
      readonly imageId: Id<"images">;
      readonly url: string;
      readonly mimeType: string;
    }>;
  },
): Promise<{ threadId: string; messageId: string }> => {
  if (!(await budgetOf(ctx, user)).ok) throw new Error(USAGE_LIMIT_MESSAGE);
  const text = input.prompt.trim();
  const images = input.images ?? [];
  if (!text && images.length === 0) throw new Error("mensagem vazia");

  const queued = await ctx.db
    .query("caetanoInbox")
    .withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "queued"))
    .take(20);
  if (queued.length >= 20) throw new Error("Muitas mensagens na fila. Aguarde uma resposta.");

  let target = input.threadId ?? user.caetanoThreadId;
  if (target) {
    const metadata = await getThreadMetadata(ctx, components.agent, { threadId: target }).catch(
      () => null,
    );
    if (!metadata || metadata.userId !== threadKey(user._id)) {
      if (input.threadId) throw new Error("conversa não encontrada");
      target = undefined;
    }
  }
  if (!target) {
    target = await createThread(ctx, components.agent, { userId: threadKey(user._id) });
    await ctx.db.patch(user._id, { caetanoThreadId: target, updatedAt: Date.now() });
  }

  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId: target,
    message: {
      role: "user",
      content:
        images.length === 0
          ? text
          : [
              ...(text ? [{ type: "text" as const, text }] : []),
              ...images.map((image) => ({
                type: "image" as const,
                image: image.url,
                mediaType: image.mimeType,
              })),
            ],
    },
  });
  if (images.length > 0) {
    const attachedAt = Date.now();
    await Promise.all(
      images.map((image) => ctx.db.patch(image.imageId, { lastAttachedAt: attachedAt })),
    );
  }
  await ctx.db.insert("caetanoInbox", {
    userId: user._id,
    threadId: target,
    promptMessageId: messageId,
    channel: input.connectionId ? "whatsapp" : "web",
    status: "queued",
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    ...(input.externalMessageId ? { externalMessageId: input.externalMessageId } : {}),
  });
  await ctx.scheduler.runAfter(0, internal.caetano.startNext, { userId: user._id });
  return { threadId: target, messageId };
};

export const sendMessage = mutation({
  args: {
    threadId: v.optional(v.string()),
    prompt: v.string(),
    imageIds: v.optional(v.array(v.id("images"))),
  },
  handler: async (
    ctx,
    { imageIds, ...input },
  ): Promise<{ threadId: string; messageId: string }> => {
    const user = await requireUser(ctx);
    let images: Awaited<ReturnType<typeof resolveMessageImages>> = [];
    if (imageIds?.length) {
      if (!user.activeAccountId) throw new Error("nenhuma conta ativa");
      await requireOwnedAccount(ctx, user.activeAccountId);
      images = await resolveMessageImages(ctx, user.activeAccountId, imageIds);
    }
    return submitMessage(ctx, user, { ...input, images });
  },
});

/** Channel-neutral ingress used by future clients after they resolve an external identity. */
export const submitMessageForUser = internalMutation({
  args: {
    userId: v.id("users"),
    threadId: v.optional(v.string()),
    prompt: v.string(),
    connectionId: v.optional(v.id("whatsappConnections")),
    externalMessageId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, ...input }): Promise<{ threadId: string; messageId: string }> => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("user not found");
    return submitMessage(ctx, user, input);
  },
});

export const startNext = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const active = await ctx.db
      .query("caetanoThreadActivity")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (active) return;
    const next = await ctx.db
      .query("caetanoInbox")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "queued"))
      .first();
    if (!next) return;
    const activityId = await ctx.db.insert("caetanoThreadActivity", {
      userId,
      threadId: next.threadId,
      promptMessageId: next.promptMessageId,
      inboxId: next._id,
      startedAt: Date.now(),
    });
    await ctx.db.patch(next._id, { status: "running" });
    await ctx.scheduler.runAfter(0, internal.caetano.generateResponse, {
      userId,
      threadId: next.threadId,
      promptMessageId: next.promptMessageId,
      activityId,
    });
    await ctx.scheduler.runAfter(15 * 60_000, internal.caetano.expireTurn, { activityId });
  },
});

export const expireTurn = internalMutation({
  args: { activityId: v.id("caetanoThreadActivity") },
  handler: async (ctx, { activityId }) => {
    const activity = await ctx.db.get(activityId);
    if (activity) await stopForUser(ctx, activity.userId, activity.threadId);
  },
});

export const turnIsActive = internalQuery({
  args: { activityId: v.id("caetanoThreadActivity") },
  handler: async (ctx, { activityId }) => {
    const activity = await ctx.db.get(activityId);
    if (!activity) return null;
    const inbox = activity.inboxId ? await ctx.db.get(activity.inboxId) : null;
    return { channel: inbox?.channel ?? "web" };
  },
});

const deliverForActivity = async (
  ctx: MutationCtx,
  activityId: Id<"caetanoThreadActivity">,
  text: string,
) => {
  const activity = await ctx.db.get(activityId);
  const inbox = activity?.inboxId ? await ctx.db.get(activity.inboxId) : null;
  if (inbox?.connectionId && inbox.status === "running" && text.trim()) {
    const manifest = await ctx.runQuery(internal.threadResources.forPrompt, {
      threadId: inbox.threadId,
      anchorMessageId: inbox.promptMessageId,
    });
    // Explicit channel URL prevents a sandbox response linking to production data.
    const baseUrl = (process.env.KAPSO_APP_URL ?? "").replace(/\/+$/, "");
    const links = manifest.presented
      .filter((resource) => resource.kind === "link" && /^https?:\/\//.test(resource.url))
      .map((resource) => (resource.kind === "link" ? `${resource.title}: ${resource.url}` : ""));
    if (manifest.presented.some((resource) => resource.kind !== "link") && baseUrl)
      links.push(`Ver resultados no Vanda Studio: ${baseUrl}/caetano`);
    await ctx.runMutation(internal.whatsappData.enqueueReply, {
      connectionId: inbox.connectionId,
      text: [text, ...links].join("\n\n"),
      sourceMessageId: inbox.promptMessageId,
    });
  }
};

export const deliverTurn = internalMutation({
  args: { activityId: v.id("caetanoThreadActivity"), text: v.string() },
  handler: async (ctx, { activityId, text }) => deliverForActivity(ctx, activityId, text),
});

export const generateResponse = internalAction({
  args: {
    userId: v.id("users"),
    threadId: v.string(),
    promptMessageId: v.string(),
    activityId: v.id("caetanoThreadActivity"),
  },
  handler: async (ctx, { userId, threadId, promptMessageId, activityId }): Promise<string> => {
    try {
      const turn = await ctx.runQuery(internal.caetano.turnIsActive, { activityId });
      if (!turn) return "";
      if (!(await ctx.runQuery(internal.usage.budget, { userId })).ok)
        throw new Error(USAGE_LIMIT_MESSAGE);
      const result = await caetano.streamText(
        { ...ctx, ownerUserId: userId, caetanoThreadId: threadId },
        { threadId },
        {
          promptMessageId,
          system:
            caetanoSystemPrompt() +
            (turn.channel === "whatsapp"
              ? "\n\nEste turno veio do WhatsApp, que neste sandbox aceita somente texto. Não diga que imagens ou arquivos foram anexados aqui. Recursos apresentados ficam disponíveis na conversa web; links de acesso serão incluídos pelo sistema quando disponíveis. Responda de forma curta, sem tabelas Markdown."
              : ""),
          maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
        },
        { saveStreamDeltas: true },
      );
      await result.consumeStream();
      const text = await result.text;
      await ctx.runMutation(internal.caetano.deliverTurn, { activityId, text });
      return text;
    } catch (error) {
      console.error("Caetano generation failed", error);
      const recorded = await ctx.runMutation(internal.caetano.recordGenerationFailure, {
        userId,
        threadId,
        activityId,
      });
      return recorded ? GENERATION_FAILURE_MESSAGE : "";
    } finally {
      await ctx.runMutation(internal.caetano.finishActivity, { activityId });
    }
  },
});

const GENERATION_FAILURE_MESSAGE =
  "Não consegui concluir esta resposta por uma falha temporária. Seu pedido foi salvo. Tente novamente.";

export const recordGenerationFailure = internalMutation({
  args: {
    userId: v.id("users"),
    threadId: v.string(),
    activityId: v.id("caetanoThreadActivity"),
  },
  handler: async (ctx, { userId, threadId, activityId }): Promise<boolean> => {
    const activity = await ctx.db.get(activityId);
    if (!activity || activity.userId !== userId || activity.threadId !== threadId) return false;
    const metadata = await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null);
    if (!metadata || metadata.userId !== threadKey(userId)) return false;
    await saveMessage(ctx, components.agent, {
      threadId,
      agentName: "caetano",
      message: { role: "assistant", content: GENERATION_FAILURE_MESSAGE },
    });
    await deliverForActivity(ctx, activityId, GENERATION_FAILURE_MESSAGE);
    await ctx.runMutation(internal.caetano.finishActivity, { activityId });
    return true;
  },
});

export const finishActivity = internalMutation({
  args: { activityId: v.id("caetanoThreadActivity") },
  handler: async (ctx, { activityId }): Promise<void> => {
    const activity = await ctx.db.get(activityId);
    if (!activity) return;
    if (activity.inboxId) await ctx.db.patch(activity.inboxId, { status: "done" });
    await ctx.db.delete(activityId);
    await ctx.scheduler.runAfter(0, internal.caetano.startNext, { userId: activity.userId });
  },
});

const abortThread = async (ctx: MutationCtx, threadId: string, reason: string): Promise<void> => {
  const streams = await listStreams(ctx, components.agent, { threadId });
  await Promise.all(
    streams
      .filter((stream) => stream.status === "streaming")
      .map((stream) => abortStream(ctx, components.agent, { streamId: stream.streamId, reason })),
  );
  const latestOrder = streams.reduce((max, stream) => Math.max(max, stream.order), -1);
  if (latestOrder >= 0) {
    await abortStream(ctx, components.agent, { threadId, order: latestOrder, reason });
  }
};

const stopForUser = async (ctx: MutationCtx, userId: Id<"users">, threadId: string) => {
  await requireCaetanoThread(ctx, userId, threadId);
  const activity = await ctx.db
    .query("caetanoThreadActivity")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const relevant = activity.filter((row) => row.threadId === threadId);
  await abortThread(ctx, threadId, "interrompido pelo dono");
  for (const row of relevant) {
    if (row.activeVandaThreadId) {
      await abortThread(ctx, row.activeVandaThreadId, "interrompido pelo dono");
      const vandaActivity = await ctx.db
        .query("chatThreadActivity")
        .withIndex("by_thread", (q) => q.eq("threadId", row.activeVandaThreadId!))
        .collect();
      await Promise.all(vandaActivity.map((item) => ctx.db.delete(item._id)));
    }
    if (row.inboxId) await ctx.db.patch(row.inboxId, { status: "stopped" });
    await ctx.db.delete(row._id);
  }
  const queued = await ctx.db
    .query("caetanoInbox")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "queued"))
    .collect();
  for (const row of queued) await ctx.db.patch(row._id, { status: "stopped" });
};

export const stopGeneration = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => stopForUser(ctx, (await requireUser(ctx))._id, threadId),
});

export const stopForOwner = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user?.caetanoThreadId) await stopForUser(ctx, userId, user.caetanoThreadId);
  },
});

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(vStreamArgs),
  },
  handler: async (ctx, { threadId, paginationOpts, streamArgs }) => {
    const user = await requireUser(ctx);
    await requireCaetanoThread(ctx, user._id, threadId);
    const paginated = await listUIMessages(ctx, components.agent, { threadId, paginationOpts });
    const streams = await syncStreams(ctx, components.agent, { threadId, streamArgs });
    return { ...paginated, streams };
  },
});
