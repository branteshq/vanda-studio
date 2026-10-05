import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { brandFileContent, brandFileFacts } from "./brandFile";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { modelPreferencesOf } from "./settings/registry";

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

    const facts = brandFileFacts(await brandFileContent(ctx, account._id));

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

/** Resolved model ids for an agent turn; the same reader as settings_get. */
export const modelPreferences = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");

    return modelPreferencesOf(user);
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
