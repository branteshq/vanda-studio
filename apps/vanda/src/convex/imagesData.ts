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
        // Account ownership is the boundary — any image the account owns (an
        // attached upload, a painted asset, or a Perfil reference) may condition
        // generation. The model can only reproduce a person's likeness from a
        // photo already in this account, so `purpose` is not a security gate.
        const image = await loadOwnedImage(ctx, accountId, imageId);
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

/** Record a loose painted image asset; it intentionally has no post/project link. */
export const savePaintedImage = internalMutation({
  args: {
    accountId: v.id("accounts"),
    storageId: v.id("_storage"),
    prompt: v.string(),
    mimeType: v.string(),
    width: v.number(),
    height: v.number(),
    model: v.optional(v.string()),
    costUsd: v.optional(v.number()),
    generationMs: v.optional(v.number()),
    name: v.optional(v.string()),
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
      description: args.prompt,
      altText: args.name ?? args.prompt,
      ...(args.name ? { name: args.name } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.costUsd !== undefined ? { costUsd: args.costUsd } : {}),
      ...(args.generationMs !== undefined ? { generationMs: args.generationMs } : {}),
      createdAt: Date.now(),
    });
  },
});
