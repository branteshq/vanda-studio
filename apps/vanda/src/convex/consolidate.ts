import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { defaultPolicy } from "./pipeline/memory";
import type { Belief, Theme } from "./pipeline/memory";
import type { MemorySnapshot } from "./pipeline/memoryStore";
import { beliefColumns, themeColumns } from "./pipeline/storage";

/** Belief/theme arg shapes: the durable columns with a plain-string accountId, since the
 *  domain objects carry `accountId` as a string. The stored row's id comes from the top-level
 *  `accountId` arg below. */
const beliefArg = { ...beliefColumns, accountId: v.string() };
const themeArg = { ...themeColumns, accountId: v.string() };

// Strip Convex system fields (_id/_creationTime) so the snapshot is clean domain
// data — consolidate spreads beliefs/themes into its result, and applyConsolidation
// validates strictly against the table columns.
const toBelief = (b: Doc<"beliefs">): Belief => ({
  accountId: b.accountId,
  statement: b.statement,
  kind: b.kind,
  confidence: b.confidence,
  supportingSignalIds: b.supportingSignalIds,
  firstSeenAt: b.firstSeenAt,
  confidenceAsOf: b.confidenceAsOf,
  status: b.status,
});

const toTheme = (t: Doc<"themes">): Theme => {
  const base = {
    accountId: t.accountId,
    name: t.name,
    summary: t.summary,
    momentum: t.momentum,
    postCount: t.postCount,
    signalCount: t.signalCount,
  };
  return t.lastPostedAt === undefined ? base : { ...base, lastPostedAt: t.lastPostedAt };
};

/** A consistent read of an account's discernment memory (beliefs, themes, policy-or-default). */
export const loadSnapshot = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<MemorySnapshot> => {
    const beliefs = (
      await ctx.db
        .query("beliefs")
        .withIndex("by_account_status", (q) => q.eq("accountId", accountId))
        .collect()
    ).map(toBelief);
    const themes = (
      await ctx.db
        .query("themes")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    ).map(toTheme);
    const policyRow = await ctx.db
      .query("policies")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .first();
    const account = await ctx.db.get(accountId);
    return {
      beliefs,
      themes,
      policy: policyRow ?? defaultPolicy,
      mode: account?.mode ?? "needs_approval",
    };
  },
});

/** The pending consolidation queue: signals observed but not yet folded into memory. */
export const listUnconsolidatedSignals = internalQuery({
  args: { accountId: v.id("accounts"), limit: v.optional(v.number()) },
  handler: (ctx, { accountId, limit }) =>
    ctx.db
      .query("signals")
      .withIndex("by_account_consolidated", (q) =>
        q.eq("accountId", accountId).eq("consolidatedAt", undefined),
      )
      .take(limit ?? 100),
});

/**
 * Apply one consolidation pass atomically (single transaction): upsert the full
 * belief + theme sets, append the journal note, and mark the consumed signals
 * consolidated so they leave the pending queue. Upsert identity is the belief
 * `statement` / theme `name` (the model is asked to reuse exact wording; a
 * reworded statement creates a new belief the owner can later merge). consolidate
 * is the sole writer of `beliefs`/`themes` and runs at most once per account per
 * cron tick, so the load→fold→replace round-trip needs no row-level locking;
 * owner edits (a later phase) must reconcile against this invariant.
 */
export const applyConsolidation = internalMutation({
  args: {
    accountId: v.id("accounts"),
    beliefs: v.array(v.object(beliefArg)),
    themes: v.array(v.object(themeArg)),
    note: v.string(),
    consumedSignalIds: v.array(v.string()),
  },
  handler: async (ctx, { accountId, beliefs, themes, note, consumedSignalIds }) => {
    const now = Date.now();

    const existingBeliefs = await ctx.db
      .query("beliefs")
      .withIndex("by_account_status", (q) => q.eq("accountId", accountId))
      .collect();
    const beliefId = new Map(existingBeliefs.map((b) => [b.statement, b._id] as const));
    for (const belief of beliefs) {
      const row = { ...belief, accountId };
      const id = beliefId.get(belief.statement);
      if (id !== undefined) await ctx.db.replace(id, row);
      else await ctx.db.insert("beliefs", row);
    }

    const existingThemes = await ctx.db
      .query("themes")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const themeId = new Map(existingThemes.map((t) => [t.name, t._id] as const));
    for (const theme of themes) {
      const row = { ...theme, accountId };
      const id = themeId.get(theme.name);
      if (id !== undefined) await ctx.db.replace(id, row);
      else await ctx.db.insert("themes", row);
    }

    await ctx.db.insert("memoryNotes", {
      accountId,
      note,
      signalCount: consumedSignalIds.length,
      createdAt: now,
    });

    for (const signalId of consumedSignalIds) {
      await ctx.db.patch(signalId as Id<"signals">, { consolidatedAt: now });
    }
  },
});

/** Cron target: schedule a consolidate pass for every account with a connection. */
export const consolidateAllAccounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("accounts").collect();
    for (const account of accounts) {
      if (account.connectionId === undefined) continue;
      await ctx.scheduler.runAfter(0, internal.consolidateAction.consolidateAccount, {
        accountId: account._id,
      });
    }
  },
});
