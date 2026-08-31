"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import type { MarketRunResult } from "./marketNode";

/** Owner-triggered legacy market pass. */
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
  handler: async (ctx, { accountId, opportunityId }): Promise<Id<"creativeBriefs"> | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    await ctx.runQuery(internal.market.authorize, {
      accountId,
      clerkId: identity.subject,
    });
    const source: {
      opportunity: { status: string };
      dossier: { status: string } | null;
    } | null = await ctx.runQuery(internal.market.loadQualificationSource, { opportunityId });
    if (!source) throw new Error("opportunity not found");
    if (source.opportunity.status === "rejected" && source.dossier?.status === "ready")
      await ctx.runMutation(internal.market.retryCreativeDirector, { opportunityId });
    if (
      source.dossier?.status !== "ready" &&
      (source.opportunity.status === "qualifying" ||
        source.opportunity.status === "detected" ||
        source.opportunity.status === "failed")
    ) {
      const qualified = await ctx.runAction(internal.marketNode.qualifyOpportunity, {
        opportunityId,
        analyzeAfter: false,
      });
      if (!qualified) throw new Error("source did not pass the input quality gate");
    }
    return (await ctx.runAction(internal.marketNode.directOpportunity, {
      opportunityId,
    })) as Id<"creativeBriefs"> | null;
  },
});
