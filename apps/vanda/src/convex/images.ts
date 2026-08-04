"use node";

import { Jimp } from "jimp";
import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { ImageAssetGenerator, openRouterImageGeneratorLayer } from "./pipeline/imageGeneration";
import { MAX_DECODE_PIXELS, sniffImage } from "./pipeline/imageBytes";
import {
  DEFAULT_IMAGE_MODEL,
  clampResolution,
  isKnownImageModel,
  type ImageResolution,
} from "./imageModels";

const aspectRatioValidator = v.union(
  v.literal("1:1"),
  v.literal("4:5"),
  v.literal("9:16"),
  v.literal("16:9"),
);
type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9";

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
    name: v.optional(v.string()),
    promptAuthor: v.optional(v.union(v.literal("vanda"), v.literal("user"))),
    // Output tier. Clamped to what the model actually supports; default 1K.
    resolution: v.optional(v.union(v.literal("1K"), v.literal("2K"), v.literal("4K"))),
    // Pre-inserted "generating" gallery row to fill (success) or mark (failure).
    placeholderImageId: v.optional(v.id("images")),
    // Chat paints carry their thread so the owner's stop cancels them mid-flight.
    threadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    imageId: Id<"images">;
    url: string;
    mimeType: string;
    width: number;
    height: number;
  }> => {
    try {
      return await paintImage(ctx, args);
    } catch (error) {
      if (args.placeholderImageId) {
        await ctx.runMutation(internal.imagesData.markPaintFailed, {
          imageId: args.placeholderImageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  },
});

async function paintImage(
  ctx: ActionCtx,
  {
    accountId,
    prompt,
    aspectRatio,
    referenceImageIds,
    editOfImageId,
    model,
    name,
    promptAuthor,
    resolution,
    placeholderImageId,
    threadId,
  }: {
    accountId: Id<"accounts">;
    prompt: string;
    aspectRatio: AspectRatio;
    referenceImageIds?: Id<"images">[] | undefined;
    editOfImageId?: Id<"images"> | undefined;
    model?: string | undefined;
    name?: string | undefined;
    promptAuthor?: "vanda" | "user" | undefined;
    resolution?: ImageResolution | undefined;
    placeholderImageId?: Id<"images"> | undefined;
    threadId?: string | undefined;
  },
): Promise<{
  imageId: Id<"images">;
  url: string;
  mimeType: string;
  width: number;
  height: number;
}> {
  {
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
    if (model && !isKnownImageModel(model)) throw new Error(`unknown image model: ${model}`);
    const selectedModel = model ?? DEFAULT_IMAGE_MODEL;
    // Never ask a model for a tier it can't produce — clamp to its best.
    const tier = clampResolution(selectedModel, resolution ?? "1K");

    // Cooperative stop for chat paints: the owner's stop button deletes the
    // thread's activity row; a watcher polls it and aborts the provider fetch
    // mid-flight. (Streams can't signal us here — no deltas flow during tools.)
    const abort = new AbortController();
    let cancelled = false;
    const watcher = threadId
      ? setInterval(() => {
          ctx
            .runQuery(internal.chat.threadHasActivity, { accountId, threadId })
            .then((active) => {
              if (!active) {
                cancelled = true;
                abort.abort();
              }
            })
            .catch(() => {});
        }, 2500)
      : undefined;

    const startedAt = Date.now();
    let generated;
    try {
      generated = await Effect.runPromise(
        Effect.flatMap(ImageAssetGenerator, (generator) =>
          generator.generate({
            prompt: trimmedPrompt,
            aspectRatio,
            // 1K is every provider's default; sending the param only when
            // raising keeps models without the knob (gpt-image, flux) happy.
            ...(tier !== "1K" ? { resolution: tier } : {}),
            ...(inputReferences.length > 0 ? { referenceUrls: inputReferences } : {}),
            signal: abort.signal,
          }),
        ).pipe(Effect.provide(openRouterImageGeneratorLayer({ apiKey, model: selectedModel }))),
      );
    } catch (error) {
      if (cancelled) throw new Error("geração interrompida pelo dono", { cause: error });
      throw error;
    } finally {
      if (watcher) clearInterval(watcher);
    }
    // The generation may have finished in the polling gap — never save a
    // result the owner already walked away from.
    if (
      cancelled ||
      (threadId && !(await ctx.runQuery(internal.chat.threadHasActivity, { accountId, threadId })))
    ) {
      throw new Error("geração interrompida pelo dono");
    }
    const generationMs = Date.now() - startedAt;

    // The provider was asked for this exact aspect ratio, so the center-crop is
    // only insurance. Sniff dimensions from the header: when the ratio already
    // matches (or the image is too big to decode within the action's memory
    // cap — a 4K bitmap alone is ~67MB), store the original bytes untouched.
    const [ratioWidth, ratioHeight] = RATIO_PARTS[aspectRatio];
    const targetRatio = ratioWidth / ratioHeight;
    const sniffed = sniffImage(generated.bytes);
    const ratioMatches =
      sniffed !== null && Math.abs(sniffed.width / sniffed.height - targetRatio) / targetRatio < 0.01;
    const tooBigToDecode = sniffed !== null && sniffed.width * sniffed.height > MAX_DECODE_PIXELS;

    let width: number;
    let height: number;
    let mimeType: string;
    let outputBytes: Uint8Array;
    if (sniffed && (ratioMatches || tooBigToDecode)) {
      // Off-ratio but huge: an uncropped 4K beats an OOM-killed action.
      ({ width, height } = sniffed);
      mimeType = generated.mimeType === "image/png" ? "image/png" : "image/jpeg";
      outputBytes = generated.bytes;
    } else {
      const image = await Jimp.read(Buffer.from(generated.bytes));
      ({ width, height } = cropToAspectRatio(image, aspectRatio));
      mimeType = generated.mimeType === "image/png" ? "image/png" : "image/jpeg";
      outputBytes =
        mimeType === "image/png"
          ? new Uint8Array(await image.getBuffer("image/png"))
          : new Uint8Array(await image.getBuffer("image/jpeg", { quality: 90 }));
    }
    const storageId = await ctx.storage.store(bytesBlob(outputBytes, mimeType));
    const imageId = await ctx.runMutation(internal.imagesData.savePaintedImage, {
      accountId,
      storageId,
      prompt: trimmedPrompt,
      mimeType,
      width,
      height,
      model: selectedModel,
      generationMs,
      ...(name && name.trim() ? { name: name.trim() } : {}),
      ...(generated.costUsd !== undefined ? { costUsd: generated.costUsd } : {}),
      ...(promptAuthor ? { promptAuthor } : {}),
      ...(placeholderImageId ? { placeholderId: placeholderImageId } : {}),
    });
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("stored image URL is unavailable");
    return { imageId, url, mimeType, width, height };
  }
}
