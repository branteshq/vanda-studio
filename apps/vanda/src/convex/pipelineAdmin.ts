import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { loadPipelineReceipt, type PipelineReceipt } from "./pipelineDiagnostics";

export const authorize = internalQuery({
  args: { accountId: v.id("accounts"), clerkId: v.string() },
  handler: async (ctx, { accountId, clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
    const account = await ctx.db.get(accountId);
    if (user === null || account === null || account.ownerUserId !== user._id)
      throw new Error("account not found");
    return true;
  },
});

export const receipt = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: (ctx, { accountId }): Promise<PipelineReceipt> => loadPipelineReceipt(ctx, accountId),
});

export const resetDerived = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const beliefs = await ctx.db
      .query("beliefs")
      .withIndex("by_account_status", (q) => q.eq("accountId", accountId))
      .collect();
    const themes = await ctx.db
      .query("themes")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const notes = await ctx.db
      .query("memoryNotes")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const knowledge = await ctx.db
      .query("knowledgeChunks")
      .withIndex("by_account_source", (q) => q.eq("accountId", accountId))
      .collect();
    for (const row of [...beliefs, ...themes, ...notes, ...knowledge]) await ctx.db.delete(row._id);

    const openStatuses = ["suggestion", "needs_you", "approved", "rejected"] as const;
    for (const status of openStatuses) {
      const rows = await ctx.db
        .query("suggestions")
        .withIndex("by_account_status", (q) => q.eq("accountId", accountId).eq("status", status))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }

    const signals = await ctx.db
      .query("signals")
      .withIndex("by_account_consolidated", (q) => q.eq("accountId", accountId))
      .collect();
    for (const signal of signals) {
      if (signal.noise === true) continue;
      await ctx.db.patch(signal._id, {
        consolidatedAt: undefined,
        salience: undefined,
        actionable: undefined,
        discardedReason: undefined,
      });
    }
  },
});
