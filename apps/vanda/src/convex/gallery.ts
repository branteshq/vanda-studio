import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import { isKnownImageModel } from "./imageModels";

/**
 * The account's creative gallery. Every generated or uploaded image lands here
 * (they already live in the `images` table scoped by account); this module is
 * the read/compose surface over them.
 *
 * The item shape is deliberately generic — a `kind` discriminator and a media
 * envelope — so posts, reels, stories, and tweets can join the same grid later
 * without reshaping the client. For now every item is `kind: "image"`.
 */

const aspectRatioValidator = v.union(
  v.literal("1:1"),
  v.literal("4:5"),
  v.literal("9:16"),
  v.literal("16:9"),
);

export interface GalleryItem {
  id: string;
  kind: "image";
  name: string | null;
  url: string | null;
  width: number | null;
  height: number | null;
  origin: Doc<"images">["origin"];
  model: string | null;
  /** Produced by editing an existing image (paint edit or run_code). */
  edited: boolean;
  createdAt: number;
  /** Generation lifecycle: "generating" placeholder, "failed", or null = ready. */
  status: "generating" | "failed" | null;
  generationError: string | null;
}

export interface GalleryItemDetail extends GalleryItem {
  prompt: string | null;
  costUsd: number | null;
  generationMs: number | null;
  mimeType: string | null;
  promptAuthor: "vanda" | "user" | null;
}

const imageUrl = (ctx: QueryCtx, image: Doc<"images">): Promise<string | null> =>
  image.externalUrl
    ? Promise.resolve(image.externalUrl)
    : image.storageId
      ? ctx.storage.getUrl(image.storageId)
      : Promise.resolve(null);

const toItem = async (ctx: QueryCtx, image: Doc<"images">): Promise<GalleryItem> => ({
  id: image._id,
  kind: "image",
  name: image.name ?? null,
  url: await imageUrl(ctx, image),
  width: image.width ?? null,
  height: image.height ?? null,
  origin: image.origin,
  model: image.model ?? null,
  edited: image.editOfImageId !== undefined || image.codeRunId !== undefined,
  createdAt: image.createdAt,
  status: image.status ?? null,
  generationError: image.generationError ?? null,
});

/** The account's gallery, newest first. Reference photos stay in the profile. */
export const list = query({
  args: { accountId: v.id("accounts"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { accountId, paginationOpts }) => {
    await requireOwnedAccount(ctx, accountId);
    const page = await ctx.db
      .query("images")
      .withIndex("by_account_created", (q) => q.eq("accountId", accountId))
      .order("desc")
      .paginate(paginationOpts);
    const items = await Promise.all(
      page.page
        .filter((image) => image.purpose !== "reference")
        .map((image) => toItem(ctx, image)),
    );
    return { ...page, page: items };
  },
});

/** One gallery item with its full generation record, for the detail view. */
export const get = query({
  args: { accountId: v.id("accounts"), imageId: v.id("images") },
  handler: async (ctx, { accountId, imageId }): Promise<GalleryItemDetail | null> => {
    await requireOwnedAccount(ctx, accountId);
    const image = await ctx.db.get(imageId);
    if (!image || image.accountId !== accountId) return null;
    return {
      ...(await toItem(ctx, image)),
      prompt: image.prompt ?? null,
      costUsd: image.costUsd ?? null,
      generationMs: image.generationMs ?? null,
      mimeType: image.mimeType ?? null,
      promptAuthor: image.promptAuthor ?? null,
    };
  },
});

/** Rename a gallery item (owner or agent). */
export const rename = mutation({
  args: { accountId: v.id("accounts"), imageId: v.id("images"), name: v.string() },
  handler: async (ctx, { accountId, imageId, name }): Promise<void> => {
    await requireOwnedAccount(ctx, accountId);
    const image = await ctx.db.get(imageId);
    if (!image || image.accountId !== accountId) throw new Error("image not found");
    const trimmed = name.trim();
    await ctx.db.patch(imageId, { name: trimmed ? trimmed.slice(0, 120) : undefined });
  },
});

/** Delete one image doc, freeing its stored bytes when nothing else links them. */
async function deleteImage(
  ctx: { db: MutationCtx["db"]; storage: MutationCtx["storage"] },
  accountId: Id<"accounts">,
  imageId: Id<"images">,
): Promise<void> {
  const image = await ctx.db.get(imageId);
  if (!image || image.accountId !== accountId) throw new Error("image not found");
  if (image.storageId) {
    const stillLinked = await ctx.db
      .query("images")
      .withIndex("by_storage", (q) => q.eq("storageId", image.storageId))
      .filter((q) => q.neq(q.field("_id"), imageId))
      .first();
    if (stillLinked === null) await ctx.storage.delete(image.storageId);
  }
  await ctx.db.delete(imageId);
}

/** Remove a gallery item, freeing its stored bytes when nothing else links them. */
export const remove = mutation({
  args: { accountId: v.id("accounts"), imageId: v.id("images") },
  handler: async (ctx, { accountId, imageId }): Promise<void> => {
    await requireOwnedAccount(ctx, accountId);
    await deleteImage(ctx, accountId, imageId);
  },
});

const MAX_BULK_REMOVE = 100;

/** Bulk removal for the gallery's multi-select. Sequential so shared storage
 *  blobs are only freed once no surviving doc links them. */
export const removeMany = mutation({
  args: { accountId: v.id("accounts"), imageIds: v.array(v.id("images")) },
  handler: async (ctx, { accountId, imageIds }): Promise<void> => {
    await requireOwnedAccount(ctx, accountId);
    if (imageIds.length > MAX_BULK_REMOVE) {
      throw new Error(`máximo de ${MAX_BULK_REMOVE} imagens por exclusão`);
    }
    for (const imageId of imageIds) {
      await deleteImage(ctx, accountId, imageId);
    }
  },
});

const MAX_GENERATION_FANOUT = 12;

/**
 * Manual generation from the gallery canvas: fan out one `paint` per
 * (model × image). Each completes independently and streams into the grid via
 * the reactive `list` query. This is the human-driven surface over the same
 * `paint` primitive Vanda drives from chat.
 */
export const generate = mutation({
  args: {
    accountId: v.id("accounts"),
    prompt: v.string(),
    modelIds: v.array(v.string()),
    aspectRatio: aspectRatioValidator,
    count: v.number(),
    resolution: v.optional(v.union(v.literal("1K"), v.literal("2K"), v.literal("4K"))),
    referenceImageIds: v.optional(v.array(v.id("images"))),
    editOfImageId: v.optional(v.id("images")),
  },
  handler: async (
    ctx,
    { accountId, prompt, modelIds, aspectRatio, count, resolution, referenceImageIds, editOfImageId },
  ): Promise<{ scheduled: number }> => {
    await requireOwnedAccount(ctx, accountId);
    const trimmed = prompt.trim();
    if (!trimmed) throw new Error("prompt vazio");
    const models = modelIds.filter(isKnownImageModel);
    if (models.length === 0) throw new Error("nenhum modelo válido selecionado");
    const perModel = Math.max(1, Math.floor(count));
    const total = models.length * perModel;
    if (total > MAX_GENERATION_FANOUT) {
      throw new Error(`máximo de ${MAX_GENERATION_FANOUT} imagens por geração`);
    }
    // Placeholder dimensions only drive the skeleton's aspect ratio in the grid;
    // the real dimensions overwrite them when the paint lands.
    const [ratioWidth, ratioHeight] = RATIO_DIMS[aspectRatio];
    for (const model of models) {
      for (let i = 0; i < perModel; i += 1) {
        // The grid shows this row as a skeleton immediately; paint fills it in
        // place on success or marks it failed.
        const placeholderImageId = await ctx.db.insert("images", {
          accountId,
          origin: "generated",
          purpose: "post",
          prompt: trimmed,
          model,
          promptAuthor: "user",
          status: "generating",
          width: ratioWidth,
          height: ratioHeight,
          createdAt: Date.now(),
        });
        await ctx.scheduler.runAfter(0, internal.images.paint, {
          accountId,
          prompt: trimmed,
          aspectRatio,
          model,
          promptAuthor: "user",
          placeholderImageId,
          // paint clamps per model, so a mixed selection degrades gracefully.
          ...(resolution ? { resolution } : {}),
          ...(referenceImageIds && referenceImageIds.length > 0 ? { referenceImageIds } : {}),
          ...(editOfImageId ? { editOfImageId } : {}),
        });
      }
    }
    return { scheduled: total };
  },
});

const RATIO_DIMS: Record<"1:1" | "4:5" | "9:16" | "16:9", readonly [number, number]> = {
  "1:1": [1024, 1024],
  "4:5": [1024, 1280],
  "9:16": [720, 1280],
  "16:9": [1280, 720],
};
