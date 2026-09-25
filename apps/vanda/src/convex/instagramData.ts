import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { chargeUsage } from "./usage";
import { agentActivityIdValidator, requireOwnedAgentActivity } from "./agentActivity";

interface InstagramReadEvent {
  accountId: Id<"accounts">;
  operation: string;
  source: "upload_post" | "apify";
  itemCount: number;
  observedAt: number;
  costUsd?: number;
}

export const resolveConnectedTarget = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);

    if (!account || !account.handle || account.publisherConnectedAt === undefined) {
      throw new Error("account has no connected Instagram profile");
    }

    return { publisherUsername: String(accountId), handle: account.handle };
  },
});

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

export const publicReadItemsSince = internalQuery({
  args: { accountId: v.id("accounts"), since: v.number() },
  handler: async (ctx, { accountId, since }) => {
    const observations = await ctx.db
      .query("instagramReadEvents")
      .withIndex("by_account_observed", (q) =>
        q.eq("accountId", accountId).gte("observedAt", since),
      )
      .collect();

    return observations
      .filter((observation) => observation.source === "apify")
      .reduce((total, observation) => total + observation.itemCount, 0);
  },
});

export const saveObservation = internalMutation({
  args: {
    accountId: v.id("accounts"),
    activityId: v.optional(agentActivityIdValidator),
    requestKey: v.string(),
    operation: v.string(),
    target: v.string(),
    workspacePath: v.string(),
    source: v.union(v.literal("upload_post"), v.literal("apify")),
    completeness: v.union(v.literal("complete"), v.literal("partial")),
    payload: v.any(),
    itemCount: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    nextCursor: v.optional(v.string()),
    observedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { activityId, ...args }) => {
    if (!(await ctx.db.get(args.accountId))) throw new Error("account not found");

    if (activityId) await requireOwnedAgentActivity(ctx, args.accountId, activityId);

    if (!args.workspacePath.startsWith("/instagram/")) {
      throw new Error("invalid Instagram workspace path");
    }

    const existing = await ctx.db
      .query("instagramObservations")
      .withIndex("by_account_request", (q) =>
        q.eq("accountId", args.accountId).eq("requestKey", args.requestKey),
      )
      .unique();

    let observationId;

    if (existing) {
      await ctx.db.patch(existing._id, args);
      observationId = existing._id;
    } else {
      observationId = await ctx.db.insert("instagramObservations", args);
    }

    const readEvent: InstagramReadEvent = {
      accountId: args.accountId,
      operation: args.operation,
      source: args.source,
      itemCount: args.itemCount ?? 1,
      observedAt: args.observedAt,
    };

    if (args.costUsd !== undefined) readEvent.costUsd = args.costUsd;

    await ctx.db.insert("instagramReadEvents", readEvent);

    if (args.source === "apify" && args.costUsd && args.costUsd > 0) {
      await chargeUsage(ctx, {
        accountId: args.accountId,
        kind: "instagram_apify",
        usd: args.costUsd,
        ref: `${args.operation}:${args.target}`,
        activityId,
      });
    }

    return observationId;
  },
});
