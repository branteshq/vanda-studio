"use node";

import { Jimp } from "jimp";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { agentActivityIdValidator, type AgentActivityId } from "./agentActivity";
import { chainSlidePrompt } from "./gallery";
import type { BrandKit } from "./workspace/brandKit";
import {
  blendBand,
  buildPatch,
  extendCanvas,
  matchColors,
  restoreLeft,
  seamPairs,
  seamScore,
  weaveGeometry,
  type Bitmap,
} from "./pipeline/seamWeave";

const MIN_SLIDES = 3;

const MAX_SLIDES = 5;

// Parallel repaints per weave; each is a full image-model call. convex-test
// can't interleave writes inside one action, so tests and evals run serially.
const concurrency = () => Number(process.env.VANDA_WEAVE_CONCURRENCY ?? 3) || 1;

// Preview strip height; the loop shows as slide 1 repeated after the last.
const STRIP_HEIGHT = 360;

const RATIOS = { "4:5": 4 / 5, "1:1": 1 } as const;

type WeaveFormat = keyof typeof RATIOS;

// Seam 1→2 carries the hero: a big subject on a wider repaint band.
const HERO_SEAM = 0;

// Context the chain keeps from the previous slide: only its right edge, outside
// the text column, so the model never sees (and copies) the previous text.
// The hero seam keeps more, since half the hero lives there.
const KEEP = { hero: 0.32, satellite: 0.24 } as const;

// Superseded slides go only after the turn that made them can no longer show or
// post them (a chat turn is capped well below this).
const DISCARD_DELAY_MS = 60 * 60 * 1000;

type SeamRole = "hero" | "satellite";

/** The agent's style sheet and the account's kit, closing every prompt. */
const direction = (style: string | undefined, brand: string): string[] => [
  ...(style?.trim() ? [`Art direction: ${style.trim()}.`] : []),
  ...(brand ? [brand] : []),
];

/** The account's kit as a prompt line, so every repaint keeps the brand even if the agent forgets it. */
export const brandDirection = (kit: BrandKit | null): string => {
  if (!kit) return "";
  const parts: string[] = [];

  if (kit.colors.length) {
    const colors = kit.colors
      .map((color) => {
        const label = [color.name, color.role].filter(Boolean).join(", ");

        return label ? `${color.hex} (${label})` : color.hex;
      })
      .join(", ");

    parts.push(
      `Brand palette — use exactly these colors for background, accents and objects, no other dominant colors: ${colors}.`,
    );
  }

  if (kit.fonts.length) {
    const fonts = kit.fonts
      .map((font) => (font.role ? `${font.family} for ${font.role}` : font.family))
      .join(", ");

    parts.push(`Brand typography — set every text in: ${fonts}.`);
  }

  return parts.join(" ");
};

/** The repaint brief for one seam patch; the agent supplies only the bridge and style. */
export const seamPrompt = (
  bridge: string,
  style: string | undefined,
  role: SeamRole,
  brand = "",
): string =>
  [
    "This image is two adjacent slides of ONE panoramic Instagram carousel, joined at the vertical center line.",
    "Repaint it as one seamless, continuous picture: at the center there must be no visible cut, border, color step, lighting change or misaligned horizon.",
    ...(role === "hero"
      ? [
          `Add this hero subject, complete and sharp, with its visual center on the vertical center line, about 55–70% of the image height, standing on the bottom and bleeding off the bottom edge, at least 30% of its width on each side: ${bridge.trim()}.`,
          "The center line must run through a large simple area of the subject (body, hull, side), never through a face, text or logo. Give it a soft shadow and a subtle glow behind it, lit like the scene.",
          "Keep the left and right fifths as they are: same composition, colors, lighting and any text there.",
        ]
      : [
          `Add this bridge element crossing the vertical center line, extending well into both halves and about 25–45% of the image height: ${bridge.trim()}.`,
          "Keep the left and right quarters as they are: same composition, colors, lighting and any text there.",
        ]),
    "Do not add any new text, letters, numbers, logos, frames or borders.",
    ...direction(style, brand),
  ].join(" ");

/** Step A of the chain: continue the previous slide's right edge into the next slide. */
export const extendPrompt = (
  bridge: string,
  style: string | undefined,
  role: SeamRole,
  brand = "",
): string => {
  const keep = Math.round(KEEP[role] * 100);

  return [
    `The left ${keep}% of this image is the right edge of an Instagram carousel slide; the rest is an empty placeholder of flat color streaks.`,
    `Extend the scene to the right as ONE seamless panoramic picture: keep the left ${keep}% exactly as it is and paint the rest as its natural continuation — same environment, horizon height, light, palette, perspective, texture and technique — with no visible line, border or color step at x=${keep}%.`,
    role === "hero"
      ? `The large subject cut off at x=${keep}% is the hero: ${bridge.trim()}. Continue it across that line, complete, at the same scale, pose and lighting, so it reads as one subject; keep it inside the left half of the image.`
      : `Add this bridge element crossing the vertical line at x=${keep}%, extending to both sides and about 20–30% of the image height: ${bridge.trim()}.`,
    "Paint no text, letters, numbers, logos, frames or borders anywhere. Right of the bridge, only the environment continues to the edge.",
    ...direction(style, brand),
  ].join(" ");
};

/** Text column of slide `index` (0-based), as % of its width, clear of every repaint band. */
const textColumn = (index: number): readonly [from: number, to: number] =>
  index === 1 ? [40, 72] : [24, 72];

/** Step B of the chain: finish the new slide and its text from the continued scenery. */
export const completePrompt = (
  content: string,
  style: string | undefined,
  index: number,
  last: boolean,
  brand = "",
): string => {
  const [from, to] = textColumn(index);
  const known = 100 - Math.round(KEEP[index === 1 ? "hero" : "satellite"] * 100);
  const keep = index === 1 ? "left 30%" : "left fifth";

  return [
    `This image is ONE Instagram carousel slide. Its left ${known}% is finished scenery — it continues from the previous slide — and the rest is an empty placeholder of flat color streaks.`,
    `Keep the ${keep} exactly as it is. Paint the placeholder as the seamless continuation of the same scene (same environment, horizon height, light, palette and technique), with no visible line or color step.`,
    `Then complete the slide with: ${content.trim()}.`,
    `Place every text element inside the column between ${from}% and ${to}% of the width, on a calm area of background or a soft scrim; write the text exactly as given and nothing else.`,
    "Text never overlaps the hero, the bridge objects, people or any other subject: keep a clear gap of at least 4% of the width between every letter and every object. If the column is not clear, make the text smaller or move it up or down inside the column; never move an object behind or under the text.",
    last
      ? "The right quarter is only the environment continuing to the edge: it flows back into the first slide."
      : "The right quarter is only the environment continuing to the edge: no text, objects or half objects there, the next slide continues from it.",
    "No frames, borders, vignettes, paper cutouts or card shapes: the background touches all four edges.",
    "The reference image is slide 1 of this carousel: match its typography (font family, weight, size hierarchy, colors) and its discreet brand signature, never its composition or its text.",
    ...direction(style, brand),
  ].join(" ");
};

// A view over the bitmap's own memory: Buffer.from(copy) may land in Node's shared
// pool at a nonzero offset, which Jimp.fromBitmap ignores.
const bufferOf = (data: Uint8Array): Buffer =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength);

const decode = async (bytes: ArrayBuffer): Promise<Bitmap> => {
  const image = await Jimp.read(Buffer.from(bytes));

  return {
    width: image.bitmap.width,
    height: image.bitmap.height,
    data: new Uint8Array(image.bitmap.data),
  };
};

// JPEG, not PNG: a 1024×1280 slide drops from ~2.5 MB to ~300 KB, so every
// upload, provider fetch and model view of it is faster.
const encodeJpeg = async (bitmap: Bitmap): Promise<Blob> => {
  const image = Jimp.fromBitmap({
    width: bitmap.width,
    height: bitmap.height,
    data: bufferOf(bitmap.data),
  });

  return new Blob([new Uint8Array(await image.getBuffer("image/jpeg", { quality: 92 }))], {
    type: "image/jpeg",
  });
};

const fetchBytes = async (
  ctx: ActionCtx,
  source: { externalUrl: string | null; storageId: Id<"_storage"> | null },
): Promise<ArrayBuffer> => {
  if (source.storageId) {
    const blob = await ctx.storage.get(source.storageId);

    if (blob) return blob.arrayBuffer();
  }

  if (source.externalUrl) {
    const response = await fetch(source.externalUrl);

    if (!response.ok) throw new Error(`image download failed (${response.status})`);

    return response.arrayBuffer();
  }

  throw new Error("image has no resolvable bytes");
};

const resize = async (bitmap: Bitmap, width: number, height: number): Promise<Bitmap> => {
  if (bitmap.width === width && bitmap.height === height) return bitmap;
  const image = Jimp.fromBitmap({ ...bitmap, data: bufferOf(bitmap.data) });
  image.resize({ w: width, h: height });

  return { width, height, data: new Uint8Array(image.bitmap.data) };
};

/** Run `task` over `items` with at most `limit` in flight, preserving order. */
const mapLimited = async <Item, Result>(
  items: readonly Item[],
  limit: number,
  task: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
  const results: Result[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
};

/** Slides side by side plus slide 1 again, so the loop seam is visible too. */
const stripPreview = async (slides: readonly Bitmap[]): Promise<Blob> => {
  const { width, height } = slides[0]!;
  const tileWidth = Math.round((width * STRIP_HEIGHT) / height);
  const tiles = [...slides, slides[0]!];
  const strip = new Jimp({ width: tileWidth * tiles.length, height: STRIP_HEIGHT });

  for (const [index, slide] of tiles.entries()) {
    const tile = Jimp.fromBitmap({ ...slide, data: bufferOf(slide.data) });
    tile.resize({ w: tileWidth, h: STRIP_HEIGHT });
    strip.composite(tile, index * tileWidth, 0);
  }

  return new Blob([new Uint8Array(await strip.getBuffer("image/jpeg", { quality: 85 }))], {
    type: "image/jpeg",
  });
};

type Run = {
  accountId: Id<"accounts">;
  format: WeaveFormat;
  threadId?: string | undefined;
  activityId?: AgentActivityId | undefined;
};

type SeamPaintArgs = {
  accountId: Id<"accounts">;
  prompt: string;
  aspectRatio: WeaveFormat;
  editOfStorageId: Id<"_storage">;
  name: string;
  promptAuthor: "vanda";
  threadId?: string;
  activityId?: AgentActivityId;
  referenceImageIds?: Id<"images">[];
};

type SaveImageArgs = {
  accountId: Id<"accounts">;
  storageId: Id<"_storage">;
  prompt: string;
  mimeType: string;
  width: number;
  height: number;
  name: string;
  promptAuthor: "vanda";
  editOfImageId?: Id<"images">;
  activityId?: AgentActivityId;
};

type WeaveResult = {
  slides: { imageId: Id<"images"> }[];
  // Absent while a chain is still growing: one preview, at the end, is enough.
  strip?: { imageId: Id<"images">; url: string };
  seams: { seam: string; bridge: string; score: number; woven: boolean }[];
};

/** Decode owned slides (the ownership wall paint uses) and check they share one size and format. */
const loadSlides = async (
  ctx: ActionCtx,
  run: Run,
  imageIds: Id<"images">[],
): Promise<Bitmap[]> => {
  const resolved = await ctx.runQuery(internal.imagesData.resolvePaintInput, {
    accountId: run.accountId,
    referenceImageIds: imageIds,
  });

  const slides = await Promise.all(
    resolved.references.map(async (source) => decode(await fetchBytes(ctx, source))),
  );

  const { width, height } = slides[0]!;

  for (const [index, slide] of slides.entries()) {
    if (slide.width !== width || slide.height !== height) {
      throw new Error(
        `slide ${index + 1} é ${slide.width}×${slide.height}; todos precisam de ${width}×${height}`,
      );
    }
  }

  if (Math.abs(width / height / RATIOS[run.format] - 1) > 0.03) {
    throw new Error(`os slides são ${width}×${height}, não ${run.format}`);
  }

  return slides;
};

/**
 * Edit a server-built patch with the image model and return the result at the
 * patch's size. The edit's gallery row is a working file, pushed to `working`.
 */
const repaintPatch = async (
  ctx: ActionCtx,
  run: Run,
  patch: Bitmap,
  prompt: string,
  name: string,
  working: Id<"images">[],
  // Style references for the edit (e.g. slide 1, so the typography stays the same).
  referenceImageIds?: Id<"images">[],
): Promise<Bitmap> => {
  const patchStorageId = await ctx.storage.store(await encodeJpeg(patch));

  const paintArgs: SeamPaintArgs = {
    accountId: run.accountId,
    prompt,
    aspectRatio: run.format,
    editOfStorageId: patchStorageId,
    name,
    promptAuthor: "vanda",
  };

  if (run.threadId) paintArgs.threadId = run.threadId;

  if (run.activityId) paintArgs.activityId = run.activityId;

  if (referenceImageIds?.length) paintArgs.referenceImageIds = referenceImageIds;

  try {
    const painted = await ctx.runAction(internal.images.paint, paintArgs);
    working.push(painted.imageId);

    const [source] = (
      await ctx.runQuery(internal.imagesData.resolvePaintInput, {
        accountId: run.accountId,
        referenceImageIds: [painted.imageId],
      })
    ).references;

    return await resize(await decode(await fetchBytes(ctx, source!)), patch.width, patch.height);
  } finally {
    await ctx.storage.delete(patchStorageId);
  }
};

/** Save a finished slide as a new gallery image linked to the one it replaces. */
const saveSlide = async (
  ctx: ActionCtx,
  run: Run,
  slide: Bitmap,
  label: string,
  editOfImageId: Id<"images"> | undefined,
): Promise<Id<"images">> => {
  const storageId = await ctx.storage.store(await encodeJpeg(slide));

  const slideArgs: SaveImageArgs = {
    accountId: run.accountId,
    storageId,
    prompt: chainSlidePrompt(label),
    mimeType: "image/jpeg",
    width: slide.width,
    height: slide.height,
    name: `Infinito ${label}`,
    promptAuthor: "vanda",
  };

  if (editOfImageId) slideArgs.editOfImageId = editOfImageId;

  if (run.activityId) slideArgs.activityId = run.activityId;

  return ctx.runMutation(internal.imagesData.savePaintedImage, slideArgs);
};

const saveStrip = async (
  ctx: ActionCtx,
  run: Run,
  slides: readonly Bitmap[],
): Promise<{ imageId: Id<"images">; url: string }> => {
  const { width, height } = slides[0]!;
  const storageId = await ctx.storage.store(await stripPreview(slides));

  const stripArgs: SaveImageArgs = {
    accountId: run.accountId,
    storageId,
    prompt: "Prévia do carrossel infinito: slides lado a lado e o slide 1 repetido no fim",
    mimeType: "image/jpeg",
    width: Math.round((width * STRIP_HEIGHT) / height) * (slides.length + 1),
    height: STRIP_HEIGHT,
    name: "Prévia infinito",
    promptAuthor: "vanda",
  };

  if (run.activityId) stripArgs.activityId = run.activityId;

  const imageId = await ctx.runMutation(internal.imagesData.savePaintedImage, stripArgs);
  const url = await ctx.storage.getUrl(storageId);

  if (!url) throw new Error("stored strip URL is unavailable");

  return { imageId, url };
};

/** Schedule the superseded chain slides for removal; the mutation spares anything still in use. */
const discardSuperseded = async (
  ctx: ActionCtx,
  run: Run,
  superseded: Id<"images">[],
  chain: WeaveResult["slides"],
): Promise<void> => {
  if (!superseded.length) return;

  await ctx.scheduler.runAfter(DISCARD_DELAY_MS, internal.gallery.discardChainSlides, {
    accountId: run.accountId,
    imageIds: superseded,
    keep: chain.map((slide) => slide.imageId),
  });
};

const score = (left: Bitmap, right: Bitmap) => Math.round(seamScore(left, right) * 10) / 10;

/**
 * Weave an infinite carousel: for every chosen seam (the loop seam N→1
 * included) repaint the patch spanning the cut with a bridge element, then
 * blend its central band back into both slides. Changed slides are saved as
 * new gallery images and the versions they replace are discarded; the repaints
 * are working files and are discarded too.
 */
export const weave = internalAction({
  args: {
    accountId: v.id("accounts"),
    imageIds: v.array(v.id("images")),
    format: v.union(v.literal("4:5"), v.literal("1:1")),
    // One bridge per seam, in order; the last entry is the loop seam (last → first).
    bridges: v.array(v.string()),
    style: v.optional(v.string()),
    // Re-weave only these seams (1-based, N = loop); default every seam.
    onlySeams: v.optional(v.array(v.number())),
    threadId: v.optional(v.string()),
    activityId: v.optional(agentActivityIdValidator),
  },
  handler: async (ctx, args): Promise<WeaveResult> => {
    const count = args.imageIds.length;

    if (count < MIN_SLIDES || count > MAX_SLIDES) {
      throw new Error(`carrossel infinito precisa de ${MIN_SLIDES} a ${MAX_SLIDES} imagens`);
    }

    if (args.bridges.length !== count) {
      throw new Error(
        `informe ${count} pontes, uma por emenda, incluindo a emenda de volta (${count}→1)`,
      );
    }

    const chosen = new Set(args.onlySeams ?? seamPairs(count).map((_, seam) => seam + 1));

    for (const seam of chosen) {
      if (!Number.isInteger(seam) || seam < 1 || seam > count) {
        throw new Error(`emenda ${seam} não existe; use 1 a ${count} (${count} = volta ao início)`);
      }
    }

    const run: Run = args;
    const slides = await loadSlides(ctx, run, args.imageIds);

    const brand = brandDirection(
      await ctx.runQuery(internal.brandContext.kit, { accountId: args.accountId }),
    );

    const { width } = slides[0]!;
    const pairs = seamPairs(count);
    const workingImageIds: Id<"images">[] = [];

    try {
      // Patches come from the source slides; bands of different seams never overlap.
      const repaints = await mapLimited(
        [...pairs.entries()],
        concurrency(),
        async ([seam, [left, right]]) => {
          if (!chosen.has(seam + 1)) return null;
          const patch = buildPatch(slides[left]!, slides[right]!);

          const repaint = await repaintPatch(
            ctx,
            run,
            patch,
            seamPrompt(
              args.bridges[seam]!,
              args.style,
              seam === HERO_SEAM ? "hero" : "satellite",
              brand,
            ),
            `Emenda ${left + 1}→${right + 1}`,
            workingImageIds,
          );

          return matchColors(repaint, patch, Math.round(width * 0.12));
        },
      );

      for (const [seam, [left, right]] of pairs.entries()) {
        const repaint = repaints[seam];

        if (repaint)
          blendBand(
            slides[left]!,
            slides[right]!,
            repaint,
            weaveGeometry(width, seam === HERO_SEAM),
          );
      }

      // Only slides on either side of a repainted seam changed; the rest keep their ids.
      const changed = new Set(
        pairs.flatMap(([left, right], seam) => (repaints[seam] ? [left, right] : [])),
      );

      const saved = await mapLimited(
        [...slides.entries()],
        concurrency(),
        async ([index, slide]) => ({
          imageId: changed.has(index)
            ? await saveSlide(ctx, run, slide, `${index + 1}/${count}`, args.imageIds[index]!)
            : args.imageIds[index]!,
        }),
      );

      await discardSuperseded(
        ctx,
        run,
        [...changed].sort((a, b) => a - b).map((index) => args.imageIds[index]!),
        saved,
      );

      return {
        slides: saved,
        strip: await saveStrip(ctx, run, slides),
        seams: pairs.map(([left, right], seam) => ({
          seam:
            seam === count - 1 ? `${left + 1}→${right + 1} (volta)` : `${left + 1}→${right + 1}`,
          bridge: args.bridges[seam]!,
          score: score(slides[left]!, slides[right]!),
          woven: repaints[seam] !== null,
        })),
      };
    } finally {
      if (workingImageIds.length) {
        await ctx.runMutation(internal.gallery.discardWorking, {
          accountId: args.accountId,
          imageIds: workingImageIds,
        });
      }
    }
  },
});

/**
 * Grow an infinite carousel by one slide, painting it as the continuation of
 * the previous one (chained outpainting), so the cut is a real continuation:
 *   A. the previous slide's right edge (outside its text) + an empty
 *      placeholder are repainted as one picture with the bridge crossing the
 *      cut; the band around the cut goes back into the previous slide and the
 *      rest starts the new slide;
 *   B. the new slide is completed with its text, slide 1 as the typography
 *      reference; its left band is restored so the cut stays continuous.
 * With `loopBridge` the new slide is the last one and the loop seam N→1 is
 * woven too. Returns the whole chain with the changed slides as new images.
 */
export const extend = internalAction({
  args: {
    accountId: v.id("accounts"),
    // The chain so far, in order, slide 1 first.
    imageIds: v.array(v.id("images")),
    format: v.union(v.literal("4:5"), v.literal("1:1")),
    // What crosses the cut between the last slide and the new one.
    bridge: v.string(),
    // Brief for the new slide: exact text, evidence, progress.
    content: v.string(),
    style: v.optional(v.string()),
    // Present only for the last slide: the bridge across the loop seam N→1.
    loopBridge: v.optional(v.string()),
    threadId: v.optional(v.string()),
    activityId: v.optional(agentActivityIdValidator),
  },
  handler: async (ctx, args): Promise<WeaveResult> => {
    const count = args.imageIds.length + 1;

    if (args.imageIds.length < 1 || count > MAX_SLIDES) {
      throw new Error(
        `continue um carrossel de 1 a ${MAX_SLIDES - 1} slides (o máximo é ${MAX_SLIDES})`,
      );
    }

    if (args.loopBridge !== undefined && count < MIN_SLIDES) {
      throw new Error(`a volta só fecha com pelo menos ${MIN_SLIDES} slides`);
    }

    const run: Run = args;
    const chain = await loadSlides(ctx, run, args.imageIds);

    const brand = brandDirection(
      await ctx.runQuery(internal.brandContext.kit, { accountId: args.accountId }),
    );

    const { width } = chain[0]!;
    const index = count - 1;
    const previous = chain[index - 1]!;
    const hero = index - 1 === HERO_SEAM;
    const geometry = weaveGeometry(width, hero);
    const keep = Math.round(width * KEEP[hero ? "hero" : "satellite"]);
    const strip = Math.round(width * 0.12);
    const workingImageIds: Id<"images">[] = [];

    try {
      // A: continue the scene across the cut.
      const canvasA = extendCanvas(previous, keep);

      const extended = matchColors(
        await repaintPatch(
          ctx,
          run,
          canvasA,
          extendPrompt(args.bridge, args.style, hero ? "hero" : "satellite", brand),
          `Emenda ${index}→${index + 1}`,
          workingImageIds,
        ),
        canvasA,
        strip,
        "left",
      );

      // The new slide starts as everything right of the cut; blendBand fills the
      // previous slide's edge (and rewrites the same pixels on the new side).
      const canvasB = extendCanvas(extended, width - keep);
      blendBand(previous, canvasB, extended, geometry, keep);

      // B: finish the new slide with its own text.
      const completed = matchColors(
        await repaintPatch(
          ctx,
          run,
          canvasB,
          completePrompt(args.content, args.style, index, args.loopBridge !== undefined, brand),
          `Slide ${count}`,
          workingImageIds,
          [args.imageIds[0]!],
        ),
        canvasB,
        strip,
        "left",
      );

      const slide = restoreLeft(completed, canvasB, geometry.band, geometry.feather);
      const slides = [...chain, slide];
      const changed = new Set([index - 1, index]);

      if (args.loopBridge !== undefined) {
        const first = slides[0]!;
        const patch = buildPatch(slide, first);

        const repaint = matchColors(
          await repaintPatch(
            ctx,
            run,
            patch,
            seamPrompt(args.loopBridge, args.style, "satellite", brand),
            `Emenda ${count}→1`,
            workingImageIds,
          ),
          patch,
          strip,
        );

        blendBand(slide, first, repaint, weaveGeometry(width));
        changed.add(0);
      }

      // Unchanged slides keep their ids; changed ones become new gallery images.
      const saved: WeaveResult["slides"] = [];

      for (const [position, bitmap] of slides.entries()) {
        saved.push({
          imageId: changed.has(position)
            ? await saveSlide(ctx, run, bitmap, `${position + 1}`, args.imageIds[position])
            : args.imageIds[position]!,
        });
      }

      // Earlier chain versions of the changed slides are superseded.
      const superseded = [...changed].flatMap((position) =>
        position < args.imageIds.length ? [args.imageIds[position]!] : [],
      );

      await discardSuperseded(ctx, run, superseded, saved);

      const seams = [
        {
          seam: `${index}→${index + 1}`,
          bridge: args.bridge,
          score: score(previous, slide),
          woven: true,
        },
      ];

      if (args.loopBridge === undefined) return { slides: saved, seams };

      seams.push({
        seam: `${count}→1 (volta)`,
        bridge: args.loopBridge,
        score: score(slide, slides[0]!),
        woven: true,
      });

      return { slides: saved, strip: await saveStrip(ctx, run, slides), seams };
    } finally {
      if (workingImageIds.length) {
        await ctx.runMutation(internal.gallery.discardWorking, {
          accountId: args.accountId,
          imageIds: workingImageIds,
        });
      }
    }
  },
});
