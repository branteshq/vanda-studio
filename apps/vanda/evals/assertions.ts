import { Jimp } from "jimp";
import { z } from "zod";
import { imagePreviewSchema } from "../src/convex/messageImages";

export type EvalTraceStep = {
  agent?: string;
  system?: unknown;
  text?: unknown;
  calls?: Array<{ toolName?: string; args?: unknown; input?: unknown }>;
  results?: Array<{ toolName?: string; output?: unknown }>;
  errors?: Array<{ toolName?: string; message?: string }>;
  usage?: unknown;
};

/** Structural execution evidence; prose mentioning inspection is intentionally insufficient. */
export function assertImagesWereInspected(
  trace: readonly EvalTraceStep[],
  imageIds: readonly string[],
): void {
  const inspected = new Set<string>();

  for (const step of trace) {
    for (const result of step.results ?? []) {
      if (result.toolName === "paint") {
        const image = z.object({ data: imagePreviewSchema }).safeParse(result.output);

        if (image.success) inspected.add(image.data.data.imageId);
      }

      // A weave, or the extend that closes the loop, shows every slide to the model
      // in one strip; an intermediate extend has no strip and shows nothing.
      if (
        result.toolName === "weave_infinite_carousel" ||
        result.toolName === "extend_infinite_carousel"
      ) {
        const woven = z
          .object({
            data: z.object({
              slides: z.array(z.object({ imageId: z.string() })),
              strip: z.object({ imageId: z.string(), url: z.string() }),
            }),
          })
          .safeParse(result.output);

        if (woven.success) for (const slide of woven.data.data.slides) inspected.add(slide.imageId);
      }

      if (result.toolName === "read") {
        const image = z
          .object({
            data: z.object({
              ok: z.literal(true),
              file: imagePreviewSchema.extend({ kind: z.literal("image") }),
            }),
          })
          .safeParse(result.output);

        if (image.success) inspected.add(image.data.data.file.imageId);
      }
    }
  }

  if (imageIds.length === 0 || imageIds.some((id) => !inspected.has(id)))
    throw new Error("each final image must have a successful paint, weave or read pixel result");
}

/**
 * Feed fit starts with looking: some paint call must condition on at least
 * `minimum` of the brand's published posts. Whether the pixels then fit the grid
 * is for the reviewer; this only proves the feed reached the image model.
 */
export function assertFeedReferenced(
  trace: readonly EvalTraceStep[],
  feedImageIds: readonly string[],
  minimum = 2,
): void {
  const feed = new Set(feedImageIds);

  const best = Math.max(
    0,
    ...trace.flatMap((step) =>
      (step.calls ?? []).flatMap((call) => {
        if (call.toolName !== "paint") return [];

        const input = z
          .object({ referenceImageIds: z.array(z.string()).optional() })
          .safeParse(call.input ?? call.args);

        return input.success
          ? [(input.data.referenceImageIds ?? []).filter((id) => feed.has(id)).length]
          : [];
      }),
    ),
  );

  if (best < minimum)
    throw new Error(`no paint call referenced ${minimum} feed posts (best: ${best})`);
}

/**
 * A post with a real person starts from her photo: some paint call must pass the
 * `face` reference together with at least one published post for the layout.
 */
export function assertFaceReferenced(
  trace: readonly EvalTraceStep[],
  faceImageId: string,
  feedImageIds: readonly string[],
): void {
  const feed = new Set(feedImageIds);

  const found = trace.some((step) =>
    (step.calls ?? []).some((call) => {
      if (call.toolName !== "paint") return false;

      const input = z
        .object({ referenceImageIds: z.array(z.string()).optional() })
        .safeParse(call.input ?? call.args);

      const ids = input.success ? (input.data.referenceImageIds ?? []) : [];

      return ids.includes(faceImageId) && ids.some((id) => feed.has(id));
    }),
  );

  if (!found) throw new Error("no paint call passed the owner's face photo with a feed post");
}

/** The owner's attached product photo reached the image model: some paint (or carousel extend) passed it. */
export function assertProductReferenced(trace: readonly EvalTraceStep[], photoId: string): void {
  const painters = new Set(["paint", "extend_infinite_carousel", "weave_infinite_carousel"]);

  const found = trace.some((step) =>
    (step.calls ?? []).some(
      (call) =>
        painters.has(call.toolName ?? "") &&
        JSON.stringify(call.input ?? call.args ?? {}).includes(photoId),
    ),
  );

  if (!found) throw new Error("no paint call passed the owner's product photo");
}

/**
 * A request missing what the post needs ends in a question, not a picture: no
 * paint, no draft, and a reply that asks for a photo or the product's details.
 */
export function assertAskedFirst(
  trace: readonly EvalTraceStep[],
  response: string,
  postCount: number,
): void {
  const painted = trace.some((step) =>
    (step.calls ?? []).some((call) =>
      ["paint", "extend_infinite_carousel", "weave_infinite_carousel", "create_post"].includes(
        call.toolName ?? "",
      ),
    ),
  );

  if (painted || postCount > 0) throw new Error("painted or drafted instead of asking first");

  const asks =
    response.includes("?") ||
    /\b(preciso|precisa|me (manda|envia|mande|envie)|manda|envia|mande|envie|enviar|mandar)\b/i.test(
      response,
    );

  if (!/\b(fotos?|imagens?|detalhes|capas?)\b/i.test(response) || !asks)
    throw new Error("the reply does not ask for a photo or the product's details");
}

/**
 * The brand file's Design section carries both decisions after a post on a brand
 * with a feed: `Manter` (identity every post keeps) and `Evoluir` (the execution
 * the next posts improve on). Presence only; what they say is for the reviewer.
 */
export function assertKeepAndEvolveWritten(brandFile: string): void {
  const design = /^## Design\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(brandFile)?.[1] ?? "";

  for (const label of ["Manter", "Evoluir"])
    if (!new RegExp(`^- ${label}: \\S`, "m").test(design))
      throw new Error(`the Design section has no "${label}:" item`);
}

const paintPrompts = (trace: readonly EvalTraceStep[]): string[] =>
  trace.flatMap((step) =>
    (step.calls ?? []).flatMap((call) => {
      if (call.toolName !== "paint") return [];

      const input = z.object({ prompt: z.string() }).safeParse(call.input ?? call.args);

      return input.success ? [input.data.prompt] : [];
    }),
  );

// "no double frame", "sem moldura dupla", "avoid clip art": a dated element named
// only to exclude it. Looks back over a short window from the match.
// \b is ASCII-only, so "não" needs letter lookarounds under the u flag.
const NEGATED =
  /(?<!\p{L})(no|not|without|avoid|never|instead of|drop|remove|sem|nada de|evite|nunca|em vez de|tire|não|nem)(?!\p{L})[^.;:]{0,60}$/iu;

/**
 * Identity stays, execution improves: some paint keeps the brand's main colour
 * and signature, and no paint asks for a dated element of the feed except to
 * exclude it. A text heuristic over prompts: the pixels are the reviewer's call.
 */
export function assertIdentityKeptExecutionImproved(
  trace: readonly EvalTraceStep[],
  { hex, signature, dated }: { hex: string; signature: string; dated: RegExp },
): void {
  const prompts = paintPrompts(trace);

  if (prompts.length === 0) throw new Error("no paint call");

  if (!prompts.some((prompt) => prompt.toLowerCase().includes(hex.toLowerCase())))
    throw new Error(`no paint prompt keeps the brand colour ${hex}`);

  if (!prompts.some((prompt) => prompt.includes(signature)))
    throw new Error(`no paint prompt keeps the signature ${signature}`);

  const global = new RegExp(
    dated.source,
    dated.flags.includes("g") ? dated.flags : `${dated.flags}g`,
  );

  for (const prompt of prompts)
    for (const match of prompt.matchAll(global))
      if (!NEGATED.test(prompt.slice(0, match.index)))
        throw new Error(`a paint prompt asks for a dated element: "${match[0]}"`);
}

/** Checks execution plus a conservative disclosure signal, not semantic truthfulness. */
export function assertRejectedPaintWasReported(
  trace: readonly EvalTraceStep[],
  response: string,
): void {
  const rejected = trace.some((step) =>
    (step.errors ?? []).some((error) => error.toolName === "paint"),
  );

  if (!rejected) throw new Error("paint did not execute and reject");

  const disclosesFailure =
    /não (?:foi possível |consegui |pude )?(?:gerar|criar)|falh|indisponível|nenhuma (?:imagem|arte) (?:foi )?(?:criada|gerada)/i.test(
      response,
    );

  const unnegated = response.replace(
    /nenhuma (?:imagem|arte) (?:foi )?(?:criada|gerada)|não (?:criei|gerei)/gi,
    "",
  );

  const claimsSuccess =
    /(?:imagem|arte) (?:foi |está )?(?:criada|gerada|pronta)|\bcriei\b|\bgerei\b/i.test(unnegated);

  if (!disclosesFailure || claimsSuccess)
    throw new Error("final response does not conservatively report the rejected paint execution");
}

// The purple pen is enclosed by a white stroke but shares the background's exact color.
// Other non-background pixels (including antialiased text edges) are all protected.
const protectedBackgroundSeeds = new Map<string, readonly (readonly [number, number])[]>([
  ["caju-background-revision", []],
  ["orvalho-product-identity-revision", []],
  ["pimba-kit-revision", [[497, 500]]],
]);

/** Checks every protected pixel, allowing actual background changes rather than bounding boxes. */
export async function assertProtectedPixelsPreserved(
  referenceId: string,
  before: Uint8Array,
  after: Uint8Array,
): Promise<void> {
  const seeds = protectedBackgroundSeeds.get(referenceId);

  if (!seeds) throw new Error(`no protected pixel regions for ${referenceId}`);

  const [source, revision] = await Promise.all([
    Jimp.read(Buffer.from(before)),
    Jimp.read(Buffer.from(after)),
  ]);

  if (source.width !== revision.width || source.height !== revision.height)
    throw new Error("revision dimensions changed");

  const background = source.getPixelColor(0, 0);
  const protectedBackground = new Uint8Array(source.width * source.height);
  const queue = new Uint32Array(protectedBackground.length);
  let head = 0;
  let tail = 0;

  for (const [x, y] of seeds) {
    if (source.getPixelColor(x, y) !== background)
      throw new Error("reference changed: protected background seed no longer matches");
    const index = y * source.width + x;
    protectedBackground[index] = 1;
    queue[tail++] = index;
  }

  while (head < tail) {
    const index = queue[head++]!;
    const x = index % source.width;
    const y = Math.floor(index / source.width);

    if (x === 0 || y === 0 || x === source.width - 1 || y === source.height - 1)
      throw new Error("reference changed: protected component touches the background border");

    for (const next of [index - 1, index + 1, index - source.width, index + source.width]) {
      if (protectedBackground[next]) continue;

      if (source.getPixelColor(next % source.width, Math.floor(next / source.width)) !== background)
        continue;
      protectedBackground[next] = 1;
      queue[tail++] = next;
    }
  }

  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      const original = source.getPixelColor(x, y);

      if (
        (original !== background || protectedBackground[y * source.width + x]) &&
        original !== revision.getPixelColor(x, y)
      )
        throw new Error(`protected pixel changed at ${x},${y}`);
    }
}
