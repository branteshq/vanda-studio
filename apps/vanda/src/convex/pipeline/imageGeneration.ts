import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface GeneratedVisual {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly model: string;
}

export class ImageGenerationFailed extends Data.TaggedError("ImageGenerationFailed")<{
  readonly operation: string;
  readonly message: string;
}> {}

export interface ImageAssetGeneratorShape {
  readonly generate: (input: {
    readonly prompt: string;
    readonly referenceUrls?: ReadonlyArray<string> | undefined;
  }) => Effect.Effect<GeneratedVisual, ImageGenerationFailed>;
}

export class ImageAssetGenerator extends Context.Service<
  ImageAssetGenerator,
  ImageAssetGeneratorShape
>()("@vanda/studio/ImageAssetGenerator") {}

interface OpenRouterImageResponse {
  readonly data?: ReadonlyArray<{
    readonly b64_json?: string;
    readonly media_type?: string;
  }>;
}

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
  const json = (await response.json()) as {
    choices?: ReadonlyArray<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("asset review response is empty");
  const review = JSON.parse(content) as GeneratedAssetReview;
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
    generate: ({ prompt, referenceUrls }) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch("https://openrouter.ai/api/v1/images", {
            method: "POST",
            headers: {
              authorization: `Bearer ${input.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: input.model,
              prompt,
              n: 1,
              size: "2048x2560",
              quality: "high",
              output_format: "jpeg",
              output_compression: 90,
              background: "opaque",
              ...(referenceUrls && referenceUrls.length > 0
                ? { input_references: referenceUrls.slice(0, 3) }
                : {}),
            }),
          });
          if (!response.ok)
            throw new Error(`OpenRouter HTTP ${response.status}: ${await response.text()}`);
          const json = (await response.json()) as OpenRouterImageResponse;
          const result = json.data?.[0];
          if (!result?.b64_json) throw new Error("image response missing b64_json");
          return {
            bytes: Uint8Array.from(Buffer.from(result.b64_json, "base64")),
            mimeType: result.media_type ?? "image/jpeg",
            model: input.model,
          };
        },
        catch: (error) =>
          new ImageGenerationFailed({
            operation: "generate",
            message: error instanceof Error ? error.message : String(error),
          }),
      }),
  });
