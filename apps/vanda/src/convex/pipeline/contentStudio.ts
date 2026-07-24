import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import type { CreativeBrief } from "./creativeDirector";

export const CarouselSlide = Schema.Struct({
  slideId: Schema.String,
  position: Schema.Number,
  role: Schema.Literals(["cover", "context", "content", "proof", "summary", "cta"]),
  layout: Schema.Literals([
    "statement",
    "editorial",
    "list",
    "steps",
    "comparison",
    "split",
    "quote",
    "cta",
  ]),
  kicker: Schema.String,
  headline: Schema.String,
  body: Schema.String,
  bullets: Schema.Array(Schema.String),
  factIds: Schema.Array(Schema.String),
  visual: Schema.Struct({
    kind: Schema.Literals([
      "none",
      "reference",
      "photo",
      "illustration",
      "icon",
      "diagram",
      "texture",
    ]),
    strategy: Schema.Literals(["available", "generate", "needs_owner", "not_needed"]),
    assetIds: Schema.Array(Schema.String),
    prompt: Schema.String,
    altText: Schema.String,
    treatment: Schema.Literals(["none", "background", "full_bleed", "split", "inset", "cutout"]),
  }),
  productionNotes: Schema.Array(Schema.String),
});
export type CarouselSlide = typeof CarouselSlide.Type;

export const CarouselDocumentPlan = Schema.Struct({
  title: Schema.String,
  caption: Schema.String,
  accessibilityDescription: Schema.String,
  canvas: Schema.Struct({
    preset: Schema.Literal("instagram_portrait_4_5"),
    width: Schema.Literal(1080),
    height: Schema.Literal(1350),
  }),
  style: Schema.Struct({
    theme: Schema.Literals(["light", "dark", "brand"]),
    density: Schema.Literals(["sparse", "balanced", "rich"]),
    headlineCase: Schema.Literals(["sentence", "uppercase"]),
    cornerStyle: Schema.Literals(["square", "soft", "rounded"]),
    imageTreatment: Schema.Literals(["natural", "duotone", "cutout", "none"]),
    motifs: Schema.Array(Schema.String),
    referenceAssetIds: Schema.Array(Schema.String),
  }),
  brandFactIds: Schema.Array(Schema.String),
  slides: Schema.Array(CarouselSlide),
});
export type CarouselDocumentPlan = typeof CarouselDocumentPlan.Type;

export const CarouselDocumentReview = Schema.Struct({
  decision: Schema.Literals(["approved", "rejected"]),
  summary: Schema.String,
  unsupportedClaims: Schema.Array(Schema.String),
  brandIssues: Schema.Array(Schema.String),
  similarityRisks: Schema.Array(Schema.String),
  productionIssues: Schema.Array(Schema.String),
  corrections: Schema.Array(Schema.String),
  confidence: Schema.Number,
});
export type CarouselDocumentReview = typeof CarouselDocumentReview.Type;

export interface ContentStudioBrand {
  readonly facts: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly text: string;
  }>;
  readonly restrictions: ReadonlyArray<string>;
  readonly authorizedAssets: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly description: string;
  }>;
}

export interface ContentStudioSource {
  readonly caption?: string | undefined;
  readonly transcript?: string | undefined;
  readonly onScreenText: ReadonlyArray<string>;
}

const brandBlock = (brand: ContentStudioBrand): string =>
  `Fatos confirmados:\n${brand.facts.map((fact) => `- [${fact.id}] ${fact.kind}: ${fact.text}`).join("\n")}` +
  `\n\nRestrições:\n${brand.restrictions.length ? brand.restrictions.map((item) => `- ${item}`).join("\n") : "(nenhuma)"}` +
  `\n\nAtivos autorizados:\n${
    brand.authorizedAssets.length
      ? brand.authorizedAssets
          .map((asset) => `- [${asset.id}] ${asset.kind}: ${asset.description}`)
          .join("\n")
      : "(nenhum)"
  }`;

const sourceBlock = (source: ContentStudioSource): string =>
  `Legenda: ${source.caption?.trim() || "(indisponível)"}\n` +
  `Transcrição: ${source.transcript?.trim() || "(indisponível)"}\n` +
  `Texto em tela: ${source.onScreenText.join(" | ") || "(indisponível)"}`;

export const planCarouselDocument = (input: {
  readonly brief: CreativeBrief;
  readonly brand: ContentStudioBrand;
}) =>
  LanguageModel.generateObject({
    schema: CarouselDocumentPlan,
    prompt:
      `Você é uma diretora de arte e redatora transformando um brief aprovado em um documento ` +
      `de carrossel pronto para produção. Escreva o copy final em português do Brasil. Produza de ` +
      `3 a 7 slides, com IDs estáveis slide-1, slide-2 etc. O primeiro slide deve ser cover e o ` +
      `último cta. Cada slide deve ter uma única função, headline curta, leitura rápida e progressão ` +
      `clara. Não compacte conteúdo prometido no slide de CTA: crie um slide adicional quando preciso. ` +
      `O CTA deve estar no copy visível (headline, body ou bullets), nunca apenas no prompt visual. ` +
      `kicker/body podem ser vazios; não preencha campos só por preencher. Cite em factIds ` +
      `cada fato de marca usado naquele slide e não invente fatos, números, resultados, depoimentos ` +
      `ou garantias. A legenda deve complementar o carrossel, não repeti-lo. ` +
      `Use somente os layouts e tokens do schema. referenceAssetIds servem apenas para orientar o ` +
      `sistema visual. Um reference_image tem conteúdo desconhecido e nunca deve ser colocado em um ` +
      `slide como rosto, produto ou local. Para visuais novos use strategy=generate, prompt concreto e ` +
      `assetIds vazio. strategy=available exige IDs exatos de ativos cujo conteúdo descrito realmente ` +
      `atende ao slide. needs_owner somente quando a ideia não pode ser produzida honestamente sem ` +
      `material do proprietário. Nunca invente ou gere logotipo, assinatura, selo, embalagem ou ` +
      `identidade proprietária; quando não houver logo autorizado, use somente texto simples. ` +
      `Respeite todas as restrições.\n\n` +
      `BRIEF APROVADO\n${JSON.stringify(input.brief)}\n\nMARCA\n${brandBlock(input.brand)}`,
  }).pipe(Effect.map((response) => response.value));

export const regenerateCarouselSlide = (input: {
  readonly document: CarouselDocumentPlan;
  readonly slideId: string;
  readonly instruction: string;
  readonly brand: ContentStudioBrand;
}) =>
  LanguageModel.generateObject({
    schema: CarouselSlide,
    prompt:
      `Você está revisando somente um slide de um carrossel. Retorne o slide completo mantendo ` +
      `exatamente slideId e position. Obedeça à instrução sem alterar silenciosamente os outros ` +
      `slides. Preserve a função narrativa, use apenas fatos e IDs confirmados e não invente claims. ` +
      `Siga as mesmas regras de ativos: available exige ID autorizado e adequação à descrição; ` +
      `generate/needs_owner/not_needed exigem assetIds vazio. Responda em português do Brasil.\n\n` +
      `INSTRUÇÃO\n${input.instruction}\n\nSLIDE\n${JSON.stringify(
        input.document.slides.find((slide) => slide.slideId === input.slideId),
      )}\n\nDOCUMENTO\n${JSON.stringify(input.document)}\n\nMARCA\n${brandBlock(input.brand)}`,
  }).pipe(Effect.map((response) => response.value));

export const reviewCarouselDocument = (input: {
  readonly brief: CreativeBrief;
  readonly document: CarouselDocumentPlan;
  readonly brand: ContentStudioBrand;
  readonly source: ContentStudioSource;
}) =>
  LanguageModel.generateObject({
    schema: CarouselDocumentReview,
    prompt:
      `Você é uma revisora editorial independente avaliando o copy final de um carrossel. Procure ` +
      `motivos concretos para rejeitar: fatos ou claims sem suporte, contradições da marca, cópia de ` +
      `palavras ou expressão distintiva da fonte, promessa além do brief, ativo usado sem autorização, ` +
      `texto incompreensível ou instrução impossível de produzir. Compartilhar tema, formato ou ` +
      `mecanismo abstrato não é cópia. A FONTE serve apenas para avaliar transformação; sua legenda ` +
      `não é a legenda final e não precisa ser harmonizada com o documento. Todos os fatos e ativos ` +
      `listados em MARCA já estão autorizados pelo proprietário; não peça uma segunda confirmação. ` +
      `reference_image pode orientar estilo, mas não conteúdo. Não rejeite por preferências estilísticas ` +
      `e não exija detalhes que pertencem ao renderer. Erros gramaticais, typos, palavras truncadas e ` +
      `frases ambíguas são bloqueantes. Rejeite também quando o slide final mistura conteúdo novo com ` +
      `CTA ou deixa a chamada para ação apenas na instrução visual, sem copy visível. productionIssues ` +
      `contém somente bloqueios que impedem produção; ` +
      `qualquer item ali exige decision=rejected. Sugestões não bloqueantes ficam em ` +
      `corrections. Nunca corrija silenciosamente. Aprove somente sem problemas bloqueantes. Responda ` +
      `em português do Brasil.\n\n` +
      `FONTE\n${sourceBlock(input.source)}\n\nBRIEF\n${JSON.stringify(input.brief)}\n\n` +
      `DOCUMENTO\n${JSON.stringify(input.document)}\n\nMARCA\n${brandBlock(input.brand)}`,
  }).pipe(Effect.map((response) => response.value));

const tokens = (text: string): ReadonlyArray<string> =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .match(/[a-z0-9]{3,}/g) ?? [];

const jaccard = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): number => {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
};

const documentExpression = (document: CarouselDocumentPlan): string =>
  `${document.caption} ${document.slides
    .map((slide) => `${slide.kicker} ${slide.headline} ${slide.body} ${slide.bullets.join(" ")}`)
    .join(" ")}`;

export interface CarouselValidation {
  readonly valid: boolean;
  readonly readyForRender: boolean;
  readonly issues: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly sourceSimilarity: number;
}

export const validateCarouselDocument = (input: {
  readonly document: CarouselDocumentPlan;
  readonly review: CarouselDocumentReview;
  readonly allowedBrandFactIds: ReadonlySet<string>;
  readonly allowedAssetIds: ReadonlySet<string>;
  readonly source: ContentStudioSource;
}): CarouselValidation => {
  const { document, review } = input;
  const issues: string[] = [];
  const warnings: string[] = [];
  if (document.canvas.preset !== "instagram_portrait_4_5") issues.push("invalid_canvas_preset");
  if (document.canvas.width !== 1080 || document.canvas.height !== 1350)
    issues.push("invalid_canvas_dimensions");
  if (document.slides.length < 3) issues.push("carousel_requires_at_least_three_slides");
  if (document.slides.length > 7) issues.push("carousel_exceeds_seven_slides");
  if (document.slides[0]?.role !== "cover") issues.push("first_slide_must_be_cover");
  if (document.slides.at(-1)?.role !== "cta") issues.push("last_slide_must_be_cta");
  if (document.caption.length > 2200) issues.push("caption_exceeds_instagram_limit");
  if (document.accessibilityDescription.trim().length === 0)
    issues.push("missing_accessibility_description");
  const seenIds = new Set<string>();
  for (const [index, slide] of document.slides.entries()) {
    if (slide.position !== index + 1) issues.push(`slide_position_mismatch:${slide.slideId}`);
    if (seenIds.has(slide.slideId)) issues.push(`duplicate_slide_id:${slide.slideId}`);
    seenIds.add(slide.slideId);
    if (slide.slideId !== `slide-${index + 1}`)
      warnings.push(`noncanonical_slide_id:${slide.slideId}`);
    if (slide.headline.trim().length === 0) issues.push(`empty_headline:${slide.slideId}`);
    if (slide.kicker.length > 40) issues.push(`kicker_too_long:${slide.slideId}`);
    if (slide.headline.length > 100) issues.push(`headline_too_long:${slide.slideId}`);
    if (slide.body.length > 320) issues.push(`body_too_long:${slide.slideId}`);
    if (slide.bullets.length > 5) issues.push(`too_many_bullets:${slide.slideId}`);
    if (slide.bullets.some((bullet) => bullet.length > 120))
      issues.push(`bullet_too_long:${slide.slideId}`);
    const totalCopy =
      slide.kicker.length +
      slide.headline.length +
      slide.body.length +
      slide.bullets.reduce((sum, bullet) => sum + bullet.length, 0);
    if (totalCopy > 550) issues.push(`slide_copy_too_dense:${slide.slideId}`);
    for (const factId of slide.factIds)
      if (!input.allowedBrandFactIds.has(factId))
        issues.push(`unknown_slide_fact:${slide.slideId}:${factId}`);
    const visual = slide.visual;
    if (visual.strategy === "available" && visual.assetIds.length === 0)
      issues.push(`available_visual_missing_asset:${slide.slideId}`);
    if (visual.assetIds.some((id) => !input.allowedAssetIds.has(id)))
      issues.push(`unauthorized_visual_asset:${slide.slideId}`);
    if (visual.strategy !== "available" && visual.assetIds.length > 0)
      issues.push(`nonavailable_visual_has_asset:${slide.slideId}`);
    if (visual.strategy === "generate" && visual.prompt.trim().length === 0)
      issues.push(`generated_visual_missing_prompt:${slide.slideId}`);
    if (visual.strategy === "needs_owner") issues.push(`owner_asset_required:${slide.slideId}`);
    if (visual.kind !== "none" && visual.altText.trim().length === 0)
      issues.push(`visual_missing_alt_text:${slide.slideId}`);
  }
  for (const factId of document.brandFactIds)
    if (!input.allowedBrandFactIds.has(factId)) issues.push(`unknown_document_fact:${factId}`);
  for (const assetId of document.style.referenceAssetIds)
    if (!input.allowedAssetIds.has(assetId)) issues.push(`unknown_style_reference:${assetId}`);
  if (review.decision !== "approved") issues.push("editorial_review_rejected");
  if (review.unsupportedClaims.length > 0) issues.push("unsupported_claims");
  if (review.brandIssues.length > 0) issues.push("brand_issues");
  if (review.similarityRisks.length > 0) issues.push("source_similarity_risk");
  if (review.productionIssues.length > 0) issues.push("production_issues");
  const sourceText = `${input.source.caption ?? ""} ${input.source.transcript ?? ""} ${input.source.onScreenText.join(" ")}`;
  const sourceSimilarity = jaccard(tokens(sourceText), tokens(documentExpression(document)));
  if (sourceSimilarity >= 0.55) issues.push("deterministic_source_similarity");
  const uniqueIssues = [...new Set(issues)];
  return {
    valid: uniqueIssues.length === 0,
    readyForRender: uniqueIssues.length === 0,
    issues: uniqueIssues,
    warnings: [...new Set(warnings)],
    sourceSimilarity,
  };
};

export const replaceCarouselSlide = (
  document: CarouselDocumentPlan,
  replacement: CarouselSlide,
): CarouselDocumentPlan => ({
  ...document,
  slides: document.slides.map((slide) =>
    slide.slideId === replacement.slideId ? replacement : slide,
  ),
});
