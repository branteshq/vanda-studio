import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireOwnedAccount } from "./authz";

/**
 * THE post path: gallery image(s) + caption → draft → schedule → publish.
 * A carousel is just a post with more images; produced work differs only in
 * how its images get made (paint + run_code), never in how it publishes.
 */

const MAX_POST_IMAGES = 10;
export const MAX_CAPTION_CHARS = 2200;

/** Create a draft post from account-owned gallery images. */
export const createPostInternal = internalMutation({
  args: {
    accountId: v.id("accounts"),
    imageIds: v.array(v.id("images")),
    caption: v.string(),
    originThreadId: v.optional(v.string()),
    caetanoThreadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { accountId, imageIds, caption, originThreadId, caetanoThreadId },
  ): Promise<Id<"posts">> => {
    if (imageIds.length < 1 || imageIds.length > MAX_POST_IMAGES) {
      throw new Error(
        `um post precisa de 1 a ${MAX_POST_IMAGES} imagens (recebi ${imageIds.length})`,
      );
    }
    if (caption.trim() === "") throw new Error("a legenda não pode ser vazia");
    if (caption.length > MAX_CAPTION_CHARS) {
      throw new Error(`legenda acima do limite do Instagram (${MAX_CAPTION_CHARS} caracteres)`);
    }
    for (const imageId of imageIds) {
      const image = await ctx.db.get(imageId);
      if (image === null || image.accountId !== accountId) {
        throw new Error(`imagem ${imageId} não encontrada nesta conta`);
      }
    }
    return ctx.db.insert("posts", {
      accountId,
      ...(originThreadId ? { originThreadId } : {}),
      ...(caetanoThreadId ? { caetanoThreadId } : {}),
      type: imageIds.length > 1 ? "feed" : "image",
      imageIds,
      caption,
      platform: "instagram",
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

/**
 * Approved commit: pin the post to a datetime and arm the publisher. A post
 * that is already scheduled (and hasn't started publishing) is RE-AIMED —
 * the old scheduler job is disarmed and the new time armed — so "muda para
 * amanhã às 8h" is one approved call, never a duplicate.
 */
export const schedulePostInternal = internalMutation({
  args: {
    accountId: v.id("accounts"),
    postId: v.id("posts"),
    scheduledFor: v.optional(v.number()),
    originThreadId: v.optional(v.string()),
    caetanoThreadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { accountId, postId, scheduledFor, originThreadId, caetanoThreadId },
  ): Promise<{
    scheduledPostId: Id<"scheduledPosts">;
    scheduledFor: number;
    rescheduled: boolean;
  }> => {
    const post = await ctx.db.get(postId);
    if (post === null || post.accountId !== accountId) throw new Error("post não encontrado");
    const at = scheduledFor ?? Date.now() + 5_000;
    const now = Date.now();
    if (originThreadId || caetanoThreadId) {
      await ctx.db.patch(postId, {
        ...(originThreadId ? { originThreadId } : {}),
        ...(caetanoThreadId ? { caetanoThreadId } : {}),
      });
    }
    const existing = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .first();
    if (existing !== null) {
      if (existing.status !== "scheduled") {
        throw new Error(`post já está ${existing.status} — não dá mais para reagendar`);
      }
      if (existing.scheduledJobId !== undefined)
        await ctx.scheduler.cancel(existing.scheduledJobId);
      const scheduledJobId = await ctx.scheduler.runAt(
        at,
        internal.publishScheduledNode.runScheduledPost,
        { scheduledPostId: existing._id },
      );
      await ctx.db.patch(existing._id, { scheduledFor: at, scheduledJobId, updatedAt: now });
      return { scheduledPostId: existing._id, scheduledFor: at, rescheduled: true };
    }
    if (post.status !== "draft" && post.status !== "ready") {
      throw new Error(`post já está ${post.status}`);
    }
    const scheduledPostId = await ctx.db.insert("scheduledPosts", {
      accountId,
      postId,
      scheduledFor: at,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(postId, { status: "scheduled" });
    const scheduledJobId = await ctx.scheduler.runAt(
      at,
      internal.publishScheduledNode.runScheduledPost,
      { scheduledPostId },
    );
    await ctx.db.patch(scheduledPostId, { scheduledJobId });
    return { scheduledPostId, scheduledFor: at, rescheduled: false };
  },
});

/** Disarm a pending schedule — the safe direction, back to draft. */
export const cancelScheduleInternal = internalMutation({
  args: { accountId: v.id("accounts"), postId: v.id("posts") },
  handler: async (ctx, { accountId, postId }): Promise<void> => {
    const post = await ctx.db.get(postId);
    if (post === null || post.accountId !== accountId) throw new Error("post não encontrado");
    const scheduled = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .first();
    if (scheduled === null) throw new Error("post não tem agendamento");
    if (scheduled.status !== "scheduled") {
      throw new Error(`agendamento já está ${scheduled.status} — não dá para cancelar`);
    }
    if (scheduled.scheduledJobId !== undefined)
      await ctx.scheduler.cancel(scheduled.scheduledJobId);
    await ctx.db.delete(scheduled._id);
    await ctx.db.patch(postId, { status: "draft" });
  },
});

/** Shared delete: drafts directly, scheduled ones by disarming first. */
const deletePostForAccount = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  postId: Id<"posts">,
): Promise<void> => {
  const post = await ctx.db.get(postId);
  if (post === null || post.accountId !== accountId) throw new Error("post não encontrado");
  const scheduled = await ctx.db
    .query("scheduledPosts")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .first();
  if (scheduled !== null) {
    if (scheduled.status !== "scheduled") {
      throw new Error(`post já está ${scheduled.status} — publicações não podem ser apagadas`);
    }
    if (scheduled.scheduledJobId !== undefined)
      await ctx.scheduler.cancel(scheduled.scheduledJobId);
    await ctx.db.delete(scheduled._id);
  } else if (post.status === "published") {
    throw new Error("post publicado não pode ser apagado");
  }
  // The images stay in the gallery — only the post assembly goes away.
  await ctx.db.delete(postId);
};

/**
 * Delete a post that never went out: drafts directly, scheduled ones by
 * disarming first. Published (or in-flight) posts are history — refused.
 */
export const deletePostInternal = internalMutation({
  args: { accountId: v.id("accounts"), postId: v.id("posts") },
  handler: (ctx, { accountId, postId }) => deletePostForAccount(ctx, accountId, postId),
});

/** Owner-facing delete (the gallery's expanded view). Same rules as the verb. */
export const removePost = mutation({
  args: { accountId: v.id("accounts"), postId: v.id("posts") },
  handler: async (ctx, { accountId, postId }): Promise<void> => {
    await requireOwnedAccount(ctx, accountId);
    await deletePostForAccount(ctx, accountId, postId);
  },
});

/**
 * Owner edits the caption in place — allowed until the post is actually on
 * its way out (publishing) or out (published). A scheduled post can still be
 * reworded: the owner's authority is what the approval gate protects.
 */
export const updateCaption = mutation({
  args: { accountId: v.id("accounts"), postId: v.id("posts"), caption: v.string() },
  handler: async (ctx, { accountId, postId, caption }): Promise<void> => {
    await requireOwnedAccount(ctx, accountId);
    const post = await ctx.db.get(postId);
    if (post === null || post.accountId !== accountId) throw new Error("post não encontrado");
    if (caption.length > MAX_CAPTION_CHARS) {
      throw new Error(`legenda acima do limite do Instagram (${MAX_CAPTION_CHARS} caracteres)`);
    }
    const scheduled = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .first();
    const lifecycle = scheduled?.status ?? post.status;
    if (lifecycle === "publishing" || lifecycle === "published") {
      throw new Error("post publicado não pode ser editado");
    }
    await ctx.db.patch(postId, { caption });
  },
});

export interface RailPost {
  postId: Id<"posts">;
  caption: string;
  /** Post status, superseded by the scheduled row's lifecycle when armed. */
  status: "draft" | "ready" | "scheduled" | "publishing" | "published" | "failed";
  slideCount: number;
  thumbnailUrl: string | null;
  scheduledFor: number | null;
  permalink: string | null;
  lastError: string | null;
  createdAt: number;
}

const railStatusOf = (
  post: Doc<"posts">,
  scheduled: Doc<"scheduledPosts"> | null,
): RailPost["status"] => (scheduled === null ? post.status : scheduled.status);

/** Every post of the business, newest first — the right rail's feed. */
export const listForRail = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<RailPost[]> => {
    await requireOwnedAccount(ctx, accountId);
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(60);
    return Promise.all(
      posts.map(async (post) => {
        const scheduled = await ctx.db
          .query("scheduledPosts")
          .withIndex("by_post", (q) => q.eq("postId", post._id))
          .first();
        const first = post.imageIds[0] !== undefined ? await ctx.db.get(post.imageIds[0]) : null;
        const thumbnailUrl =
          first === null || first === undefined
            ? null
            : (first.externalUrl ??
              (first.storageId !== undefined ? await ctx.storage.getUrl(first.storageId) : null));
        return {
          postId: post._id,
          caption: post.caption,
          status: railStatusOf(post, scheduled),
          slideCount: post.imageIds.length,
          thumbnailUrl,
          scheduledFor: scheduled?.scheduledFor ?? null,
          permalink: scheduled?.permalink ?? null,
          lastError: scheduled?.lastError ?? null,
          createdAt: post.createdAt,
        };
      }),
    );
  },
});

/** One post, fully resolved for the rail's detail view. */
export const detail = query({
  args: { accountId: v.id("accounts"), postId: v.id("posts") },
  handler: async (ctx, { accountId, postId }) => {
    await requireOwnedAccount(ctx, accountId);
    const post = await ctx.db.get(postId);
    if (post === null || post.accountId !== accountId) return null;
    const scheduled = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .first();
    const imageUrls = (
      await Promise.all(
        post.imageIds.map(async (imageId) => {
          const image = await ctx.db.get(imageId);
          if (image === null) return null;
          return (
            image.externalUrl ??
            (image.storageId !== undefined ? await ctx.storage.getUrl(image.storageId) : null)
          );
        }),
      )
    ).filter((url): url is string => url !== null);
    return {
      postId: post._id,
      caption: post.caption,
      status: railStatusOf(post, scheduled),
      imageUrls,
      scheduledFor: scheduled?.scheduledFor ?? null,
      permalink: scheduled?.permalink ?? null,
      lastError: scheduled?.lastError ?? null,
      createdAt: post.createdAt,
    };
  },
});
