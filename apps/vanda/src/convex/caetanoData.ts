import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireTextModel, resolveCaetanoModel, resolveOrchestratorModel } from "./agentModels";
import {
  DEFAULT_IMAGE_MODEL,
  isKnownImageModel,
  isConnectedImageModel,
  resolveConnectedImageModel,
} from "./imageModels";
import { isConnectedSubscriber } from "./openaiSub";
import { budgetOf } from "./usage";

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
      caetano: resolveCaetanoModel(user.caetanoModel, { conectado }),
      image: conectado
        ? resolveConnectedImageModel(user.imageModel)
        : user.imageModel && isKnownImageModel(user.imageModel)
          ? user.imageModel
          : DEFAULT_IMAGE_MODEL,
      conectado,
    };
  },
});

interface ModelPreferencesPatch {
  orchestratorModel?: string;
  caetanoModel?: string;
  imageModel?: string;
  updatedAt: number;
}

export const setModelPreferences = internalMutation({
  args: {
    userId: v.id("users"),
    orchestrator: v.optional(v.string()),
    caetano: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, { userId, orchestrator, caetano, image }): Promise<void> => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");
    const conectado = isConnectedSubscriber(user);

    const patch: ModelPreferencesPatch = {
      updatedAt: Date.now(),
    };

    if (orchestrator !== undefined) {
      const selected = requireTextModel(orchestrator, conectado);

      patch.orchestratorModel = selected.id;
    }

    if (caetano !== undefined) {
      const selected = requireTextModel(caetano, conectado);
      patch.caetanoModel = selected.id;
    }

    if (image !== undefined) {
      if (!isKnownImageModel(image)) throw new Error("modelo de imagem desconhecido");

      if (conectado && !isConnectedImageModel(image))
        throw new Error("modelo indisponível pela assinatura do ChatGPT");
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
        link: `/conversa?t=${encodeURIComponent(thread._id)}`,
      }));
  },
});
