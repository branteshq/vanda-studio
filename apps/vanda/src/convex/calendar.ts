import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOwnedAccount } from "./authz";

/**
 * The account's publication calendar: every scheduled/published post inside
 * [start, end), with enough of the post to render a compact calendar item.
 */
export const range = query({
  args: {
    accountId: v.id("accounts"),
    start: v.number(),
    end: v.number(),
  },
  handler: async (ctx, { accountId, start, end }) => {
    await requireOwnedAccount(ctx, accountId);
    const scheduled = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_account_scheduledFor", (q) =>
        q.eq("accountId", accountId).gte("scheduledFor", start).lt("scheduledFor", end),
      )
      .collect();
    return Promise.all(
      scheduled.map(async (item) => {
        const post = await ctx.db.get(item.postId);
        const coverImage = post?.imageIds[0] ? await ctx.db.get(post.imageIds[0]) : null;
        const coverUrl =
          coverImage?.externalUrl ??
          (coverImage?.storageId ? await ctx.storage.getUrl(coverImage.storageId) : null);
        return {
          scheduledPostId: item._id,
          scheduledFor: item.scheduledFor,
          status: item.status,
          lastError: item.lastError,
          externalPostId: item.externalPostId,
          caption: post?.caption ?? "",
          slideCount: post?.imageIds.length ?? 0,
          coverUrl,
        };
      }),
    );
  },
});
