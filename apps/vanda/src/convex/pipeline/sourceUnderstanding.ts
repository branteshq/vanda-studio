import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { decodeUnknownEffect } from "effect/Schema";

export const SOURCE_UNDERSTANDING_MODEL = "google/gemini-2.5-flash";
export const SOURCE_UNDERSTANDING_VERSION = "source-evidence-v1";
const MAX_MODEL_VIDEO_BYTES = 25_000_000;

export const FrameEvidence = Schema.Struct({
  timestampMs: Schema.Number,
  description: Schema.String,
  onScreenText: Schema.optional(Schema.String),
});
export type FrameEvidence = typeof FrameEvidence.Type;

export const SourceEvidence = Schema.Struct({
  transcript: Schema.String,
  language: Schema.String,
  transcriptConfidence: Schema.Number,
  contentType: Schema.Literals(["spoken", "text_led", "visual", "mixed", "unknown"]),
  visualDescription: Schema.String,
  visualConfidence: Schema.Number,
  frameEvidence: Schema.Array(FrameEvidence),
});
export type SourceEvidence = typeof SourceEvidence.Type;

export class SourceUnderstandingFailed extends Data.TaggedError("SourceUnderstandingFailed")<{
  readonly operation: string;
  readonly message: string;
}> {}

export interface SourceUnderstandingShape {
  readonly analyze: (input: {
    readonly video: Blob;
    readonly caption?: string | undefined;
  }) => Effect.Effect<SourceEvidence, SourceUnderstandingFailed>;
}

export class SourceUnderstanding extends Context.Service<
  SourceUnderstanding,
  SourceUnderstandingShape
>()("@vanda/market/SourceUnderstanding") {}

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "transcript",
    "language",
    "transcriptConfidence",
    "contentType",
    "visualDescription",
    "visualConfidence",
    "frameEvidence",
  ],
  properties: {
    transcript: { type: "string" },
    language: { type: "string" },
    transcriptConfidence: { type: "number", minimum: 0, maximum: 1 },
    contentType: {
      type: "string",
      enum: ["spoken", "text_led", "visual", "mixed", "unknown"],
    },
    visualDescription: { type: "string" },
    visualConfidence: { type: "number", minimum: 0, maximum: 1 },
    frameEvidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timestampMs", "description"],
        properties: {
          timestampMs: { type: "number", minimum: 0 },
          description: { type: "string" },
          onScreenText: { type: "string" },
        },
      },
    },
  },
} as const;

const sourcePrompt = (caption: string | undefined): string =>
  `Extraia evidência factual deste vídeo do Instagram para análise posterior. Não explique por ` +
  `que o conteúdo funciona e não invente contexto. Transcreva exatamente a fala inteligível; se ` +
  `não houver fala, transcript deve ser vazio. Identifique o idioma. Descreva objetivamente a ` +
  `sequência visual e forneça de 3 a 8 momentos representativos com timestamps em milissegundos, ` +
  `incluindo todo texto legível na tela. Use confidence de 0 a 1 para a fidelidade da transcrição ` +
  `e da leitura visual. A legenda fornecida é contexto e não deve ser copiada para transcript.\n\n` +
  `Legenda: ${caption?.trim() || "(indisponível)"}`;

const parseResponseContent = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null) throw new Error("invalid OpenRouter response");
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new Error("empty OpenRouter response");
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) throw new Error("missing response message");
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") throw new Error("response content is not JSON text");
  return JSON.parse(content) as unknown;
};

export const openRouterSourceUnderstandingLayer = (
  apiKey: string,
  model = SOURCE_UNDERSTANDING_MODEL,
): Layer.Layer<SourceUnderstanding> =>
  Layer.succeed(SourceUnderstanding, {
    analyze: ({ video, caption }) => {
      if (video.size > MAX_MODEL_VIDEO_BYTES)
        return new SourceUnderstandingFailed({
          operation: "analyze",
          message: `video exceeds ${MAX_MODEL_VIDEO_BYTES} byte understanding limit`,
        });
      return Effect.tryPromise({
        try: async () => {
          const mime = ["video/mp4", "video/mpeg", "video/quicktime", "video/webm"].includes(
            video.type,
          )
            ? video.type
            : "video/mp4";
          const encoded = Buffer.from(await video.arrayBuffer()).toString("base64");
          const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: sourcePrompt(caption) },
                    {
                      type: "video_url",
                      video_url: { url: `data:${mime};base64,${encoded}` },
                    },
                  ],
                },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "source_evidence",
                  strict: true,
                  schema: responseJsonSchema,
                },
              },
            }),
          });
          if (!response.ok)
            throw new Error(`OpenRouter HTTP ${response.status}: ${await response.text()}`);
          return parseResponseContent(await response.json());
        },
        catch: (error) =>
          new SourceUnderstandingFailed({
            operation: "analyze",
            message: error instanceof Error ? error.message : String(error),
          }),
      }).pipe(
        Effect.flatMap((value) =>
          decodeUnknownEffect(SourceEvidence)(value).pipe(
            Effect.mapError(
              (error) =>
                new SourceUnderstandingFailed({
                  operation: "decode",
                  message: String(error),
                }),
            ),
          ),
        ),
      );
    },
  });
