import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";

/** Owner-triggered entry point; the internal worker is also used by automatic opportunities. */
export const seedLegacyOpportunity = action({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, { opportunityId }): Promise<Id<"contentProjects">> => {
    const input = await ctx.runQuery(internal.contentStudio.loadLegacySeedInput, {
      opportunityId,
    });
    if (!input) throw new Error("legacy opportunity input not found");
    await ctx.runQuery(internal.visualBrand.requireAccountOwner, {
      accountId: input.account._id,
    });
    return ctx.runAction(internal.contentStudioNode.seedLegacyOpportunityInternal, {
      opportunityId,
    });
  },
});

export const createFromBrief = action({
  args: { creativeBriefId: v.id("creativeBriefs"), retry: v.optional(v.boolean()) },
  handler: async (ctx, { creativeBriefId, retry }): Promise<Id<"contentProjects">> => {
    await ctx.runQuery(internal.contentStudio.requireBriefOwner, { creativeBriefId });
    return ctx.runAction(internal.contentStudioNode.createFromBriefInternal, {
      creativeBriefId,
      ...(retry !== undefined ? { retry } : {}),
    });
  },
});
