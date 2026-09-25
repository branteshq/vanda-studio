import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export interface GeneratedVisual {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly model: string;
  /** Provider cost for this generation in USD, when OpenRouter reports it. */
  readonly costUsd?: number | undefined;
}

export class ImageGenerationFailed extends Data.TaggedError("ImageGenerationFailed")<{
  readonly operation: string;
  readonly message: string;
  /** Allowlisted diagnostics for the agent; never include raw provider text. */
  readonly recovery?: {
    readonly error: string;
    readonly retryableWithoutChanges: boolean;
    readonly instruction: string;
    readonly httpStatus?: number;
    readonly requested?: string;
    readonly supported?: string[];
  };
}> {}

const imageHttpFailure = (status: number, body: string, aspectRatio: string) => {
  let message = "";

  try {
    message = Schema.decodeUnknownSync(
      Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }),
    )(JSON.parse(body)).error.message;
  } catch {
    // HTML, malformed JSON and arbitrary provider text stay in server diagnostics.
  }

  // Extract only ratio literals, never forward the provider's prose or metadata.
  const accepted = message.match(/aspect_ratio: not supported\. Accepted: ([^\n]+)/)?.[1];

  const supported = (accepted ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^(?:1:1|3:2|2:3|4:3|3:4|4:5|5:4|16:9|9:16|21:9|auto)$/.test(value));

  const invalid = status === 400 || status === 422;

  const recovery: NonNullable<ImageGenerationFailed["recovery"]> =
    invalid && supported.length > 0
      ? {
          error: "unsupported_aspect_ratio",
          httpStatus: status,
          requested: /^(?:1:1|4:5|9:16|16:9)$/.test(aspectRatio) ? aspectRatio : "unknown",
          supported: [...new Set(supported)],
          retryableWithoutChanges: false,
          instruction:
            "Choose an accepted ratio that the paint tool schema allows and explain any remaining format limitation. Do not repeat the rejected ratio or report a provider outage.",
        }
      : {
          error: invalid
            ? "invalid_image_request"
            : status === 429
              ? "image_rate_limited"
              : status === 402
                ? "image_provider_credit_limit"
                : status === 401 || status === 403
                  ? "image_provider_access_denied"
                  : status >= 500 && status < 600
                    ? "image_provider_unavailable"
                    : "image_request_failed",
          httpStatus: status,
          retryableWithoutChanges: status === 429 || (status >= 500 && status < 600),
          instruction: invalid
            ? "The provider rejected the request parameters. Check the tool inputs before trying again; do not repeat unchanged or claim an outage."
            : status === 429 || (status >= 500 && status < 600)
              ? "Temporary provider failure. Retry at most once; if it fails again, stop and explain the failure."
              : "Do not retry automatically. Report the failure without claiming the owner's app plan is exhausted or that the provider is down.",
        };

  return new ImageGenerationFailed({
    operation: "generate",
    message: `OpenRouter HTTP ${status}: ${body}`,
    recovery,
  });
};

export interface ImageAssetGeneratorService {
  readonly generate: (input: {
    readonly prompt: string;
    readonly referenceUrls?: ReadonlyArray<string> | undefined;
    /** OpenRouter aspect ratio ("1:1", "4:5", …); omitted keeps the carousel default. */
    readonly aspectRatio?: string | undefined;
    /**
     * Resolution tier ("2K"/"4K") for endpoints that accept the `resolution`
     * param. Omit for 1K — it's every provider's default, and models without
     * the knob (gpt-image, flux) reject the parameter outright.
     */
    readonly resolution?: "2K" | "4K" | undefined;
    /** Cancels the provider call mid-flight (cooperative stop). */
    readonly signal?: AbortSignal | undefined;
  }) => Effect.Effect<GeneratedVisual, ImageGenerationFailed>;
}

export class ImageAssetGenerator extends Context.Service<
  ImageAssetGenerator,
  ImageAssetGeneratorService
>()("@vanda/studio/ImageAssetGenerator") {}

const OpenRouterImageResponse = Schema.Struct({
  usage: Schema.optional(Schema.Struct({ cost: Schema.optional(Schema.Number) })),
  data: Schema.optional(
    Schema.Array(
      Schema.Struct({
        b64_json: Schema.optional(Schema.String),
        media_type: Schema.optional(Schema.String),
      }),
    ),
  ),
});

export interface GeneratedAssetReview {
  readonly approved: boolean;
  readonly containsText: boolean;
  readonly containsLogo: boolean;
  readonly containsPerson: boolean;
  readonly prohibitedSubjects: ReadonlyArray<string>;
  readonly qualityIssues: ReadonlyArray<string>;
  readonly summary: string;
  readonly confidence: number;
}

const GeneratedAssetReviewSchema = Schema.Struct({
  approved: Schema.Boolean,
  containsText: Schema.Boolean,
  containsLogo: Schema.Boolean,
  containsPerson: Schema.Boolean,
  prohibitedSubjects: Schema.Array(Schema.String),
  qualityIssues: Schema.Array(Schema.String),
  summary: Schema.String,
  confidence: Schema.Number,
});

const AssetReviewEnvelope = Schema.Struct({
  choices: Schema.optional(
    Schema.Array(
      Schema.Struct({
        message: Schema.optional(Schema.Struct({ content: Schema.optional(Schema.String) })),
      }),
    ),
  ),
});

const assetReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "approved",
    "containsText",
    "containsLogo",
    "containsPerson",
    "prohibitedSubjects",
    "qualityIssues",
    "summary",
    "confidence",
  ],
  properties: {
    approved: { type: "boolean" },
    containsText: { type: "boolean" },
    containsLogo: { type: "boolean" },
    containsPerson: { type: "boolean" },
    prohibitedSubjects: { type: "array", items: { type: "string" } },
    qualityIssues: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export const reviewGeneratedAsset = async (input: {
  readonly apiKey: string;
  readonly model: string;
  readonly visual: GeneratedVisual;
  readonly context: string;
  /**
   * URLs of owner-authorized identity references. When present, the generated
   * image is ALLOWED (expected) to depict that exact person — the reviewer
   * compares identity instead of rejecting any person outright.
   */
  readonly identityReferenceUrls?: ReadonlyArray<string> | undefined;
}): Promise<GeneratedAssetReview> => {
  const encoded = Buffer.from(input.visual.bytes).toString("base64");
  const identityRefs = input.identityReferenceUrls ?? [];
  const allowPerson = identityRefs.length > 0;

  const personCriteria = allowPerson
    ? `A primeira imagem é a gerada; as demais são fotos de referência AUTORIZADAS da pessoa que ` +
      `representa a marca. A imagem gerada PODE (e deve, quando o contexto pedir) conter essa ` +
      `pessoa — mas reprove se a pessoa retratada claramente NÃO for a das referências, se o ` +
      `rosto estiver distorcido ou pouco fiel, ou se houver outra pessoa identificável além dela.`
    : `Reprove qualquer pessoa identificável, paciente, profissional de saúde, procedimento ou ` +
      `imagem clínica.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Atue como revisora visual independente de um elemento visual para carrossel de ` +
                `Instagram. Reprove qualquer letra, palavra, número, código hexadecimal, marca ` +
                `d'água, logotipo, interface, mockup de layout, cartão dentro da imagem, ` +
                `artefato anatômico estranho ou composição de baixa qualidade. ${personCriteria} ` +
                `Ícones abstratos e arquitetura genérica sem texto podem ser aprovados. approved ` +
                `só pode ser true se todos esses critérios forem atendidos. Liste problemas ` +
                `concretos. Contexto: ${input.context}`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${input.visual.mimeType};base64,${encoded}`,
              },
            },
            ...identityRefs.slice(0, 3).map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "generated_asset_review", strict: true, schema: assetReviewSchema },
      },
    }),
  });

  if (!response.ok)
    throw new Error(`asset review HTTP ${response.status}: ${await response.text()}`);

  const json = Schema.decodeUnknownSync(AssetReviewEnvelope)(await response.json());

  const content = json.choices?.[0]?.message?.content;

  if (!content) throw new Error("asset review response is empty");
  const review = Schema.decodeUnknownSync(GeneratedAssetReviewSchema)(JSON.parse(content));

  if (
    review.approved &&
    !review.containsText &&
    !review.containsLogo &&
    (allowPerson || !review.containsPerson) &&
    review.prohibitedSubjects.length === 0 &&
    review.qualityIssues.length === 0
  )
    return review;

  return { ...review, approved: false };
};

export const openRouterImageGeneratorLayer = (input: {
  readonly apiKey: string;
  readonly model: string;
}): Layer.Layer<ImageAssetGenerator> =>
  Layer.succeed(ImageAssetGenerator, {
    generate: ({ prompt, referenceUrls, aspectRatio, resolution, signal }) =>
      Effect.tryPromise({
        try: async () => {
          const payload = {
            model: input.model,
            prompt,
            n: 1,
            aspect_ratio: aspectRatio ?? "4:5",
            resolution,
            quality: "high",
            output_format: "jpeg",
            output_compression: 90,
            background: "opaque",
            input_references:
              referenceUrls && referenceUrls.length > 0
                ? referenceUrls.slice(0, 3).map((url) => ({
                    type: "image_url",
                    image_url: { url },
                  }))
                : undefined,
          };

          const request: RequestInit = {
            method: "POST",
            headers: {
              authorization: `Bearer ${input.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          };

          if (signal !== undefined) request.signal = signal;
          const response = await fetch("https://openrouter.ai/api/v1/images", request);

          if (!response.ok)
            throw imageHttpFailure(response.status, await response.text(), payload.aspect_ratio);
          const json = Schema.decodeUnknownSync(OpenRouterImageResponse)(await response.json());
          const result = json.data?.[0];

          if (!result?.b64_json) throw new Error("image response missing b64_json");

          return {
            bytes: Uint8Array.from(Buffer.from(result.b64_json, "base64")),
            mimeType: result.media_type ?? "image/jpeg",
            model: input.model,
            costUsd: json.usage?.cost,
          };
        },
        catch: (error) =>
          error instanceof ImageGenerationFailed
            ? error
            : new ImageGenerationFailed({
                operation: "generate",
                message: error instanceof Error ? error.message : String(error),
                recovery: {
                  error: "image_generation_failed",
                  retryableWithoutChanges: false,
                  instruction:
                    "Generation did not complete. The cause is not confirmed; do not claim a provider outage or retry repeatedly.",
                },
              }),
      }),
  });
