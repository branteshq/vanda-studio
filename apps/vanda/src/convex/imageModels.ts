/**
 * The image models Vanda's painter can drive, keyed by their OpenRouter id.
 * One canonical registry shared by the Convex `paint`/`gallery.generate`
 * primitives (validation, default) and the client's model picker (labels,
 * price tiers, blurbs) — never let the two drift.
 */

export interface ImageModel {
  /** OpenRouter model id passed to the images endpoint. */
  readonly id: string;
  /** User-facing name shown in the picker and the image detail view. */
  readonly label: string;
  /** Relative cost hint for the picker ("$" cheapest … "$$$" priciest). */
  readonly priceTier: "$" | "$$" | "$$$";
  /** One-line description under the label in the picker. */
  readonly blurb: string;
}

export const IMAGE_MODELS: ReadonlyArray<ImageModel> = [
  {
    id: "google/gemini-3.1-flash-image",
    label: "Nano Banana 2",
    priceTier: "$",
    blurb: "Equilíbrio de velocidade e qualidade",
  },
  {
    id: "google/gemini-3.1-flash-lite-image",
    label: "Nano Banana 2 Lite",
    priceTier: "$",
    blurb: "Geração e edição focadas em eficiência",
  },
  {
    id: "openai/gpt-image-2",
    label: "GPT Image 2",
    priceTier: "$$$",
    blurb: "Modelo de imagem da OpenAI",
  },
  {
    id: "google/gemini-3-pro-image",
    label: "Nano Banana Pro",
    priceTier: "$$",
    blurb: "Geração rápida de alta qualidade",
  },
  {
    id: "black-forest-labs/flux.2-flex",
    label: "Flux 2 Flex",
    priceTier: "$$",
    blurb: "Geração criativa e flexível",
  },
];

/** The painter's default when no model is chosen (Nano Banana 2). */
export const DEFAULT_IMAGE_MODEL = IMAGE_MODELS[0]!.id;

const BY_ID = new Map(IMAGE_MODELS.map((model) => [model.id, model]));

/** True when `id` is one of the models we allow callers to request. */
export const isKnownImageModel = (id: string): boolean => BY_ID.has(id);

/** The display label for a model id, falling back to the raw id if unknown. */
export const imageModelLabel = (id: string | undefined): string =>
  (id && BY_ID.get(id)?.label) ?? id ?? "Desconhecido";
