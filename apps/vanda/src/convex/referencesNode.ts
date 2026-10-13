"use node";

import { Jimp } from "jimp";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  downloadImage,
  normalizeLabels,
  referenceAuthorValidator,
  referenceLabelValidator,
  type ReferenceSaved,
} from "./references";

/** A crop box in fractions of the image (0–1), as the agent reads it off the pixels. */
export const cropBoxValidator = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

export type CropBox = { x: number; y: number; width: number; height: number };

/** Smallest side a crop keeps: anything less is no use to the image model. */
const MIN_CROP_SIDE = 96;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** The pixel rectangle of a fractional box, clamped inside the image. */
export function cropPixels(box: CropBox, size: { width: number; height: number }) {
  const left = clamp(box.x);
  const top = clamp(box.y);
  const right = clamp(box.x + box.width);
  const bottom = clamp(box.y + box.height);

  const x = Math.round(left * size.width);
  const y = Math.round(top * size.height);
  const w = Math.round((right - left) * size.width);
  const h = Math.round((bottom - top) * size.height);

  if (w < MIN_CROP_SIDE || h < MIN_CROP_SIDE)
    throw new Error(
      `recorte pequeno demais (${w}×${h} px); use uma caixa maior, em frações de 0 a 1 da imagem`,
    );

  return { x, y, w, h };
}

/**
 * Save part of an image as a new reference: the owner's face out of a finished
 * feed post, so the image model gets the person without the post's layout. The
 * source is an account image or an Instagram post read recently; it stays as it was.
 */
export const saveCrop = internalAction({
  args: {
    accountId: v.id("accounts"),
    imageId: v.optional(v.id("images")),
    post: v.optional(v.string()),
    crop: cropBoxValidator,
    labels: v.array(referenceLabelValidator),
    note: v.optional(v.string()),
    addedBy: referenceAuthorValidator,
  },
  handler: async (ctx, args): Promise<ReferenceSaved & { croppedFrom: string }> => {
    let url: string;
    let from: string;
    let name: string | null;

    if (args.imageId !== undefined) {
      const source = await ctx.runQuery(internal.references.cropSource, {
        accountId: args.accountId,
        imageId: args.imageId,
      });

      url = source.url;
      from = source.source ?? `imagem ${args.imageId}`;
      name = source.name;
    } else if (args.post !== undefined) {
      const media = await ctx.runQuery(internal.references.instagramMedia, {
        accountId: args.accountId,
        post: args.post,
      });

      if (!media)
        throw new Error(
          "post não encontrado nas leituras recentes: leia-o antes com read_instagram_posts (ou read_instagram_post) e passe o id ou a URL dele",
        );

      url = media.mediaUrl;
      from = `${media.handle} · ${media.postUrl ?? media.postId}`;
      name = media.caption ? `${media.handle} · ${media.caption}` : null;
    } else throw new Error("informe imageId ou instagramPost para recortar");

    const { bytes } = await downloadImage(url);
    const image = await Jimp.read(Buffer.from(bytes));
    const box = cropPixels(args.crop, { width: image.bitmap.width, height: image.bitmap.height });
    image.crop(box);

    const mimeType = "image/jpeg";
    const cropped = new Uint8Array(await image.getBuffer(mimeType, { quality: 92 }));
    const storageId = await ctx.storage.store(new Blob([cropped], { type: mimeType }));

    const imageId = await ctx.runMutation(internal.references.insertImported, {
      accountId: args.accountId,
      storageId,
      mimeType,
      width: box.w,
      height: box.h,
      name: `Recorte · ${name ?? from}`,
      labels: args.labels,
      source: `recorte de ${from}`,
      addedBy: args.addedBy,
      ...(args.note !== undefined && { note: args.note }),
    });

    return { imageId, labels: normalizeLabels(args.labels), croppedFrom: from };
  },
});
