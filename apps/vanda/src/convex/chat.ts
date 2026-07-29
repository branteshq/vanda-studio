import {
  createThread,
  listUIMessages,
  saveMessage,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import { vanda } from "./vanda";

/**
 * The account's canonical Vanda conversation. The thread is the interface;
 * durable domain tables stay the truth underneath it.
 */

const WELCOME = `Oi! Eu sou a Vanda, sua operadora de crescimento no Instagram. Eu observo o seu mercado, encontro oportunidades com evidência real e crio carrosséis na voz da sua marca — e nada é publicado sem a sua aprovação.

Você pode começar me pedindo, por exemplo: "procure uma oportunidade no meu mercado" ou "o que você sabe sobre a minha marca?".`;

export const getThread = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<string | null> => {
    const account = await requireOwnedAccount(ctx, accountId);
    return account.vandaThreadId ?? null;
  },
});

export const ensureThread = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<string> => {
    const account = await requireOwnedAccount(ctx, accountId);
    if (account.vandaThreadId) return account.vandaThreadId;
    const threadId = await createThread(ctx, components.agent, {
      userId: account.ownerUserId ? String(account.ownerUserId) : null,
      title: account.name ?? "Vanda",
    });
    await ctx.db.patch(accountId, { vandaThreadId: threadId, updatedAt: Date.now() });
    await saveMessage(ctx, components.agent, {
      threadId,
      agentName: "vanda",
      message: { role: "assistant", content: WELCOME },
    });
    return threadId;
  },
});

export const sendMessage = mutation({
  args: { accountId: v.id("accounts"), prompt: v.string() },
  handler: async (
    ctx,
    { accountId, prompt },
  ): Promise<{ threadId: string; messageId: string }> => {
    const account = await requireOwnedAccount(ctx, accountId);
    const threadId = account.vandaThreadId;
    if (!threadId) throw new Error("conversa ainda não inicializada");
    const trimmed = prompt.trim();
    if (!trimmed) throw new Error("mensagem vazia");
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      prompt: trimmed,
    });
    await ctx.scheduler.runAfter(0, internal.chat.generateResponse, {
      accountId,
      threadId,
      promptMessageId: messageId,
    });
    return { threadId, messageId };
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
    const account = await requireOwnedAccount(ctx, accountId);
    if (account.vandaThreadId !== threadId) throw new Error("thread not found");
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
    approvalId: v.string(),
    approve: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, approvalId, approve, reason }): Promise<void> => {
    const account = await requireOwnedAccount(ctx, accountId);
    const threadId = account.vandaThreadId;
    if (!threadId) throw new Error("conversa ainda não inicializada");
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
 * A deterministic assistant note posted into the account's thread — how
 * background jobs report completion without an LLM call. The user can then ask
 * follow-ups normally.
 */
export const postAssistantNote = internalMutation({
  args: { accountId: v.id("accounts"), text: v.string() },
  handler: async (ctx, { accountId, text }): Promise<void> => {
    const account = await ctx.db.get(accountId);
    const threadId = account?.vandaThreadId;
    if (!threadId) return;
    await saveMessage(ctx, components.agent, {
      threadId,
      agentName: "vanda",
      message: { role: "assistant", content: text },
    });
  },
});
