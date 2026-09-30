import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const BATCH = 100;

/**
 * One-off: legacy `feed` meant carousel. Rewrites it to `carousel` (2+ images)
 * or `image` (1 image), one page per run, rescheduling itself until the table
 * is scanned. Idempotent; delete this file and `feed` from postTypes once it
 * has run in every deployment.
 */
export const feedToCarousel = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }): Promise<{ migrated: number; done: boolean }> => {
    const page = await ctx.db.query("posts").paginate({ cursor: cursor ?? null, numItems: BATCH });

    let migrated = 0;

    for (const post of page.page) {
      if (post.type !== "feed") continue;
      await ctx.db.patch(post._id, { type: post.imageIds.length > 1 ? "carousel" : "image" });
      migrated++;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.feedToCarousel, {
        cursor: page.continueCursor,
      });
    }

    return { migrated, done: page.isDone };
  },
});
