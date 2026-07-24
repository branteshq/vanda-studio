"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import type { MarketRunResult } from "./marketNode";

/** Owner-triggered market pass. The hourly cron invokes the same durable entry point. */
export const runNow = action({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<MarketRunResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    await ctx.runQuery(internal.market.authorize, {
      accountId,
      clerkId: identity.subject,
    });
    return (await ctx.runAction(internal.marketNode.runAccount, {
      accountId,
    })) as MarketRunResult;
  },
});

/** Owner-triggered retry for one detected or failed opportunity. */
export const adaptNow = action({
  args: { accountId: v.id("accounts"), opportunityId: v.id("opportunities") },
  handler: async (ctx, { accountId, opportunityId }): Promise<Id<"posts">> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    await ctx.runQuery(internal.market.authorize, {
      accountId,
      clerkId: identity.subject,
    });
    return (await ctx.runAction(internal.marketNode.analyzeOpportunity, {
      opportunityId,
    })) as Id<"posts">;
  },
});
