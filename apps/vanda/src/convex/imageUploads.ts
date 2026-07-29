import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireOwnedAccount, requireUser } from "./authz";

/** Short-lived upload URL for composer image attachments. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/** Link an uploaded image to an account as a loose, reusable media asset. */
export const addImage = mutation({
  args: {
    accountId: v.id("accounts"),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (ctx, { accountId, storageId, mimeType, width, height }) => {
    await requireOwnedAccount(ctx, accountId);
    if (!mimeType.startsWith("image/")) throw new Error("only image attachments are supported");
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("upload not found");

    const existing = await ctx.db
      .query("images")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (existing) {
      if (existing.accountId !== accountId) throw new Error("image not found");
      return { imageId: existing._id, url };
    }

    const imageId = await ctx.db.insert("images", {
      accountId,
      origin: "uploaded",
      purpose: "post",
      storageId,
      mimeType,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      createdAt: Date.now(),
    });
    return { imageId, url };
  },
});

/** Remove an unsent loose upload from both storage and the account's asset rows. */
export const removeImage = mutation({
  args: { accountId: v.id("accounts"), imageId: v.id("images") },
  handler: async (ctx, { accountId, imageId }) => {
    await requireOwnedAccount(ctx, accountId);
    const image = await ctx.db.get(imageId);
    if (
      !image ||
      image.accountId !== accountId ||
      image.origin !== "uploaded" ||
      image.purpose !== "post" ||
      image.contentProjectId !== undefined ||
      image.carouselDocumentId !== undefined
    ) {
      throw new Error("image not found");
    }
    if (image.storageId) await ctx.storage.delete(image.storageId);
    await ctx.db.delete(imageId);
  },
});
