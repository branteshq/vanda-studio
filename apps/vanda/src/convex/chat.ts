import {
  abortStream,
  createThread,
  getThreadMetadata,
  listStreams,
  listUIMessages,
  saveMessage,
  syncStreams,
  updateThreadMetadata,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { AGENT_MAX_OUTPUT_TOKENS, resolveOrchestratorModel } from "./agentModels";
import { requireOwnedAccount } from "./authz";
import { codexChatModel, codexResponsesText } from "./pipeline/codex";
import { budgetOf, USAGE_LIMIT_MESSAGE } from "./usage";
import { openrouterChatModel, systemPrompt, vanda, VANDA_MODEL } from "./vanda";

/**
 * The account's Vanda conversations. Multi-thread: the agent component owns
 * threads and messages; we key its opaque `userId` by the *account* id (not the
 * owner user), so listing/search/archival all come from component primitives
 * while authz stays entirely ours. Durable domain tables remain the truth
 * underneath the conversation.
 */

/** The component keys threads by an opaque string; ours is the account id. */
const threadKey = (accountId: Id<"accounts">): string => String(accountId);

/**
 * Validate that a thread belongs to the account (the caller must already have
 * gated the account itself with requireOwnedAccount). A missing thread and
 * someone else's thread collapse into the same error, so existence is never
 * revealed across accounts.
 */
async function requireAccountThread(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
  threadId: string,
) {
  const meta = await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null);
  if (!meta || meta.userId !== threadKey(accountId)) throw new Error("thread not found");
  return meta;
}

async function resolveMessageImages(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  imageIds: ReadonlyArray<Id<"images">>,
) {
  const uniqueIds = [...new Set(imageIds)];
  if (uniqueIds.length > 4) throw new Error("too many image attachments");
  return Promise.all(
    uniqueIds.map(async (imageId) => {
      const image = await ctx.db.get(imageId);
      if (!image || image.accountId !== accountId) throw new Error("image not found");
      if (image.mimeType && !image.mimeType.startsWith("image/")) {
        throw new Error("only image attachments are supported");
      }
      const url =
        image.externalUrl ?? (image.storageId ? await ctx.storage.getUrl(image.storageId) : null);
      if (!url) throw new Error("image URL is unavailable");
      return { imageId: image._id, url, mimeType: image.mimeType ?? "image/jpeg" };
    }),
  );
}

async function startThreadActivity(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  threadId: string,
  promptMessageId: string,
): Promise<Id<"chatThreadActivity">> {
  return ctx.db.insert("chatThreadActivity", {
    accountId,
    threadId,
    promptMessageId,
    startedAt: Date.now(),
  });
}

export interface ThreadSummary {
  threadId: string;
  title: string | null;
  createdAt: number;
  processing: boolean;
}

/** The account's active conversations, newest first (component creation order). */
export const listThreads = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<ThreadSummary[]> => {
    await requireOwnedAccount(ctx, accountId);
    const [threads, activity] = await Promise.all([
      ctx.runQuery(components.agent.threads.listThreadsByUserId, {
        userId: threadKey(accountId),
        order: "desc",
        paginationOpts: { cursor: null, numItems: 100 },
      }),
      ctx.db
        .query("chatThreadActivity")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect(),
    ]);
    const processing = new Set(activity.map((row) => row.threadId));
    return threads.page
      .filter((thread) => thread.status === "active")
      .map((thread) => ({
        threadId: thread._id,
        title: thread.title ?? null,
        createdAt: thread._creationTime,
        processing: processing.has(thread._id),
      }));
  },
});

export const renameThread = mutation({
  args: { accountId: v.id("accounts"), threadId: v.string(), title: v.string() },
  handler: async (ctx, { accountId, threadId, title }): Promise<void> => {
    await requireOwnedAccount(ctx, accountId);
    await requireAccountThread(ctx, accountId, threadId);
    const trimmed = title.trim();
    if (!trimmed) throw new Error("título vazio");
    await updateThreadMetadata(ctx, components.agent, {
      threadId,
      patch: { title: trimmed.slice(0, 80) },
    });
  },
});

/** Archive, not delete: history stays recoverable and background notes skip it. */
export const archiveThread = mutation({
  args: { accountId: v.id("accounts"), threadId: v.string() },
  handler: async (ctx, { accountId, threadId }): Promise<void> => {
    await requireOwnedAccount(ctx, accountId);
    await requireAccountThread(ctx, accountId, threadId);
    await updateThreadMetadata(ctx, components.agent, {
      threadId,
      patch: { status: "archived" },
    });
  },
});

/**
 * Saves a user message and schedules Vanda's turn. When `threadId` is absent this
 * is the first message of a fresh conversation: the thread is created here, so
 * "Nova conversa" is pure client navigation and empty threads never hit the DB.
 */
export const sendMessage = mutation({
  args: {
    accountId: v.id("accounts"),
    threadId: v.optional(v.string()),
    prompt: v.string(),
    imageIds: v.optional(v.array(v.id("images"))),
  },
  handler: async (
    ctx,
    { accountId, threadId, prompt, imageIds },
  ): Promise<{ threadId: string; messageId: string }> => {
    const account = await requireOwnedAccount(ctx, accountId);
    // The budget gate lives before any model work is scheduled: over the
    // limit, nothing is generated (a generated apology would itself cost).
    if (account.ownerUserId) {
      const owner = await ctx.db.get(account.ownerUserId);
      if (owner && !(await budgetOf(ctx, owner)).ok) {
        throw new Error(USAGE_LIMIT_MESSAGE);
      }
    }
    const trimmed = prompt.trim();
    const images = await resolveMessageImages(ctx, accountId, imageIds ?? []);
    if (!trimmed && images.length === 0) throw new Error("mensagem vazia");

    let title: string | null = null;
    let target = threadId;
    if (target === undefined) {
      target = await createThread(ctx, components.agent, { userId: threadKey(accountId) });
    } else {
      title = (await requireAccountThread(ctx, accountId, target)).title ?? null;
    }

    const attachmentContext =
      images.length > 0
        ? `<vanda_attachment_context>Imagens anexadas pelo usuário, já pertencentes a esta conta: ${images
            .map((image) => `imageId=${image.imageId}`)
            .join(
              ", ",
            )}. Você pode referenciá-las em ferramentas usando esses IDs; para editar uma, passe o ID em editOfImageId.</vanda_attachment_context>`
        : "";
    const modelText = [trimmed, attachmentContext].filter(Boolean).join("\n\n");
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: target,
      message: {
        role: "user",
        content: [
          { type: "text", text: modelText },
          ...images.map((image) => ({
            type: "image" as const,
            image: image.url,
            mediaType: image.mimeType,
          })),
        ],
      },
    });
    const attachedAt = Date.now();
    await Promise.all(
      images.map((image) => ctx.db.patch(image.imageId, { lastAttachedAt: attachedAt })),
    );
    // The titling model names the conversation from its first message; until
    // the title lands, the sidebar shows a placeholder (title === null).
    if (!title) {
      await ctx.scheduler.runAfter(0, internal.chat.generateTitle, {
        accountId,
        threadId: target,
        prompt: trimmed || "Imagem anexada",
      });
    }
    const activityId = await startThreadActivity(ctx, accountId, target, messageId);
    await ctx.scheduler.runAfter(0, internal.chat.generateResponse, {
      accountId,
      threadId: target,
      promptMessageId: messageId,
      activityId,
    });
    return { threadId: target, messageId };
  },
});

/** The titling model — fast and cheap; never blocks the conversation itself. */
const VANDA_TITLE_MODEL = "openai/gpt-5.6-luna";

/**
 * Name a fresh thread from its first message. Falls back to the truncated
 * message on any failure — a thread never stays untitled — and never clobbers
 * a title the owner set while the model was thinking.
 */
export const generateTitle = internalAction({
  args: {
    // Optional keeps already-scheduled titles from older deployments compatible.
    accountId: v.optional(v.id("accounts")),
    threadId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, { accountId, threadId, prompt }): Promise<void> => {
    const fallback = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
    const system =
      "Você nomeia conversas de um estúdio de marketing para Instagram. Responda APENAS " +
      "com um título curto (3 a 6 palavras) em português do Brasil que resuma o pedido " +
      "do usuário. Sem aspas, sem ponto final, sem emojis, sem explicações.";
    let title = fallback;
    try {
      const sub = accountId
        ? await ctx.runQuery(internal.openaiSub.subscriberState, { accountId })
        : { active: false as const, userId: null };
      let raw: string;
      if (sub.active && sub.userId) {
        // Conectado plan: luna through the owner's ChatGPT subscription.
        const auth = await ctx.runAction(internal.openaiSubNode.getAccess, {
          userId: sub.userId,
        });
        raw = await codexResponsesText({
          auth,
          model: VANDA_TITLE_MODEL,
          system,
          prompt: prompt.slice(0, 2000),
        });
      } else {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: VANDA_TITLE_MODEL,
            usage: { include: true },
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt.slice(0, 2000) },
            ],
            max_tokens: 100,
          }),
        });
        if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
        const json = (await response.json()) as {
          choices?: ReadonlyArray<{ message?: { content?: string } }>;
          usage?: { cost?: number };
        };
        if (accountId && typeof json.usage?.cost === "number" && json.usage.cost > 0) {
          await ctx.runMutation(internal.usage.charge, {
            accountId,
            kind: "title",
            usd: json.usage.cost,
            ref: VANDA_TITLE_MODEL,
          });
        }
        raw = json.choices?.[0]?.message?.content ?? "";
      }
      const cleaned = raw
        .trim()
        .replace(/^["'“”]+|["'“”]+$/g, "")
        .replace(/\.+$/, "")
        .trim();
      if (cleaned) title = cleaned.slice(0, 80);
    } catch {
      // fallback title stands
    }
    const meta = await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null);
    if (!meta || meta.title) return;
    await updateThreadMetadata(ctx, components.agent, { threadId, patch: { title } });
  },
});

/** One asynchronous Vanda turn: context assembly, tool loop, streamed reply. */
export const generateResponse = internalAction({
  args: {
    accountId: v.id("accounts"),
    threadId: v.string(),
    promptMessageId: v.string(),
    // Optional keeps already-scheduled turns from older deployments compatible.
    activityId: v.optional(v.id("chatThreadActivity")),
    // Delegated turns return durable async outcomes to Caetano as well.
    caetanoThreadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { accountId, threadId, promptMessageId, activityId, caetanoThreadId },
  ): Promise<string> => {
    try {
      // Which model thinks as Vanda this turn: the owner's pick, resolved
      // against the transport (Conectado can only carry OpenAI models).
      const sub = await ctx.runQuery(internal.openaiSub.subscriberState, { accountId });
      const preferred = await ctx.runQuery(internal.users.orchestratorModelForAccount, {
        accountId,
      });
      const modelId = resolveOrchestratorModel(preferred, { conectado: sub.active });
      const model =
        sub.active && sub.userId
          ? // Conectado plan: the chosen model, billed to the owner's ChatGPT
            // subscription instead of OpenRouter.
            codexChatModel(
              await ctx.runAction(internal.openaiSubNode.getAccess, { userId: sub.userId }),
              modelId,
            )
          : modelId === VANDA_MODEL
            ? undefined // the agent's configured default — no override needed
            : openrouterChatModel(modelId);
      const result = await vanda.streamText(
        { ...ctx, accountId, ...(caetanoThreadId ? { caetanoThreadId } : {}) },
        { threadId },
        // The live-clock system prompt replaces the agent's static
        // instructions so relative dates ("amanhã às 8") resolve correctly.
        {
          promptMessageId,
          system: systemPrompt(),
          maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
          ...(model ? { model } : {}),
        },
        { saveStreamDeltas: true },
      );
      await result.consumeStream();
      return await result.text;
    } catch (error) {
      console.error("Vanda generation failed", error);
      const recorded = await ctx.runMutation(internal.chat.recordGenerationFailure, {
        accountId,
        threadId,
        ...(activityId ? { activityId } : {}),
      });
      return recorded ? GENERATION_FAILURE_MESSAGE : "";
    } finally {
      if (activityId) await ctx.runMutation(internal.chat.finishThreadActivity, { activityId });
    }
  },
});

const GENERATION_FAILURE_MESSAGE =
  "Não consegui concluir esta resposta por uma falha temporária. Seu pedido foi salvo. Tente novamente.";

export const recordGenerationFailure = internalMutation({
  args: {
    accountId: v.id("accounts"),
    threadId: v.string(),
    activityId: v.optional(v.id("chatThreadActivity")),
  },
  handler: async (ctx, { accountId, threadId, activityId }): Promise<boolean> => {
    if (activityId) {
      const activity = await ctx.db.get(activityId);
      if (!activity || activity.accountId !== accountId || activity.threadId !== threadId) {
        // The stop action deletes the activity before aborting the stream.
        return false;
      }
    }
    const metadata = await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null);
    if (!metadata || metadata.userId !== threadKey(accountId)) return false;
    await saveMessage(ctx, components.agent, {
      threadId,
      agentName: "vanda",
      message: { role: "assistant", content: GENERATION_FAILURE_MESSAGE },
    });
    if (activityId && (await ctx.db.get(activityId))) await ctx.db.delete(activityId);
    return true;
  },
});

export const finishThreadActivity = internalMutation({
  args: { activityId: v.id("chatThreadActivity") },
  handler: async (ctx, { activityId }): Promise<void> => {
    if (await ctx.db.get(activityId)) await ctx.db.delete(activityId);
  },
});

/**
 * Whether a Vanda turn is still running on this thread. The stop button (and
 * normal completion) deletes the activity row, so long-running tools poll this
 * to cancel cooperatively mid-flight.
 */
export const threadHasActivity = internalQuery({
  args: { accountId: v.id("accounts"), threadId: v.string() },
  handler: async (ctx, { accountId, threadId }): Promise<boolean> => {
    const rows = await ctx.db
      .query("chatThreadActivity")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    return rows.some((row) => row.threadId === threadId);
  },
});

/**
 * Stop the current Vanda turn. Aborting the live stream trips the abort signal
 * inside `streamText`, which unwinds `generateResponse`; aborting by order also
 * covers the turn's next step when the abort lands between streams (mid-tool).
 * The activity row is cleared here so the UI settles immediately.
 */
export const stopGeneration = mutation({
  args: { accountId: v.id("accounts"), threadId: v.string() },
  handler: async (ctx, { accountId, threadId }): Promise<void> => {
    await requireOwnedAccount(ctx, accountId);
    await requireAccountThread(ctx, accountId, threadId);

    const streams = await listStreams(ctx, components.agent, { threadId });
    const live = streams.filter((stream) => stream.status === "streaming");
    await Promise.all(
      live.map((stream) =>
        abortStream(ctx, components.agent, {
          streamId: stream.streamId,
          reason: "interrompido pelo dono",
        }),
      ),
    );
    const latestOrder = streams.reduce((max, stream) => Math.max(max, stream.order), -1);
    if (latestOrder >= 0) {
      await abortStream(ctx, components.agent, {
        threadId,
        order: latestOrder,
        reason: "interrompido pelo dono",
      });
    }

    const activity = await ctx.db
      .query("chatThreadActivity")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await Promise.all(
      activity.filter((row) => row.threadId === threadId).map((row) => ctx.db.delete(row._id)),
    );
  },
});

export const listMessages = query({
  args: {
    accountId: v.id("accounts"),
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(vStreamArgs),
  },
  handler: async (ctx, { accountId, threadId, paginationOpts, streamArgs }) => {
    await requireOwnedAccount(ctx, accountId);
    await requireAccountThread(ctx, accountId, threadId);
    const paginated = await listUIMessages(ctx, components.agent, { threadId, paginationOpts });
    const streams = await syncStreams(ctx, components.agent, { threadId, streamArgs });
    return { ...paginated, streams };
  },
});

/**
 * A deterministic assistant note posted into a conversation — how background
 * jobs report completion without an LLM call. Targets the thread that requested
 * the work; falls back to the account's most recent active conversation when
 * the originating thread is missing or archived.
 */
export const postAssistantNote = internalMutation({
  args: {
    accountId: v.id("accounts"),
    threadId: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (ctx, { accountId, threadId, text }): Promise<void> => {
    let target: string | null = threadId ?? null;
    if (target) {
      const meta = await getThreadMetadata(ctx, components.agent, { threadId: target }).catch(
        () => null,
      );
      if (!meta || meta.userId !== threadKey(accountId) || meta.status !== "active") target = null;
    }
    if (!target) {
      const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
        userId: threadKey(accountId),
        order: "desc",
        paginationOpts: { cursor: null, numItems: 20 },
      });
      target = threads.page.find((thread) => thread.status === "active")?._id ?? null;
    }
    if (!target) return;
    await saveMessage(ctx, components.agent, {
      threadId: target,
      agentName: "vanda",
      message: { role: "assistant", content: text },
    });
  },
});

/**
 * One-time migration to the multi-thread model: re-key each account's legacy
 * canonical thread from the owner user id to the account id so it appears in
 * listThreads. Idempotent. Run with: npx convex run chat:migrateThreadKeys
 */
export const migrateThreadKeys = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ migrated: number }> => {
    let migrated = 0;
    const accounts = await ctx.db.query("accounts").collect();
    for (const account of accounts) {
      const threadId = account.vandaThreadId;
      if (!threadId) continue;
      const meta = await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null);
      if (!meta || meta.userId === threadKey(account._id)) continue;
      await updateThreadMetadata(ctx, components.agent, {
        threadId,
        patch: { userId: threadKey(account._id) },
      });
      migrated += 1;
    }
    return { migrated };
  },
});
