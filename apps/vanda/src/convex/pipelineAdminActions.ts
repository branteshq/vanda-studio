"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

/** Owner-triggered full observation → clean derivation → consolidation → planning pass. */
export const reanalyze = action({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) throw new Error("Not authenticated");
    await ctx.runQuery(internal.pipelineAdmin.authorize, {
      accountId,
      clerkId: identity.subject,
    });
    await ctx.runAction(internal.observeNode.observeAccount, { accountId });
    await ctx.runAction(internal.consolidateAction.rebuildAccount, { accountId });
    await ctx.runAction(internal.planAction.planAccount, { accountId });
    return { completed: true };
  },
});
