import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export async function resolveMessageImages(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  imageIds: ReadonlyArray<Id<"images">>,
) {
  const uniqueIds = [...new Set(imageIds)];
  if (uniqueIds.length > 4) throw new Error("too many image attachments");
  return Promise.all(
    uniqueIds.map(async (imageId) => {
      const image = await ctx.db.get(imageId);
      if (!image || image.accountId !== accountId) throw new Error("image not found");
      if (image.mimeType && !image.mimeType.startsWith("image/")) {
        throw new Error("only image attachments are supported");
      }
      const url =
        image.externalUrl ?? (image.storageId ? await ctx.storage.getUrl(image.storageId) : null);
      if (!url) throw new Error("image URL is unavailable");
      return { imageId: image._id, url, mimeType: image.mimeType ?? "image/jpeg" };
    }),
  );
}
