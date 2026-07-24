import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import { decodeUnknownEffect } from "effect/Schema";

const HexColor = Schema.String;

export const VisualAssetInspection = Schema.Struct({
  description: Schema.String,
  subjects: Schema.Array(Schema.String),
  dominantColors: Schema.Array(HexColor),
  containsText: Schema.Boolean,
  containsFace: Schema.Boolean,
  containsProduct: Schema.Boolean,
  safeForBrandUse: Schema.Boolean,
  allowedRoles: Schema.Array(
    Schema.Literals(["style_reference", "background", "subject", "product", "portrait", "logo"]),
  ),
  warnings: Schema.Array(Schema.String),
  confidence: Schema.Number,
});
export type VisualAssetInspection = typeof VisualAssetInspection.Type;

export const VisualBrandPlan = Schema.Struct({
  name: Schema.String,
  rationale: Schema.String,
  palette: Schema.Struct({
    background: HexColor,
    surface: HexColor,
    text: HexColor,
    muted: HexColor,
    accent: HexColor,
    accentContrast: HexColor,
  }),
  typography: Schema.Struct({
    headline: Schema.Literals(["modern_sans", "humanist_sans", "editorial_serif"]),
    body: Schema.Literals(["modern_sans", "humanist_sans", "editorial_serif"]),
    weight: Schema.Literals(["regular", "medium", "bold", "black"]),
  }),
  artDirection: Schema.String,
  motifs: Schema.Array(Schema.String),
  photoTreatment: Schema.Literals(["natural", "warm", "cool", "duotone", "none"]),
  avoid: Schema.Array(Schema.String),
});
export type VisualBrandPlan = typeof VisualBrandPlan.Type;

export interface VisualBrandInput {
  readonly accountName: string;
  readonly kind: string;
  readonly facts: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly text: string;
  }>;
  readonly assets: ReadonlyArray<{
    readonly id: string;
    readonly inspection: VisualAssetInspection;
  }>;
}

export const planVisualBrand = (input: VisualBrandInput) =>
  LanguageModel.generateObject({
    schema: VisualBrandPlan,
    prompt:
      `Você é uma diretora de identidade visual. Defina um sistema visual enxuto e utilizável para ` +
      `carrosséis de Instagram. Use somente o contexto confirmado e as inspeções de ativos. As seis ` +
      `cores devem ser hexadecimais #RRGGBB, ter contraste real e funcionar juntas: text sobre ` +
      `background deve ter contraste mínimo 4.5:1 e accentContrast sobre accent também. Escolha uma ` +
      `família tipográfica permitida pelo schema, direção de arte, 2 a 4 motivos gráficos reutilizáveis ` +
      `e o que evitar. Não invente logo, cor oficial, credencial ou símbolo proprietário; quando não ` +
      `houver evidência, crie uma direção editorial apropriada e descreva-a como sistema de produção, ` +
      `não como identidade oficial. Responda em português do Brasil.\n\n` +
      `CONTA\n${input.accountName} (${input.kind})\n\nFATOS\n${input.facts
        .map((fact) => `- [${fact.id}] ${fact.kind}: ${fact.text}`)
        .join("\n")}\n\nATIVOS INSPECIONADOS\n${JSON.stringify(input.assets)}`,
  }).pipe(Effect.map((response) => response.value));

export interface VisualBrandValidation {
  readonly valid: boolean;
  readonly issues: ReadonlyArray<string>;
  readonly textContrast: number;
  readonly accentContrast: number;
}

const HEX = /^#[0-9a-f]{6}$/i;

const luminance = (hex: string): number => {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
};

export const contrastRatio = (first: string, second: string): number => {
  if (!HEX.test(first) || !HEX.test(second)) return 0;
  const light = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (light + 0.05) / (dark + 0.05);
};

export const validateVisualBrand = (plan: VisualBrandPlan): VisualBrandValidation => {
  const issues: string[] = [];
  for (const [key, color] of Object.entries(plan.palette))
    if (!HEX.test(color)) issues.push(`invalid_color:${key}`);
  const textContrast = contrastRatio(plan.palette.text, plan.palette.background);
  const accentContrast = contrastRatio(plan.palette.accentContrast, plan.palette.accent);
  if (textContrast < 4.5) issues.push("insufficient_text_contrast");
  if (accentContrast < 4.5) issues.push("insufficient_accent_contrast");
  if (plan.motifs.length < 2) issues.push("visual_system_requires_two_motifs");
  return {
    valid: issues.length === 0,
    issues,
    textContrast,
    accentContrast,
  };
};

export class AssetInspectionFailed extends Data.TaggedError("AssetInspectionFailed")<{
  readonly operation: string;
  readonly message: string;
}> {}

export interface AssetInspectorShape {
  readonly inspect: (input: {
    readonly image: Blob;
    readonly context: string;
  }) => Effect.Effect<VisualAssetInspection, AssetInspectionFailed>;
}

export class AssetInspector extends Context.Service<AssetInspector, AssetInspectorShape>()(
  "@vanda/studio/AssetInspector",
) {}

const inspectionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "description",
    "subjects",
    "dominantColors",
    "containsText",
    "containsFace",
    "containsProduct",
    "safeForBrandUse",
    "allowedRoles",
    "warnings",
    "confidence",
  ],
  properties: {
    description: { type: "string" },
    subjects: { type: "array", items: { type: "string" } },
    dominantColors: { type: "array", items: { type: "string" } },
    containsText: { type: "boolean" },
    containsFace: { type: "boolean" },
    containsProduct: { type: "boolean" },
    safeForBrandUse: { type: "boolean" },
    allowedRoles: {
      type: "array",
      items: {
        type: "string",
        enum: ["style_reference", "background", "subject", "product", "portrait", "logo"],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

const parseOpenRouterJson = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null) throw new Error("invalid OpenRouter response");
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new Error("empty OpenRouter response");
  const message = (choices[0] as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) throw new Error("missing response message");
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") throw new Error("response content is not JSON text");
  return JSON.parse(content) as unknown;
};

export const openRouterAssetInspectorLayer = (
  apiKey: string,
  model = "google/gemini-2.5-flash",
): Layer.Layer<AssetInspector> =>
  Layer.succeed(AssetInspector, {
    inspect: ({ image, context }) =>
      Effect.tryPromise({
        try: async () => {
          const mime = image.type.startsWith("image/") ? image.type : "image/jpeg";
          const encoded = Buffer.from(await image.arrayBuffer()).toString("base64");
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
                    {
                      type: "text",
                      text:
                        `Inspecione esta imagem autorizada para produção de conteúdo. Descreva ` +
                        `objetivamente sujeitos, texto, produtos, cores dominantes em #RRGGBB, riscos ` +
                        `e papéis visuais realmente sustentados pela imagem. Não identifique pessoas ` +
                        `por nome e não presuma autorização além do uso interno fornecido.\nContexto: ${context}`,
                    },
                    { type: "image_url", image_url: { url: `data:${mime};base64,${encoded}` } },
                  ],
                },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "visual_asset_inspection",
                  strict: true,
                  schema: inspectionJsonSchema,
                },
              },
            }),
          });
          if (!response.ok)
            throw new Error(`OpenRouter HTTP ${response.status}: ${await response.text()}`);
          return parseOpenRouterJson(await response.json());
        },
        catch: (error) =>
          new AssetInspectionFailed({
            operation: "inspect",
            message: error instanceof Error ? error.message : String(error),
          }),
      }).pipe(
        Effect.flatMap((value) =>
          decodeUnknownEffect(VisualAssetInspection)(value).pipe(
            Effect.mapError(
              (error) => new AssetInspectionFailed({ operation: "decode", message: String(error) }),
            ),
          ),
        ),
      ),
  });
