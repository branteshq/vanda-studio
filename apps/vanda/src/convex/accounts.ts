import { v } from "convex/values";
import type { Id, TableNames } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import { accountModes, beliefStatuses, suggestionStatuses } from "./pipeline/constants";

async function deleteRows<T extends { _id: Id<TableNames> }>(
  rows: T[],
  del: (id: T["_id"]) => Promise<void>,
) {
  for (const row of rows) await del(row._id);
}

/**
 * The businesses this owner manages — powers the workspace switcher. Each row's
 * display name falls back through the explicit override, the connected IG account
 * name, then the handle. Scoped to the caller; returns `[]` when signed out.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return [];

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
      .collect();

    const rows = await Promise.all(
      accounts.map(async (account) => {
        const connection = account.connectionId ? await ctx.db.get(account.connectionId) : null;
        return {
          id: account._id,
          name:
            account.name ?? connection?.externalAccountName ?? connection?.handle ?? "Novo negócio",
          mode: account.mode,
          handle: connection?.handle ?? null,
          connected: connection?.status === "connected",
          onboardedAt: account.onboardedAt ?? null,
          active: user.activeAccountId === account._id,
          createdAt: account.createdAt,
        };
      }),
    );

    return rows.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const aReady = a.onboardedAt !== null;
      const bReady = b.onboardedAt !== null;
      if (aReady !== bReady) return aReady ? -1 : 1;
      return a.createdAt - b.createdAt;
    });
  },
});

/** Persist the dashboard business selection for the caller across routes and devices. */
export const selectActive = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await requireOwnedAccount(ctx, accountId);
    if (account.onboardedAt === undefined) throw new Error("account not onboarded");
    if (account.ownerUserId === undefined) throw new Error("account has no owner");
    await ctx.db.patch(account.ownerUserId, { activeAccountId: accountId, updatedAt: Date.now() });
  },
});

/** Set the autonomy mode (auto / needs_approval / manual) for a business the caller owns. */
export const setMode = mutation({
  args: {
    accountId: v.id("accounts"),
    mode: v.union(...accountModes.map((mode) => v.literal(mode))),
  },
  handler: async (ctx, { accountId, mode }) => {
    await requireOwnedAccount(ctx, accountId);
    await ctx.db.patch(accountId, { mode, updatedAt: Date.now() });
  },
});

/** Remove a business the caller owns and clear its connected Instagram token. */
export const remove = mutation({
  args: {
    accountId: v.id("accounts"),
  },
  handler: async (ctx, { accountId }) => {
    const account = await requireOwnedAccount(ctx, accountId);

    if (account.ownerUserId !== undefined) {
      const owner = await ctx.db.get(account.ownerUserId);
      if (owner?.activeAccountId === accountId) {
        const fallback = (
          await ctx.db
            .query("accounts")
            .withIndex("by_owner", (q) => q.eq("ownerUserId", account.ownerUserId))
            .collect()
        )
          .filter((candidate) => candidate._id !== accountId && candidate.onboardedAt !== undefined)
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        await ctx.db.patch(owner._id, {
          activeAccountId: fallback?._id,
          updatedAt: Date.now(),
        });
      }
    }

    const signals = await ctx.db
      .query("signals")
      .withIndex("by_account_observedAt", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(signals, (id) => ctx.db.delete(id));

    for (const status of beliefStatuses) {
      const beliefs = await ctx.db
        .query("beliefs")
        .withIndex("by_account_status", (q) => q.eq("accountId", accountId).eq("status", status))
        .collect();
      await deleteRows(beliefs, (id) => ctx.db.delete(id));
    }

    const themes = await ctx.db
      .query("themes")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(themes, (id) => ctx.db.delete(id));

    const policies = await ctx.db
      .query("policies")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(policies, (id) => ctx.db.delete(id));

    const memoryNotes = await ctx.db
      .query("memoryNotes")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(memoryNotes, (id) => ctx.db.delete(id));

    const brandCanon = await ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(brandCanon, (id) => ctx.db.delete(id));

    const knowledge = await ctx.db
      .query("knowledgeChunks")
      .withIndex("by_account_source", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(knowledge, (id) => ctx.db.delete(id));

    const modelRuns = await ctx.db
      .query("modelRuns")
      .withIndex("by_account_started", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(modelRuns, (id) => ctx.db.delete(id));

    for (const status of suggestionStatuses) {
      const suggestions = await ctx.db
        .query("suggestions")
        .withIndex("by_account_status", (q) => q.eq("accountId", accountId).eq("status", status))
        .collect();
      await deleteRows(suggestions, (id) => ctx.db.delete(id));
    }

    const opportunities = await ctx.db
      .query("opportunities")
      .withIndex("by_account_status", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(opportunities, (id) => ctx.db.delete(id));

    const metricSnapshots = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(metricSnapshots, (id) => ctx.db.delete(id));

    const marketPosts = await ctx.db
      .query("marketPosts")
      .withIndex("by_account_published", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(marketPosts, (id) => ctx.db.delete(id));

    const marketCreators = await ctx.db
      .query("marketCreators")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(marketCreators, (id) => ctx.db.delete(id));

    const marketRuns = await ctx.db
      .query("marketRuns")
      .withIndex("by_account_started", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(marketRuns, (id) => ctx.db.delete(id));

    const images = await ctx.db
      .query("images")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(images, (id) => ctx.db.delete(id));

    const posts = await ctx.db
      .query("posts")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(posts, (id) => ctx.db.delete(id));

    const scheduledPosts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_account_scheduledFor", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(scheduledPosts, (id) => ctx.db.delete(id));

    if (account.connectionId !== undefined) {
      const connection = await ctx.db.get(account.connectionId);
      if (connection !== null && connection.userId === account.ownerUserId) {
        await ctx.db.patch(connection._id, {
          status: "expired",
          tokenCiphertext: undefined,
          tokenIv: undefined,
          tokenAuthTag: undefined,
          updatedAt: Date.now(),
        });
      }
    }

    await ctx.db.delete(accountId);
  },
});
