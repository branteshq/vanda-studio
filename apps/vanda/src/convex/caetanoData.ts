import {
  createThread,
  getThreadMetadata,
  saveMessage,
  updateThreadMetadata,
} from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { orchestratorModel, resolveOrchestratorModel } from "./agentModels";
import { DEFAULT_IMAGE_MODEL, isKnownImageModel } from "./imageModels";
import { isConnectedSubscriber } from "./openaiSub";
import { budgetOf, USAGE_LIMIT_MESSAGE } from "./usage";

const accountThreadKey = (accountId: Id<"accounts">): string => String(accountId);

const ownedAccount = async (
  ctx: QueryCtx | MutationCtx,
  user: Doc<"users">,
  requested?: Id<"accounts"> | undefined,
): Promise<Doc<"accounts">> => {
  const accountId = requested ?? user.activeAccountId;
  if (!accountId) throw new Error("nenhuma conta ativa");
  const account = await ctx.db.get(accountId);
  if (!account || account.ownerUserId !== user._id) throw new Error("conta não encontrada");
  return account;
};

export const listAccounts = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("user not found");
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();
    const rows = accounts.map((account) => ({
      accountId: account._id,
      name: account.name ?? account.handle ?? "Novo negócio",
      handle: account.handle ?? null,
      connected: account.publisherConnectedAt !== undefined,
      onboarded: account.onboardedAt !== undefined,
      active: account._id === user.activeAccountId,
    }));
    const active = rows.find((account) => account.active);
    return active ? [active, ...rows.filter((account) => !account.active)] : rows;
  },
});

export const accountStatus = internalQuery({
  args: { userId: v.id("users"), accountId: v.optional(v.id("accounts")) },
  handler: async (ctx, { userId, accountId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("user not found");
    const account = await ownedAccount(ctx, user, accountId);
    const facts = await ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();
    return {
      accountId: account._id,
      name: account.name ?? account.handle ?? "Novo negócio",
      handle: account.handle ?? null,
      instagramConnected: account.publisherConnectedAt !== undefined,
      onboardingComplete: account.onboardedAt !== undefined,
      brandFacts: facts.length,
      kind: account.kind ?? null,
      links: {
        conversation: "/conversa",
        gallery: "/galeria",
        calendar: "/calendario",
        profile: "/perfil",
      },
    };
  },
});

export const selectAccount = internalMutation({
  args: { userId: v.id("users"), accountId: v.id("accounts") },
  handler: async (ctx, { userId, accountId }): Promise<void> => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("user not found");
    const account = await ownedAccount(ctx, user, accountId);
    if (account.onboardedAt === undefined) throw new Error("conta ainda não concluiu o onboarding");
    await ctx.db.patch(userId, { activeAccountId: accountId, updatedAt: Date.now() });
  },
});

export const usageStatus = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("user not found");
    const state = await budgetOf(ctx, user);
    const usedPct =
      state.allowanceMicroUsd > 0
        ? Math.min(100, Math.round((state.spentMicroUsd / state.allowanceMicroUsd) * 100))
        : 100;
    return {
      plan: user.planId ?? "trial",
      usedPct,
      limited: !state.ok,
      renewsAt: user.billingPeriodEnd ?? null,
    };
  },
});

export const modelPreferences = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("user not found");
    const conectado = isConnectedSubscriber(user);
    return {
      orchestrator: resolveOrchestratorModel(user.orchestratorModel, { conectado }),
      image:
        user.imageModel && isKnownImageModel(user.imageModel)
          ? user.imageModel
          : DEFAULT_IMAGE_MODEL,
      conectado,
    };
  },
});

export const setModelPreferences = internalMutation({
  args: {
    userId: v.id("users"),
    orchestrator: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, { userId, orchestrator, image }): Promise<void> => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("user not found");
    const conectado = isConnectedSubscriber(user);
    const patch: { orchestratorModel?: string; imageModel?: string; updatedAt: number } = {
      updatedAt: Date.now(),
    };
    if (orchestrator !== undefined) {
      const selected = orchestratorModel(orchestrator);
      if (!selected) throw new Error("modelo de texto desconhecido");
      if (conectado && !selected.codexCapable) {
        throw new Error("este modelo não roda pela assinatura conectada do ChatGPT");
      }
      patch.orchestratorModel = selected.id;
    }
    if (image !== undefined) {
      if (!isKnownImageModel(image)) throw new Error("modelo de imagem desconhecido");
      if (conectado) throw new Error("o plano ChatGPT fixa o modelo de imagem");
      patch.imageModel = image;
    }
    await ctx.db.patch(userId, patch);
  },
});

export const listVandaThreads = internalQuery({
  args: { userId: v.id("users"), accountId: v.optional(v.id("accounts")) },
  handler: async (ctx, { userId, accountId }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("user not found");
    const account = await ownedAccount(ctx, user, accountId);
    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: accountThreadKey(account._id),
      order: "desc",
      paginationOpts: { cursor: null, numItems: 20 },
    });
    return threads.page
      .filter((thread) => thread.status === "active")
      .map((thread) => ({
        threadId: thread._id,
        title: thread.title ?? "Nova conversa",
        createdAt: thread._creationTime,
        caetanoDefault: thread._id === account.caetanoVandaThreadId,
        link: `/conversa?t=${encodeURIComponent(thread._id)}`,
      }));
  },
});

export interface PreparedVandaTurn {
  readonly accountId: Id<"accounts">;
  readonly threadId: string;
  readonly promptMessageId: string;
  readonly activityId: Id<"chatThreadActivity">;
}

export const prepareVandaTurn = internalMutation({
  args: {
    userId: v.id("users"),
    accountId: v.optional(v.id("accounts")),
    threadId: v.optional(v.string()),
    request: v.string(),
  },
  handler: async (ctx, { userId, accountId, threadId, request }): Promise<PreparedVandaTurn> => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("user not found");
    if (!(await budgetOf(ctx, user)).ok) throw new Error(USAGE_LIMIT_MESSAGE);
    const account = await ownedAccount(ctx, user, accountId);
    if (account.onboardedAt === undefined) throw new Error("conta ainda não concluiu o onboarding");

    let target = threadId ?? account.caetanoVandaThreadId;
    if (target) {
      const meta = await getThreadMetadata(ctx, components.agent, { threadId: target }).catch(
        () => null,
      );
      if (!meta || meta.userId !== accountThreadKey(account._id) || meta.status !== "active") {
        if (threadId) throw new Error("conversa da Vanda não encontrada");
        target = undefined;
      }
    }
    if (!target) {
      target = await createThread(ctx, components.agent, { userId: accountThreadKey(account._id) });
      await updateThreadMetadata(ctx, components.agent, {
        threadId: target,
        patch: { title: `Caetano · ${account.name ?? account.handle ?? "Vanda"}`.slice(0, 80) },
      });
      await ctx.db.patch(account._id, { caetanoVandaThreadId: target, updatedAt: Date.now() });
    }

    const prompt =
      `Pedido recebido do dono através do Caetano:\n\n${request.trim()}\n\n` +
      `Execute o pedido completamente usando o workspace e as ferramentas disponíveis. ` +
      `Ao terminar, explique objetivamente o que fez e onde está o resultado.`;
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: target,
      message: { role: "user", content: prompt },
    });
    const activityId = await ctx.db.insert("chatThreadActivity", {
      accountId: account._id,
      threadId: target,
      promptMessageId: messageId,
      startedAt: Date.now(),
    });
    return { accountId: account._id, threadId: target, promptMessageId: messageId, activityId };
  },
});

export const setActiveVandaThread = internalMutation({
  args: { userId: v.id("users"), caetanoThreadId: v.string(), vandaThreadId: v.string() },
  handler: async (ctx, { userId, caetanoThreadId, vandaThreadId }): Promise<void> => {
    const rows = await ctx.db
      .query("caetanoThreadActivity")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const row = rows.find((candidate) => candidate.threadId === caetanoThreadId);
    if (row) await ctx.db.patch(row._id, { activeVandaThreadId: vandaThreadId });
  },
});
