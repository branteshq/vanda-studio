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
    throw new Error("each final image must have a successful paint or read pixel result");
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
