/**
 * The image models Vanda's painter can drive, keyed by their OpenRouter id.
 * One canonical registry shared by the Convex `paint`/`gallery.generate`
 * primitives (validation, default) and the client's model picker (labels,
 * price tiers, blurbs) — never let the two drift.
 */

/** Output resolution tiers of OpenRouter's images API (`resolution` param). */
export type ImageResolution = "1K" | "2K" | "4K";

export const IMAGE_RESOLUTIONS: ReadonlyArray<ImageResolution> = ["1K", "2K", "4K"];

export interface ImageModel {
  /** OpenRouter model id passed to the images endpoint. */
  readonly id: string;
  /** User-facing name shown in the picker and the image detail view. */
  readonly label: string;
  /** Lab whose mark appears alongside the model in the picker. */
  readonly maker: "OpenAI" | "Google" | "Black Forest Labs";
  /** Relative cost hint for the picker ("$" cheapest … "$$$" priciest). */
  readonly priceTier: "$" | "$$" | "$$$";
  /** One-line description under the label in the picker. */
  readonly blurb: string;
  /**
   * Resolution tiers this model's OpenRouter endpoint accepts, per the
   * discovery API (/api/v1/images/models/{id}/endpoints). Models without a
   * `resolution` parameter (gpt-image-2, flux) output 1K-class only.
   */
  readonly resolutions: ReadonlyArray<ImageResolution>;
}

export const IMAGE_MODELS: ReadonlyArray<ImageModel> = [
  {
    id: "google/gemini-3.1-flash-image",
    label: "Nano Banana 2",
    maker: "Google",
    priceTier: "$",
    blurb: "Equilíbrio de velocidade e qualidade",
    resolutions: ["1K", "2K", "4K"],
  },
  {
    id: "google/gemini-3.1-flash-lite-image",
    label: "Nano Banana 2 Lite",
    maker: "Google",
    priceTier: "$",
    blurb: "Geração e edição focadas em eficiência",
    resolutions: ["1K"],
  },
  {
    id: "openai/gpt-image-2.5-flare",
    label: "GPT Image 2.5 Flare",
    maker: "OpenAI",
    priceTier: "$$$",
    blurb: "Modelo de imagem da OpenAI, padrão da Vanda",
    resolutions: ["1K"],
  },
  {
    id: "openai/gpt-image-2.5-sunburst",
    label: "GPT Image 2.5 Sunburst",
    maker: "OpenAI",
    priceTier: "$$$",
    blurb: "Variante Sunburst da OpenAI para geração e edição",
    resolutions: ["1K"],
  },
  {
    id: "google/gemini-3-pro-image",
    label: "Nano Banana Pro",
    maker: "Google",
    priceTier: "$$",
    blurb: "Geração rápida de alta qualidade",
    resolutions: ["1K", "2K", "4K"],
  },
  {
    id: "black-forest-labs/flux.2-flex",
    label: "Flux 2 Flex",
    maker: "Black Forest Labs",
    priceTier: "$$",
    blurb: "Geração criativa e flexível",
    resolutions: ["1K"],
  },
];

/** The painter's default when no model is chosen. */
export const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2.5-flare";

/**
 * The painter the Conectado plan forces: every paint runs on the owner's
 * ChatGPT subscription, so model choice collapses and our meter stays at zero.
 * Canonical here — the backend override, the gallery composer and the profile
 * picker all read this one constant.
 */
export const CONECTADO_IMAGE_MODEL = "openai/gpt-image-2";

/** Separate subscription transport; not selectable in the OpenRouter catalog. */
export const CONECTADO_IMAGE_MODELS: ReadonlyArray<ImageModel> = [
  {
    id: CONECTADO_IMAGE_MODEL,
    label: "GPT Image 2",
    maker: "OpenAI",
    priceTier: "$$$",
    blurb: "Pela sua assinatura do ChatGPT",
    resolutions: ["1K"],
  },
];

const BY_ID = new Map(IMAGE_MODELS.map((model) => [model.id, model]));

/** True when `id` is one of the models we allow callers to request. */
export const isKnownImageModel = (id: string): boolean => BY_ID.has(id);

/** Recorded as `model` on images produced by the run_code tool, not a real provider. */
export const CODE_IMAGE_MODEL = "python/pillow";

/** The display label for a model id, falling back to the raw id if unknown. */
export const imageModelLabel = (id: string | undefined): string => {
  if (id === CODE_IMAGE_MODEL) return "Pillow (código)";

  if (id === CONECTADO_IMAGE_MODEL) return "GPT Image 2";

  return (id && BY_ID.get(id)?.label) ?? id ?? "Desconhecido";
};

/** Resolution tiers a model accepts; unknown models are treated as 1K-only. */
export const modelResolutions = (id: string): ReadonlyArray<ImageResolution> =>
  BY_ID.get(id)?.resolutions ?? ["1K"];

/** Tiers every one of the given models supports (drives the picker's gating). */
export const sharedResolutions = (modelIds: Iterable<string>): ReadonlyArray<ImageResolution> => {
  const ids = [...modelIds];

  return IMAGE_RESOLUTIONS.filter((resolution) =>
    ids.every((id) => modelResolutions(id).includes(resolution)),
  );
};

/** The requested tier if the model supports it, else the best it can do. */
export const clampResolution = (id: string, requested: ImageResolution): ImageResolution => {
  const supported = modelResolutions(id);

  if (supported.includes(requested)) return requested;

  // Highest supported tier below the request (every model supports 1K).
  for (let i = IMAGE_RESOLUTIONS.indexOf(requested) - 1; i >= 0; i -= 1) {
    const tier = IMAGE_RESOLUTIONS[i]!;

    if (supported.includes(tier)) return tier;
  }

  return "1K";
};
