import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireOwnedAccount } from "./authz";

async function deleteRows<T extends { _id: Id<TableNames> }>(
  rows: T[],
  del: (id: T["_id"]) => Promise<void>,
) {
  for (const row of rows) await del(row._id);
}

/**
 * The businesses this owner manages — powers the workspace switcher. Each row's
 * display name falls back through the explicit override, then the connected
 * handle. Scoped to the caller; returns `[]` when signed out.
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

    const rows = accounts.map((account) => ({
      id: account._id,
      name: account.name ?? account.handle ?? "Novo negócio",
      handle: account.handle ?? null,
      connected: account.publisherConnectedAt !== undefined,
      onboardedAt: account.onboardedAt ?? null,
      active: user.activeAccountId === account._id,
      createdAt: account.createdAt,
    }));

    return rows.sort((a, b) => {
      // Keep switcher positions stable: selecting an account changes only its
      // active styling, never the physical order users build muscle memory for.
      const aReady = a.onboardedAt !== null;
      const bReady = b.onboardedAt !== null;
      if (aReady !== bReady) return aReady ? -1 : 1;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return String(a.id).localeCompare(String(b.id));
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

/** Remove a business the caller owns and drop its publisher profile. */
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

    const chatActivity = await ctx.db
      .query("chatThreadActivity")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(chatActivity, (id) => ctx.db.delete(id));

    const brandCanon = await ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(brandCanon, (id) => ctx.db.delete(id));

    const modelRuns = await ctx.db
      .query("modelRuns")
      .withIndex("by_account_started", (q) => q.eq("accountId", accountId))
      .collect();
    await deleteRows(modelRuns, (id) => ctx.db.delete(id));

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

    // Best-effort: drop the publisher profile (and its Instagram link) too.
    await ctx.scheduler.runAfter(0, internal.publisherConnect.cleanupProfile, {
      username: String(accountId),
    });

    await ctx.db.delete(accountId);
  },
});
