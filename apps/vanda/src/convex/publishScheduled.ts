import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import { scheduledStatuses } from "./pipeline/constants";

/** Joins a scheduled post to its post + ordered images, for the publisher. */
export const loadScheduledPostData = internalQuery({
  args: { scheduledPostId: v.id("scheduledPosts") },
  handler: async (ctx, { scheduledPostId }) => {
    const scheduled = await ctx.db.get(scheduledPostId);
    if (scheduled === null) return null;
    const post = await ctx.db.get(scheduled.postId);
    if (post === null) return null;
    const images = await Promise.all(post.imageIds.map((imageId) => ctx.db.get(imageId)));
    // A post must reference a fully-resolvable image set; a dangling reference
    // would silently publish different content, so treat it as unresolvable.
    const present = images.filter((image): image is NonNullable<typeof image> => image !== null);
    if (present.length !== post.imageIds.length) return null;
    return {
      type: post.type,
      caption: post.caption,
      images: present.map((image) => ({
        storageId: image.storageId,
        externalUrl: image.externalUrl,
      })),
    };
  },
});

/** Resolves the Instagram connection (id + encrypted token) for a scheduled post's account. */
export const getPublishProfile = internalQuery({
  args: { scheduledPostId: v.id("scheduledPosts") },
  handler: async (ctx, { scheduledPostId }): Promise<{ username: string } | null> => {
    const scheduled = await ctx.db.get(scheduledPostId);
    if (scheduled === null) return null;
    const account = await ctx.db.get(scheduled.accountId);
    if (account === null || account.publisherConnectedAt === undefined) return null;
    // The publisher profile username is the account id by construction.
    return { username: String(account._id) };
  },
});

export const setScheduledStatus = internalMutation({
  args: {
    scheduledPostId: v.id("scheduledPosts"),
    status: v.union(...scheduledStatuses.map((status) => v.literal(status))),
    externalPostId: v.optional(v.string()),
    permalink: v.optional(v.string()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, { scheduledPostId, status, externalPostId, permalink, lastError }) => {
    const scheduled = await ctx.db.get(scheduledPostId);
    if (!scheduled) return;
    const now = Date.now();
    await ctx.db.patch(scheduledPostId, {
      status,
      ...(externalPostId !== undefined ? { externalPostId } : {}),
      ...(permalink !== undefined ? { permalink } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
      updatedAt: now,
    });
    const post = await ctx.db.get(scheduled.postId);
    if (!post) return;
    if (status === "published") await ctx.db.patch(post._id, { status: "published" });
    const opportunity = post.opportunityId ? await ctx.db.get(post.opportunityId) : null;
    if (opportunity) {
      if (status === "published")
        await ctx.db.patch(opportunity._id, {
          status: "published",
          lastError: undefined,
          updatedAt: now,
        });
      else if (status === "failed")
        await ctx.db.patch(opportunity._id, {
          status: "failed",
          lastError: lastError ?? "publication failed",
          updatedAt: now,
        });
    }
  },
});

/** Pin a post to a datetime (the calendar) and schedule its publish. */
export const schedulePost = internalMutation({
  args: { postId: v.id("posts"), scheduledFor: v.number() },
  handler: async (ctx, { postId, scheduledFor }) => {
    const post = await ctx.db.get(postId);
    if (post === null) throw new Error("post not found");
    const now = Date.now();
    const scheduledPostId = await ctx.db.insert("scheduledPosts", {
      accountId: post.accountId,
      postId,
      scheduledFor,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    });
    const scheduledJobId = await ctx.scheduler.runAt(
      scheduledFor,
      internal.publishScheduledNode.runScheduledPost,
      { scheduledPostId },
    );
    await ctx.db.patch(scheduledPostId, { scheduledJobId });
    return scheduledPostId;
  },
});

/** Calendar view: scheduled posts for an account within a datetime range. */
export const listScheduledBetween = internalQuery({
  args: { accountId: v.id("accounts"), from: v.number(), to: v.number() },
  handler: (ctx, { accountId, from, to }) =>
    ctx.db
      .query("scheduledPosts")
      .withIndex("by_account_scheduledFor", (q) =>
        q.eq("accountId", accountId).gte("scheduledFor", from).lte("scheduledFor", to),
      )
      .collect(),
});
