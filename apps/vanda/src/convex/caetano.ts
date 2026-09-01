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
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireUser } from "./authz";
import { caetano, caetanoSystemPrompt } from "./caetanoAgent";
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
    return {
      threadId,
      processing: activity.some(
        (row) => row.threadId === threadId && row.startedAt >= Date.now() - 15 * 60_000,
      ),
      activeAccountId: user.activeAccountId ?? null,
    };
  },
});

const submitMessage = async (
  ctx: MutationCtx,
  user: Doc<"users">,
  input: { readonly threadId?: string | undefined; readonly prompt: string },
): Promise<{ threadId: string; messageId: string }> => {
  if (!(await budgetOf(ctx, user)).ok) throw new Error(USAGE_LIMIT_MESSAGE);
  const text = input.prompt.trim();
  if (!text) throw new Error("mensagem vazia");

  const activity = await ctx.db
    .query("caetanoThreadActivity")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  const staleBefore = Date.now() - 15 * 60_000;
  await Promise.all(
    activity.filter((row) => row.startedAt < staleBefore).map((row) => ctx.db.delete(row._id)),
  );
  if (activity.some((row) => row.startedAt >= staleBefore)) {
    throw new Error("Caetano já está trabalhando — aguarde ou interrompa");
  }

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
    message: { role: "user", content: text },
  });
  const activityId = await ctx.db.insert("caetanoThreadActivity", {
    userId: user._id,
    threadId: target,
    promptMessageId: messageId,
    startedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.caetano.generateResponse, {
    userId: user._id,
    threadId: target,
    promptMessageId: messageId,
    activityId,
  });
  return { threadId: target, messageId };
};

export const sendMessage = mutation({
  args: { threadId: v.optional(v.string()), prompt: v.string() },
  handler: async (ctx, input): Promise<{ threadId: string; messageId: string }> =>
    submitMessage(ctx, await requireUser(ctx), input),
});

/** Channel-neutral ingress used by future clients after they resolve an external identity. */
export const submitMessageForUser = internalMutation({
  args: { userId: v.id("users"), threadId: v.optional(v.string()), prompt: v.string() },
  handler: async (ctx, { userId, ...input }): Promise<{ threadId: string; messageId: string }> => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("user not found");
    return submitMessage(ctx, user, input);
  },
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
      const result = await caetano.streamText(
        { ...ctx, ownerUserId: userId, caetanoThreadId: threadId },
        { threadId },
        { promptMessageId, system: caetanoSystemPrompt() },
        { saveStreamDeltas: true },
      );
      await result.consumeStream();
      return await result.text;
    } finally {
      await ctx.runMutation(internal.caetano.finishActivity, { activityId });
    }
  },
});

export const finishActivity = internalMutation({
  args: { activityId: v.id("caetanoThreadActivity") },
  handler: async (ctx, { activityId }): Promise<void> => {
    if (await ctx.db.get(activityId)) await ctx.db.delete(activityId);
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

export const stopGeneration = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }): Promise<void> => {
    const user = await requireUser(ctx);
    await requireCaetanoThread(ctx, user._id, threadId);
    const activity = await ctx.db
      .query("caetanoThreadActivity")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
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
      await ctx.db.delete(row._id);
    }
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
