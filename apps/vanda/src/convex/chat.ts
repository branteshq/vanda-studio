import {
  createThread,
  getThreadMetadata,
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
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import { vanda } from "./vanda";

/**
 * The account's Vanda conversations. Multi-thread: the agent component owns
 * threads and messages; we key its opaque `userId` by the *account* id (not the
 * owner user), so listing/search/archival all come from component primitives
 * while authz stays entirely ours. Durable domain tables remain the truth
 * underneath the conversation.
 */

const WELCOME = `Oi! Eu sou a Vanda, sua operadora de crescimento no Instagram. Eu observo o seu mercado, encontro oportunidades com evidência real e crio carrosséis na voz da sua marca — e nada é publicado sem a sua aprovação.

Você pode começar me pedindo, por exemplo: "procure uma oportunidade no meu mercado" ou "o que você sabe sobre a minha marca?".`;

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

export interface ThreadSummary {
  threadId: string;
  title: string | null;
  createdAt: number;
}

/** The account's active conversations, newest first (component creation order). */
export const listThreads = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<ThreadSummary[]> => {
    await requireOwnedAccount(ctx, accountId);
    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: threadKey(accountId),
      order: "desc",
      paginationOpts: { cursor: null, numItems: 100 },
    });
    return threads.page
      .filter((thread) => thread.status === "active")
      .map((thread) => ({
        threadId: thread._id,
        title: thread.title ?? null,
        createdAt: thread._creationTime,
      }));
  },
});

/** A fresh conversation, opened by Vanda. Untitled until the first user message. */
export const createNewThread = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<string> => {
    await requireOwnedAccount(ctx, accountId);
    const threadId = await createThread(ctx, components.agent, {
      userId: threadKey(accountId),
    });
    await saveMessage(ctx, components.agent, {
      threadId,
      agentName: "vanda",
      message: { role: "assistant", content: WELCOME },
    });
    return threadId;
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

export const sendMessage = mutation({
  args: { accountId: v.id("accounts"), threadId: v.string(), prompt: v.string() },
  handler: async (ctx, { accountId, threadId, prompt }): Promise<{ messageId: string }> => {
    await requireOwnedAccount(ctx, accountId);
    const thread = await requireAccountThread(ctx, accountId, threadId);
    const trimmed = prompt.trim();
    if (!trimmed) throw new Error("mensagem vazia");
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt: trimmed,
    });
    // The first user message names the conversation.
    if (!thread.title) {
      const title = trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
      await updateThreadMetadata(ctx, components.agent, { threadId, patch: { title } });
    }
    await ctx.scheduler.runAfter(0, internal.chat.generateResponse, {
      accountId,
      threadId,
      promptMessageId: messageId,
    });
    return { messageId };
  },
});

/** One asynchronous Vanda turn: context assembly, tool loop, streamed reply. */
export const generateResponse = internalAction({
  args: {
    accountId: v.id("accounts"),
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, { accountId, threadId, promptMessageId }): Promise<void> => {
    const result = await vanda.streamText(
      { ...ctx, accountId },
      { threadId },
      { promptMessageId },
      { saveStreamDeltas: true },
    );
    await result.consumeStream();
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
 * Resolve a tool call that paused for the owner's decision (publishing).
 * The domain-level status gate in the publish pipeline remains the final
 * safety boundary; this is the conversational mechanism.
 */
export const respondToApproval = mutation({
  args: {
    accountId: v.id("accounts"),
    threadId: v.string(),
    approvalId: v.string(),
    approve: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, threadId, approvalId, approve, reason }): Promise<void> => {
    await requireOwnedAccount(ctx, accountId);
    await requireAccountThread(ctx, accountId, threadId);
    const { messageId } = approve
      ? await vanda.approveToolCall(ctx, { threadId, approvalId, ...(reason ? { reason } : {}) })
      : await vanda.denyToolCall(ctx, { threadId, approvalId, ...(reason ? { reason } : {}) });
    await ctx.scheduler.runAfter(0, internal.chat.generateResponse, {
      accountId,
      threadId,
      promptMessageId: messageId,
    });
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
