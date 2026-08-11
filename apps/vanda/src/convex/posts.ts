import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query } from "./_generated/server";
import { requireOwnedAccount } from "./authz";

/**
 * The lightweight post path: gallery image(s) + caption → draft → approved
 * schedule → the same publish rails carousels use. The heavyweight sibling
 * (create_carousel → publish_project) stays for produced multi-slide work;
 * these verbs exist so "posta essa foto com essa legenda" is proportionate.
 */

const MAX_POST_IMAGES = 10;
export const MAX_CAPTION_CHARS = 2200;

/** Create a draft post from account-owned gallery images. */
export const createPostInternal = internalMutation({
  args: {
    accountId: v.id("accounts"),
    imageIds: v.array(v.id("images")),
    caption: v.string(),
  },
  handler: async (ctx, { accountId, imageIds, caption }): Promise<Id<"posts">> => {
    if (imageIds.length < 1 || imageIds.length > MAX_POST_IMAGES) {
      throw new Error(`um post precisa de 1 a ${MAX_POST_IMAGES} imagens (recebi ${imageIds.length})`);
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
      type: imageIds.length > 1 ? "feed" : "image",
      imageIds,
      caption,
      platform: "instagram",
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

/** Approved commit: pin the draft to a datetime and arm the publisher. */
export const schedulePostInternal = internalMutation({
  args: {
    accountId: v.id("accounts"),
    postId: v.id("posts"),
    scheduledFor: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { accountId, postId, scheduledFor },
  ): Promise<{ scheduledPostId: Id<"scheduledPosts">; scheduledFor: number }> => {
    const post = await ctx.db.get(postId);
    if (post === null || post.accountId !== accountId) throw new Error("post não encontrado");
    if (post.status !== "draft" && post.status !== "ready") {
      throw new Error(`post já está ${post.status}`);
    }
    const existing = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .first();
    if (existing !== null) throw new Error("post já tem uma publicação agendada");
    const at = scheduledFor ?? Date.now() + 5_000;
    const now = Date.now();
    const scheduledPostId = await ctx.db.insert("scheduledPosts", {
      accountId,
      postId,
      scheduledFor: at,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(postId, { status: "scheduled" });
    await ctx.scheduler.runAt(at, internal.publishScheduledNode.runScheduledPost, {
      scheduledPostId,
    });
    return { scheduledPostId, scheduledFor: at };
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
  contentProjectId: Id<"contentProjects"> | null;
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
          contentProjectId: post.contentProjectId ?? null,
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
      contentProjectId: post.contentProjectId ?? null,
      createdAt: post.createdAt,
    };
  },
});
