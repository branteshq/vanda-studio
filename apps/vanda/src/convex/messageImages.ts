import { z } from "zod";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const imagePreviewSchema = z.object({
  imageId: z.string(),
  url: z.string().url(),
  mimeType: z.string(),
});

export const imageModelOutput = (image: z.infer<typeof imagePreviewSchema>) => ({
  type: "content" as const,
  value: [
    {
      type: "text" as const,
      text: `imageId=${image.imageId}. Inspecione a imagem antes de entregar.`,
    },
    {
      type: "image-url" as const,
      url: image.url,
    },
  ],
});

export const messageWithImages = (
  text: string,
  images: ReadonlyArray<z.infer<typeof imagePreviewSchema>>,
) => [
  {
    type: "text" as const,
    text: [
      text,
      ...(images.length
        ? [
            `<vanda_attachment_context>Imagens anexadas pelo usuário, já pertencentes a esta conta: ${images.map((image) => `imageId=${image.imageId}`).join(", ")}. Use esses IDs nas ferramentas; para editar, passe o ID em editOfImageId.</vanda_attachment_context>`,
          ]
        : []),
    ].join("\n\n"),
  },
  ...images.map((image) => ({
    type: "image" as const,
    image: image.url,
    mediaType: image.mimeType,
  })),
];

export async function resolveMessageImages(
  ctx: MutationCtx | QueryCtx,
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
