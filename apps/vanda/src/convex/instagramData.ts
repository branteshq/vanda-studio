import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const readCachedObservation = internalQuery({
  args: {
    accountId: v.id("accounts"),
    requestKey: v.string(),
    now: v.number(),
  },
  handler: async (ctx, { accountId, requestKey, now }) => {
    const observation = await ctx.db
      .query("instagramObservations")
      .withIndex("by_account_request", (q) =>
        q.eq("accountId", accountId).eq("requestKey", requestKey),
      )
      .unique();
    return observation && observation.expiresAt > now ? observation : null;
  },
});

export const saveObservation = internalMutation({
  args: {
    accountId: v.id("accounts"),
    requestKey: v.string(),
    operation: v.string(),
    target: v.string(),
    workspacePath: v.string(),
    source: v.union(v.literal("upload_post"), v.literal("apify")),
    completeness: v.union(v.literal("complete"), v.literal("partial")),
    payload: v.any(),
    nextCursor: v.optional(v.string()),
    observedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.accountId))) throw new Error("account not found");
    if (!args.workspacePath.startsWith("/instagram/")) {
      throw new Error("invalid Instagram workspace path");
    }
    const existing = await ctx.db
      .query("instagramObservations")
      .withIndex("by_account_request", (q) =>
        q.eq("accountId", args.accountId).eq("requestKey", args.requestKey),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("instagramObservations", args);
  },
});
