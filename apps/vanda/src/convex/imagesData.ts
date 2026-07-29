import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";

const loadOwnedImage = async (ctx: QueryCtx, accountId: Id<"accounts">, imageId: Id<"images">) => {
  const image = await ctx.db.get(imageId);
  if (!image || image.accountId !== accountId) throw new Error("image not found");
  return image;
};

/** Resolve rows only after enforcing account ownership and reference purpose. */
export const resolvePaintInput = internalQuery({
  args: {
    accountId: v.id("accounts"),
    referenceImageIds: v.array(v.id("images")),
    editOfImageId: v.optional(v.id("images")),
  },
  handler: async (ctx, { accountId, referenceImageIds, editOfImageId }) => {
    if (!(await ctx.db.get(accountId))) throw new Error("account not found");

    const references = await Promise.all(
      referenceImageIds.map(async (imageId) => {
        const image = await loadOwnedImage(ctx, accountId, imageId);
        if (image.purpose !== "reference") throw new Error("image is not an authorized reference");
        return {
          imageId: image._id,
          externalUrl: image.externalUrl ?? null,
          storageId: image.storageId ?? null,
          referenceKind: image.referenceKind ?? null,
        };
      }),
    );

    const editSource = editOfImageId
      ? await loadOwnedImage(ctx, accountId, editOfImageId).then((image) => ({
          imageId: image._id,
          externalUrl: image.externalUrl ?? null,
          storageId: image.storageId ?? null,
        }))
      : null;

    return { references, editSource };
  },
});

/** Record a reviewed loose image asset; it intentionally has no post/project link. */
export const savePaintedImage = internalMutation({
  args: {
    accountId: v.id("accounts"),
    storageId: v.id("_storage"),
    prompt: v.string(),
    mimeType: v.string(),
    width: v.number(),
    height: v.number(),
    visualDescription: v.string(),
    containsText: v.boolean(),
    containsFace: v.boolean(),
    safeForBrandUse: v.boolean(),
    inspectionWarnings: v.array(v.string()),
    inspectionConfidence: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.accountId))) throw new Error("account not found");
    return ctx.db.insert("images", {
      accountId: args.accountId,
      origin: "generated",
      purpose: "post",
      storageId: args.storageId,
      prompt: args.prompt,
      mimeType: args.mimeType,
      width: args.width,
      height: args.height,
      description: args.visualDescription,
      altText: args.visualDescription,
      inspectionStatus: "ready",
      visualDescription: args.visualDescription,
      containsText: args.containsText,
      containsFace: args.containsFace,
      safeForBrandUse: args.safeForBrandUse,
      inspectionWarnings: args.inspectionWarnings,
      inspectionConfidence: args.inspectionConfidence,
      inspectedAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});
