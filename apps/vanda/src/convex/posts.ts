import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import { postPurposeValidator } from "./postPurposes";
import { postFormats, type postTypes } from "./pipeline/constants";

/**
 * THE post path: gallery image(s) + caption → draft → schedule → publish.
 * A carousel is just a post with more images; produced work differs only in
 * how its images get made (paint or upload), never in how it publishes.
 */

const MAX_POST_IMAGES = 10;

export const MAX_CAPTION_CHARS = 2200;

const MAX_RATIONALE_CHARS = 400;

// Providers round pixel sizes; 3% still separates 4:5 (0.8) from 3:4 (0.75).
const FORMAT_TOLERANCE = 0.03;

// Instagram's feed takes any ratio from 4:5 portrait to 1.91:1 landscape.
const FEED_RATIO = { min: 0.8, max: 1.91 } as const;

const ratioOff = (ratio: number, target: number) => Math.abs(ratio / target - 1) > FORMAT_TOLERANCE;

/** Create a draft post from account-owned gallery images. */
export const createPostInternal = internalMutation({
  args: {
    accountId: v.id("accounts"),
    imageIds: v.array(v.id("images")),
    caption: v.string(),
    originThreadId: v.optional(v.string()),
    caetanoThreadId: v.optional(v.string()),
    // Chosen format; without it the type is inferred from the image count.
    type: v.optional(v.union(v.literal("image"), v.literal("carousel"), v.literal("story"))),
    // Aspect ratio of every image; story must be 9:16, image/carousel never.
    format: v.optional(v.union(...postFormats.map((format) => v.literal(format)))),
    purpose: v.optional(postPurposeValidator),
    secondaryPurpose: v.optional(postPurposeValidator),
    rationale: v.optional(v.string()),
    // Set only by the autopilot producer; chat posts stay manual.
    autopilotSlotId: v.optional(v.id("autopilotSlots")),
  },
  handler: async (
    ctx,
    {
      accountId,
      imageIds,
      caption,
      originThreadId,
      caetanoThreadId,
      type,
      format,
      purpose,
      secondaryPurpose,
      rationale,
      autopilotSlotId,
    },
  ): Promise<Id<"posts">> => {
    if (imageIds.length < 1 || imageIds.length > MAX_POST_IMAGES) {
      throw new Error(
        `um post precisa de 1 a ${MAX_POST_IMAGES} imagens (recebi ${imageIds.length})`,
      );
    }

    if (caption.trim() === "") throw new Error("a legenda não pode ser vazia");

    if (secondaryPurpose !== undefined && purpose === undefined) {
      throw new Error("propósito secundário exige um propósito principal");
    }

    if (secondaryPurpose !== undefined && secondaryPurpose === purpose) {
      throw new Error("o propósito secundário deve ser diferente do principal");
    }

    const trimmedRationale = rationale?.trim();

    if (trimmedRationale !== undefined && purpose === undefined) {
      throw new Error("a justificativa exige um propósito");
    }

    if (trimmedRationale !== undefined && trimmedRationale.length > MAX_RATIONALE_CHARS) {
      throw new Error(`justificativa acima de ${MAX_RATIONALE_CHARS} caracteres`);
    }

    if (type === "carousel" && imageIds.length < 2) {
      throw new Error(
        `carrossel precisa de 2 a ${MAX_POST_IMAGES} imagens (recebi ${imageIds.length})`,
      );
    }

    if ((type === "image" || type === "story") && imageIds.length !== 1) {
      throw new Error(`${type} precisa de exatamente 1 imagem (recebi ${imageIds.length})`);
    }

    if (format !== undefined && type === undefined) throw new Error("format exige um type");

    if (format !== undefined && (type === "story") !== (format === "9:16")) {
      throw new Error(
        type === "story" ? "story é sempre 9:16" : `${type} não usa 9:16; 9:16 é só para story`,
      );
    }

    if (caption.length > MAX_CAPTION_CHARS) {
      throw new Error(`legenda acima do limite do Instagram (${MAX_CAPTION_CHARS} caracteres)`);
    }

    let shared: { ratio: number; size: string } | undefined;

    for (const imageId of imageIds) {
      const image = await ctx.db.get(imageId);

      if (image === null || image.accountId !== accountId) {
        throw new Error(`imagem ${imageId} não encontrada nesta conta`);
      }

      if (!format || !image.width || !image.height) continue;
      const [w = 1, h = 1] = format.split(":").map(Number);
      const ratio = image.width / image.height;
      const size = `${image.width}×${image.height}`;

      // A ready photo (upload, gallery) keeps its own feed-valid ratio: there is no
      // crop tool, and repainting it to fit the list would change the photo.
      const readyPhoto =
        image.origin !== "generated" &&
        type !== "story" &&
        ratio >= FEED_RATIO.min * (1 - FORMAT_TOLERANCE) &&
        ratio <= FEED_RATIO.max * (1 + FORMAT_TOLERANCE);

      if (ratioOff(ratio, w / h) && !readyPhoto) {
        throw new Error(
          `imagem ${imageId} é ${size}, não ${format}; todas as imagens do post precisam do mesmo format`,
        );
      }

      if (shared && ratioOff(ratio, shared.ratio)) {
        throw new Error(
          `imagem ${imageId} é ${size} e a anterior é ${shared.size}; todas as imagens do post precisam do mesmo format`,
        );
      }

      shared ??= { ratio, size };
    }

    const resolvedType: (typeof postTypes)[number] =
      type ?? (imageIds.length > 1 ? "carousel" : "image");

    const post: Omit<Doc<"posts">, "_id" | "_creationTime"> = {
      accountId,
      type: resolvedType,
      imageIds,
      caption,
      platform: "instagram",
      status: "draft",
      createdAt: Date.now(),
    };

    if (originThreadId) post.originThreadId = originThreadId;

    if (caetanoThreadId) post.caetanoThreadId = caetanoThreadId;

    if (format) post.format = format;

    if (purpose) post.purpose = purpose;

    if (secondaryPurpose) post.secondaryPurpose = secondaryPurpose;

    if (trimmedRationale) post.rationale = trimmedRationale;

    if (autopilotSlotId) {
      post.origin = "autopilot";
      post.autopilotSlotId = autopilotSlotId;
    }

    return ctx.db.insert("posts", post);
  },
});

/**
 * Approved commit: pin the post to a datetime and arm the publisher. A post
 * that is already scheduled (and hasn't started publishing) is RE-AIMED —
 * the old scheduler job is disarmed and the new time armed — so "muda para
 * amanhã às 8h" is one approved call, never a duplicate. Shared with the
 * autopilot, which schedules inside its own slot transaction.
 */
export const schedulePostIn = async (
  ctx: MutationCtx,
  {
    accountId,
    postId,
    scheduledFor,
    originThreadId,
    caetanoThreadId,
  }: {
    accountId: Id<"accounts">;
    postId: Id<"posts">;
    scheduledFor?: number | undefined;
    originThreadId?: string | undefined;
    caetanoThreadId?: string | undefined;
  },
): Promise<{
  scheduledPostId: Id<"scheduledPosts">;
  scheduledFor: number;
  rescheduled: boolean;
}> => {
  const post = await ctx.db.get(postId);

  if (post === null || post.accountId !== accountId) throw new Error("post não encontrado");

  if (post.type === "story") {
    throw new Error(
      "stories ainda não são publicados pelo Vanda — o rascunho fica no calendário para você publicar pelo Instagram",
    );
  }

  const at = scheduledFor ?? Date.now() + 5_000;
  const now = Date.now();

  if (originThreadId || caetanoThreadId) {
    const patch: Pick<Partial<Doc<"posts">>, "originThreadId" | "caetanoThreadId"> = {};

    if (originThreadId) patch.originThreadId = originThreadId;

    if (caetanoThreadId) patch.caetanoThreadId = caetanoThreadId;
    await ctx.db.patch(postId, patch);
  }

  const existing = await ctx.db
    .query("scheduledPosts")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .first();

  if (existing !== null) {
    if (existing.status !== "scheduled") {
      throw new Error(`post já está ${existing.status} — não dá mais para reagendar`);
    }

    if (existing.scheduledJobId !== undefined) await ctx.scheduler.cancel(existing.scheduledJobId);

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
};

export const schedulePostInternal = internalMutation({
  args: {
    accountId: v.id("accounts"),
    postId: v.id("posts"),
    scheduledFor: v.optional(v.number()),
    originThreadId: v.optional(v.string()),
    caetanoThreadId: v.optional(v.string()),
  },
  handler: (ctx, args) => schedulePostIn(ctx, args),
});

/** Disarm a pending schedule — the safe direction, back to draft. */
export const cancelScheduleIn = async (
  ctx: MutationCtx,
  { accountId, postId }: { accountId: Id<"accounts">; postId: Id<"posts"> },
): Promise<void> => {
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

  if (scheduled.scheduledJobId !== undefined) await ctx.scheduler.cancel(scheduled.scheduledJobId);
  await ctx.db.delete(scheduled._id);
  await ctx.db.patch(postId, { status: "draft" });
};

export const cancelScheduleInternal = internalMutation({
  args: { accountId: v.id("accounts"), postId: v.id("posts") },
  handler: (ctx, args) => cancelScheduleIn(ctx, args),
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
  /** Set when the Piloto automático made it: the rail marks it and opens its slot. */
  autopilotSlotId: Id<"autopilotSlots"> | null;
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
          autopilotSlotId: post.autopilotSlotId ?? null,
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
      autopilotSlotId: post.autopilotSlotId ?? null,
      createdAt: post.createdAt,
    };
  },
});
