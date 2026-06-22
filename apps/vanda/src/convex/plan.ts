import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { suggestionStatuses } from "./pipeline/constants";
import { suggestionColumns } from "./pipeline/storage";

/** Suggestion arg shape: the durable columns with a plain-string accountId (the domain carries
 *  `accountId` as a string); the stored row's id comes from the top-level `accountId` arg. */
const suggestionArg = { ...suggestionColumns, accountId: v.string() };

/** Statuses a plan pass regenerates each run; committed/terminal states
 *  (creating/scheduled/dismissed) are preserved. `creating` is set only when the
 *  create stage promotes an `approved` suggestion, so plan never clobbers it. */
const REGENERABLE = new Set<string>(["suggestion", "needs_you", "approved", "rejected"]);

/**
 * Persist a plan pass: clear the account's open/rejected suggestions and insert
 * the fresh batch. Committed states are left untouched so re-deliberation never
 * clobbers an owner decision or in-flight create.
 */
export const saveSuggestions = internalMutation({
  args: {
    accountId: v.id("accounts"),
    suggestions: v.array(v.object(suggestionArg)),
  },
  handler: async (ctx, { accountId, suggestions }) => {
    const existing = await ctx.db
      .query("suggestions")
      .withIndex("by_account_status", (q) => q.eq("accountId", accountId))
      .collect();
    for (const row of existing) {
      if (REGENERABLE.has(row.status)) await ctx.db.delete(row._id);
    }
    for (const suggestion of suggestions) {
      await ctx.db.insert("suggestions", { ...suggestion, accountId });
    }
  },
});

/** List an account's suggestions, optionally filtered by status; newest-first otherwise. */
export const listSuggestions = internalQuery({
  args: {
    accountId: v.id("accounts"),
    status: v.optional(v.union(...suggestionStatuses.map((s) => v.literal(s)))),
  },
  handler: (ctx, { accountId, status }) =>
    status === undefined
      ? ctx.db
          .query("suggestions")
          .withIndex("by_account_created", (q) => q.eq("accountId", accountId))
          .order("desc")
          .collect()
      : ctx.db
          .query("suggestions")
          .withIndex("by_account_status", (q) => q.eq("accountId", accountId).eq("status", status))
          .order("desc")
          .collect(),
});

/** Cron target: schedule a plan pass for every account with a connection. */
export const planAllAccounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("accounts").collect();
    for (const account of accounts) {
      if (account.connectionId === undefined) continue;
      await ctx.scheduler.runAfter(0, internal.planAction.planAccount, {
        accountId: account._id,
      });
    }
  },
});
