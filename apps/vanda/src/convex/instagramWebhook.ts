import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/** Store webhook subscription failures on the connection without blocking OAuth. */
export const recordSubscriptionError = internalMutation({
  args: { connectionId: v.id("instagramConnections"), error: v.union(v.string(), v.null()) },
  handler: async (ctx, { connectionId, error }) => {
    await ctx.db.patch(connectionId, {
      lastError: error ?? undefined,
      updatedAt: Date.now(),
    });
  },
});

