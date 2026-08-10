"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { publishStoreLive, publisherLive } from "./pipeline/livePublish";
import { publishDue } from "./pipeline/publish";

/**
 * Scheduler target for a due scheduled post: resolve the account's publisher
 * profile and run the publish program against Upload-Post. The program
 * records the outcome on the scheduled-post row.
 */
export const runScheduledPost = internalAction({
  args: { scheduledPostId: v.id("scheduledPosts") },
  handler: async (ctx, { scheduledPostId }) => {
    // The credential phase (profile lookup) runs before publishDue, so its
    // failures are recorded here; publishDue records its own publish-phase
    // failures. Either way the row never strands at "scheduled".
    const profile = await ctx.runQuery(internal.publishScheduled.getPublishProfile, {
      scheduledPostId,
    });
    if (profile === null) {
      await ctx.runMutation(internal.publishScheduled.setScheduledStatus, {
        scheduledPostId,
        status: "failed",
        lastError: "no_connected_account",
      });
      return;
    }
    const layer = Layer.mergeAll(publishStoreLive(ctx), publisherLive(profile));
    await Effect.runPromise(publishDue(scheduledPostId).pipe(Effect.provide(layer)));
  },
});
