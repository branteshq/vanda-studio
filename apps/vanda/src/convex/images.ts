"use node";

import { Jimp } from "jimp";
import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import {
  ImageAssetGenerator,
  openRouterImageGeneratorLayer,
} from "./pipeline/imageGeneration";

const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2";

const aspectRatioValidator = v.union(
  v.literal("1:1"),
  v.literal("4:5"),
  v.literal("9:16"),
  v.literal("16:9"),
);
type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9";

/** Nearest explicit sizes accepted by OpenRouter's dedicated Images API. */
const GENERATION_SIZE: Record<AspectRatio, string> = {
  "1:1": "1024x1024",
  "4:5": "1024x1536",
  "9:16": "1024x1536",
  "16:9": "1536x1024",
};

const RATIO_PARTS: Record<AspectRatio, readonly [width: number, height: number]> = {
  "1:1": [1, 1],
  "4:5": [4, 5],
  "9:16": [9, 16],
  "16:9": [16, 9],
};

const bytesBlob = (bytes: Uint8Array, mimeType: string): Blob => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mimeType });
};

type ResolvedSource = {
  readonly externalUrl: string | null;
  readonly storageId: Id<"_storage"> | null;
};

const resolveSourceUrl = async (ctx: ActionCtx, source: ResolvedSource): Promise<string> => {
  if (source.externalUrl) return source.externalUrl;
  if (source.storageId) {
    const url = await ctx.storage.getUrl(source.storageId);
    if (url) return url;
  }
  throw new Error("image has no resolvable URL");
};

/** Largest centered integer crop with the exact requested ratio. */
const cropToAspectRatio = (image: Awaited<ReturnType<typeof Jimp.read>>, ratio: AspectRatio) => {
  const [ratioWidth, ratioHeight] = RATIO_PARTS[ratio];
  const scale = Math.min(
    Math.floor(image.bitmap.width / ratioWidth),
    Math.floor(image.bitmap.height / ratioHeight),
  );
  if (scale < 1) throw new Error("generated image is too small to crop");
  const width = scale * ratioWidth;
  const height = scale * ratioHeight;
  const x = Math.floor((image.bitmap.width - width) / 2);
  const y = Math.floor((image.bitmap.height - height) / 2);
  image.crop({ x, y, w: width, h: height });
  return { width, height };
};

/**
 * Generate one loose image asset for an account. This is the image primitive:
 * callers never reach the model or storage independently. There is no hidden
 * editorial review — the orchestrator and the human judge the result.
 */
export const paint = internalAction({
  args: {
    accountId: v.id("accounts"),
    prompt: v.string(),
    aspectRatio: aspectRatioValidator,
    referenceImageIds: v.optional(v.array(v.id("images"))),
    editOfImageId: v.optional(v.id("images")),
    model: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { accountId, prompt, aspectRatio, referenceImageIds, editOfImageId, model },
  ): Promise<{
    imageId: Id<"images">;
    url: string;
    mimeType: string;
    width: number;
    height: number;
  }> => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) throw new Error("image prompt is empty");

    // Identity wall: account ownership and reference authorization are checked
    // in a database query before any URL reaches the image model.
    const resolved = await ctx.runQuery(internal.imagesData.resolvePaintInput, {
      accountId,
      referenceImageIds: referenceImageIds ?? [],
      ...(editOfImageId ? { editOfImageId } : {}),
    });
    const referenceUrls = await Promise.all(
      resolved.references.map((reference) => resolveSourceUrl(ctx, reference)),
    );
    const editUrl = resolved.editSource
      ? await resolveSourceUrl(ctx, resolved.editSource)
      : undefined;
    const inputReferences = [...new Set([editUrl, ...referenceUrls].filter(Boolean))] as string[];

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    const selectedModel = model ?? DEFAULT_IMAGE_MODEL;

    const generated = await Effect.runPromise(
      Effect.flatMap(ImageAssetGenerator, (generator) =>
        generator.generate({
          prompt: trimmedPrompt,
          size: GENERATION_SIZE[aspectRatio],
          ...(inputReferences.length > 0 ? { referenceUrls: inputReferences } : {}),
        }),
      ).pipe(Effect.provide(openRouterImageGeneratorLayer({ apiKey, model: selectedModel }))),
    );

    const image = await Jimp.read(Buffer.from(generated.bytes));
    const { width, height } = cropToAspectRatio(image, aspectRatio);
    const mimeType = generated.mimeType === "image/png" ? "image/png" : "image/jpeg";
    const outputBytes =
      mimeType === "image/png"
        ? new Uint8Array(await image.getBuffer("image/png"))
        : new Uint8Array(await image.getBuffer("image/jpeg", { quality: 90 }));
    const storageId = await ctx.storage.store(bytesBlob(outputBytes, mimeType));
    const imageId = await ctx.runMutation(internal.imagesData.savePaintedImage, {
      accountId,
      storageId,
      prompt: trimmedPrompt,
      mimeType,
      width,
      height,
    });
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("stored image URL is unavailable");
    return { imageId, url, mimeType, width, height };
  },
});
