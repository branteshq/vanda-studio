import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";

const UnitScore = Schema.Number;

export const NarrativeBeat = Schema.Struct({
  role: Schema.String,
  description: Schema.String,
});
export type NarrativeBeat = typeof NarrativeBeat.Type;

export const PerformanceHypothesis = Schema.Struct({
  hypothesis: Schema.String,
  evidence: Schema.Array(Schema.String),
  confidence: UnitScore,
});
export type PerformanceHypothesis = typeof PerformanceHypothesis.Type;

export const MechanismAnalysis = Schema.Struct({
  sourceSummary: Schema.String,
  hook: Schema.Struct({
    type: Schema.String,
    mechanism: Schema.String,
    evidence: Schema.String,
  }),
  tension: Schema.String,
  audiencePromise: Schema.String,
  narrativeBeats: Schema.Array(NarrativeBeat),
  proof: Schema.String,
  payoff: Schema.String,
  callToAction: Schema.String,
  pacing: Schema.Struct({
    tempo: Schema.String,
    progression: Schema.String,
    patternInterrupts: Schema.Array(Schema.String),
  }),
  visualGrammar: Schema.Struct({
    composition: Schema.String,
    motion: Schema.String,
    textTreatment: Schema.String,
    recurringDevices: Schema.Array(Schema.String),
  }),
  reusableMechanisms: Schema.Array(Schema.String),
  creatorSpecificElements: Schema.Array(Schema.String),
  performanceHypotheses: Schema.Array(PerformanceHypothesis),
  uncertainties: Schema.Array(Schema.String),
  adaptable: Schema.Boolean,
  rejectionReason: Schema.String,
  confidence: UnitScore,
});
export type MechanismAnalysis = typeof MechanismAnalysis.Type;

export const CreativeDirection = Schema.Struct({
  title: Schema.String,
  concept: Schema.String,
  objective: Schema.String,
  targetAudience: Schema.String,
  angle: Schema.String,
  hook: Schema.String,
  narrativeArc: Schema.Array(Schema.String),
  visualDirection: Schema.String,
  callToAction: Schema.String,
  brandFactIds: Schema.Array(Schema.String),
  requiredAssets: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      description: Schema.String,
      strategy: Schema.Literals(["available", "generate", "needs_owner", "not_needed"]),
    }),
  ),
  retainedMechanisms: Schema.Array(Schema.String),
  avoidedSourceElements: Schema.Array(Schema.String),
  brandFitScore: UnitScore,
  evidenceFitScore: UnitScore,
  noveltyScore: UnitScore,
  feasibilityScore: UnitScore,
  riskScore: UnitScore,
});
export type CreativeDirection = typeof CreativeDirection.Type;

export const CreativeDirectionSet = Schema.Struct({
  directions: Schema.Array(CreativeDirection),
});
export type CreativeDirectionSet = typeof CreativeDirectionSet.Type;

export const BriefBeat = Schema.Struct({
  position: Schema.Number,
  role: Schema.String,
  intent: Schema.String,
  keyMessage: Schema.String,
  visualInstruction: Schema.String,
});
export type BriefBeat = typeof BriefBeat.Type;

export const CreativeBrief = Schema.Struct({
  title: Schema.String,
  objective: Schema.String,
  targetAudience: Schema.String,
  format: Schema.Literal("carousel"),
  coreMessage: Schema.String,
  audiencePromise: Schema.String,
  angle: Schema.String,
  hook: Schema.String,
  narrativeBeats: Schema.Array(BriefBeat),
  visualSystem: Schema.String,
  tone: Schema.Array(Schema.String),
  callToAction: Schema.String,
  brandFactIds: Schema.Array(Schema.String),
  sourceMechanisms: Schema.Array(Schema.String),
  excludedSourceElements: Schema.Array(Schema.String),
  assetRequirements: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      description: Schema.String,
      strategy: Schema.Literals(["available", "generate", "needs_owner", "not_needed"]),
    }),
  ),
  restrictionsApplied: Schema.Array(Schema.String),
  productionNotes: Schema.Array(Schema.String),
  confidence: UnitScore,
});
export type CreativeBrief = typeof CreativeBrief.Type;

export const BriefSelection = Schema.Struct({
  selectedDirectionNumber: Schema.Number,
  selectionReason: Schema.String,
  tradeoffs: Schema.Array(Schema.String),
  rejectedDirectionReasons: Schema.Array(Schema.String),
  brief: CreativeBrief,
});
export type BriefSelection = typeof BriefSelection.Type;

export const BriefReview = Schema.Struct({
  decision: Schema.Literals(["approved", "rejected"]),
  summary: Schema.String,
  brandGrounding: Schema.Array(
    Schema.Struct({
      factId: Schema.String,
      usage: Schema.String,
    }),
  ),
  unsupportedClaims: Schema.Array(Schema.String),
  similarityRisks: Schema.Array(Schema.String),
  missingAssets: Schema.Array(Schema.String),
  issues: Schema.Array(Schema.String),
  confidence: UnitScore,
});
export type BriefReview = typeof BriefReview.Type;

export interface CreativeDirectorSource {
  readonly sourceCaption?: string | undefined;
  readonly transcript?: string | undefined;
  readonly visualDescription?: string | undefined;
  readonly frameEvidence: ReadonlyArray<{
    readonly timestampMs: number;
    readonly description: string;
    readonly onScreenText?: string | undefined;
  }>;
  readonly triggerReason: string;
  readonly creatorHandle?: string | undefined;
}

export interface BrandFactInput {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
}

export interface CreativeDirectorBrand {
  readonly facts: ReadonlyArray<BrandFactInput>;
  readonly context: string;
  readonly referenceAssetCount: number;
}

const sourceBlock = (source: CreativeDirectorSource): string =>
  [
    `Criador: ${source.creatorHandle ? `@${source.creatorHandle}` : "desconhecido"}`,
    `Evidência de tração: ${source.triggerReason}`,
    `Legenda: ${source.sourceCaption?.trim() || "(indisponível)"}`,
    `Transcrição: ${source.transcript?.trim() || "(sem fala utilizável)"}`,
    `Descrição visual: ${source.visualDescription?.trim() || "(indisponível)"}`,
    `Momentos observados:\n${source.frameEvidence
      .slice(0, 10)
      .map(
        (frame) =>
          `- ${frame.timestampMs}ms: ${frame.description}${frame.onScreenText ? `; texto=${frame.onScreenText}` : ""}`,
      )
      .join("\n")}`,
  ].join("\n\n");

const brandBlock = (brand: CreativeDirectorBrand): string =>
  `${brand.context}\n\nFatos permitidos com IDs:\n${brand.facts
    .map((fact) => `- [${fact.id}] ${fact.kind}: ${fact.text}`)
    .join("\n")}\n\nAtivos visuais de referência disponíveis: ${brand.referenceAssetCount}`;

export const analyzeSourceMechanism = (input: { readonly source: CreativeDirectorSource }) =>
  LanguageModel.generateObject({
    schema: MechanismAnalysis,
    prompt:
      `Você é uma estrategista sênior analisando uma fonte de Instagram. Descreva somente ` +
      `mecanismos sustentados pela evidência. Não confunda correlação com causalidade. Separe ` +
      `rigorosamente mecanismos transferíveis de palavras, identidade, história, imagens e ` +
      `performance específicas do criador. performanceHypotheses deve citar evidência observável ` +
      `e confiança de 0 a 1. adaptable=false quando a fonte é incompreensível, depende da identidade ` +
      `do criador, não possui mecanismo transferível ou exigiria copiar expressão protegida. ` +
      `rejectionReason deve ser vazio quando adaptable=true. Responda em português do Brasil.\n\n` +
      sourceBlock(input.source),
  }).pipe(Effect.map((response) => response.value));

export const generateCreativeDirections = (input: {
  readonly source: CreativeDirectorSource;
  readonly analysis: MechanismAnalysis;
  readonly brand: CreativeDirectorBrand;
}) =>
  LanguageModel.generateObject({
    schema: CreativeDirectionSet,
    prompt:
      `Você é uma diretora criativa. Gere exatamente três direções de carrossel materialmente ` +
      `diferentes para a marca: elas devem variar em ângulo, promessa, hook e arco narrativo, não ` +
      `apenas em palavras. Use somente fatos da marca fornecidos e preserve seus IDs exatamente em ` +
      `brandFactIds. Retenha mecanismos abstratos úteis, mas não reutilize frases, personagem, ` +
      `história, imagens ou identidade da fonte. Todo ativo deve declarar strategy: available somente ` +
      `quando a lista de ativos permite, generate para produção autorizada, needs_owner quando depende ` +
      `do proprietário ou not_needed. Dê notas honestas de 0 a 1. Responda em português do Brasil.\n\n` +
      `FONTE\n${sourceBlock(input.source)}\n\nANÁLISE\n${JSON.stringify(input.analysis)}\n\n` +
      `MARCA\n${brandBlock(input.brand)}`,
  }).pipe(Effect.map((response) => response.value));

export const selectCreativeBrief = (input: {
  readonly analysis: MechanismAnalysis;
  readonly directions: ReadonlyArray<CreativeDirection & { readonly totalScore: number }>;
  readonly brand: CreativeDirectorBrand;
}) =>
  LanguageModel.generateObject({
    schema: BriefSelection,
    prompt:
      `Você é a diretora criativa responsável pela decisão final. Selecione uma das três direções ` +
      `considerando o score determinístico, adequação à marca, originalidade, evidência e viabilidade. ` +
      `selectedDirectionNumber é 1, 2 ou 3. Transforme somente a direção selecionada em um brief de ` +
      `produção completo para carrossel com 3 a 7 beats. Não escreva o copy final dos slides: defina ` +
      `intenção, mensagem e instrução visual. Preserve apenas IDs de fatos fornecidos. Não introduza ` +
      `afirmações factuais novas. Explique os trade-offs e por que rejeitou as outras duas. Responda ` +
      `em português do Brasil.\n\nANÁLISE\n${JSON.stringify(input.analysis)}\n\nDIREÇÕES\n` +
      `${JSON.stringify(input.directions)}\n\nMARCA\n${brandBlock(input.brand)}`,
  }).pipe(Effect.map((response) => response.value));

export const reviewCreativeBrief = (input: {
  readonly source: CreativeDirectorSource;
  readonly analysis: MechanismAnalysis;
  readonly direction: CreativeDirection;
  readonly brief: CreativeBrief;
  readonly brand: CreativeDirectorBrand;
}) =>
  LanguageModel.generateObject({
    schema: BriefReview,
    prompt:
      `Você é uma revisora editorial independente. Procure motivos para rejeitar este brief. ` +
      `Verifique: uso de fatos inexistentes, afirmações sem suporte, proximidade excessiva com ` +
      `expressão/identidade/história da fonte, contradições de marca, ativos obrigatórios ausentes e ` +
      `instruções insuficientes para produção. Aprove somente quando não houver unsupportedClaims, ` +
      `similarityRisks ou issues bloqueantes. brandGrounding deve ligar cada fato realmente usado ao ` +
      `ID confirmado. Não tente corrigir o brief silenciosamente. Responda em português do Brasil.\n\n` +
      `FONTE\n${sourceBlock(input.source)}\n\nANÁLISE\n${JSON.stringify(input.analysis)}\n\n` +
      `DIREÇÃO\n${JSON.stringify(input.direction)}\n\nBRIEF\n${JSON.stringify(input.brief)}\n\n` +
      `MARCA\n${brandBlock(input.brand)}`,
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

export const scoreCreativeDirection = (direction: CreativeDirection): number => {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (clamp(direction.brandFitScore) * 0.35 +
          clamp(direction.evidenceFitScore) * 0.25 +
          clamp(direction.noveltyScore) * 0.2 +
          clamp(direction.feasibilityScore) * 0.2 -
          clamp(direction.riskScore) * 0.25) *
          100,
      ),
    ),
  );
};

export const validateDirectionSet = (
  directions: ReadonlyArray<CreativeDirection>,
): ReadonlyArray<string> => {
  const issues: string[] = [];
  if (directions.length !== 3) issues.push("direction_count_must_be_three");
  for (let left = 0; left < directions.length; left += 1) {
    for (let right = left + 1; right < directions.length; right += 1) {
      const first = directions[left]!;
      const second = directions[right]!;
      const similarity = jaccard(
        tokens(`${first.title} ${first.angle} ${first.hook} ${first.concept}`),
        tokens(`${second.title} ${second.angle} ${second.hook} ${second.concept}`),
      );
      if (similarity >= 0.65) issues.push(`directions_${left + 1}_${right + 1}_too_similar`);
    }
  }
  return issues;
};

const sourceExpression = (source: CreativeDirectorSource): string =>
  `${source.sourceCaption ?? ""} ${source.transcript ?? ""} ${source.frameEvidence
    .map((frame) => frame.onScreenText ?? "")
    .join(" ")}`;

const briefExpression = (brief: CreativeBrief): string =>
  `${brief.hook} ${brief.coreMessage} ${brief.narrativeBeats
    .map((beat) => `${beat.keyMessage} ${beat.visualInstruction}`)
    .join(" ")}`;

export interface CreativePackageValidation {
  readonly valid: boolean;
  readonly issues: ReadonlyArray<string>;
  readonly sourceSimilarity: number;
}

export const validateCreativePackage = (input: {
  readonly source: CreativeDirectorSource;
  readonly directions: ReadonlyArray<CreativeDirection>;
  readonly selection: BriefSelection;
  readonly review: BriefReview;
  readonly allowedBrandFactIds: ReadonlySet<string>;
  readonly referenceAssetCount: number;
}): CreativePackageValidation => {
  const issues = [...validateDirectionSet(input.directions)];
  const selectedIndex = input.selection.selectedDirectionNumber - 1;
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= 3)
    issues.push("invalid_selected_direction");
  if (input.selection.brief.narrativeBeats.length < 3)
    issues.push("brief_requires_at_least_three_beats");
  if (input.selection.brief.narrativeBeats.length > 7) issues.push("brief_exceeds_seven_beats");
  for (const direction of input.directions) {
    for (const factId of direction.brandFactIds)
      if (!input.allowedBrandFactIds.has(factId)) issues.push(`unknown_direction_fact:${factId}`);
    if (
      input.referenceAssetCount === 0 &&
      direction.requiredAssets.some((asset) => asset.strategy === "available")
    )
      issues.push("direction_claims_unavailable_asset");
  }
  for (const factId of input.selection.brief.brandFactIds)
    if (!input.allowedBrandFactIds.has(factId)) issues.push(`unknown_brand_fact:${factId}`);
  if (
    input.referenceAssetCount === 0 &&
    input.selection.brief.assetRequirements.some((asset) => asset.strategy === "available")
  )
    issues.push("brief_claims_unavailable_asset");
  for (const grounding of input.review.brandGrounding)
    if (!input.allowedBrandFactIds.has(grounding.factId))
      issues.push(`unknown_review_fact:${grounding.factId}`);
  if (input.review.decision !== "approved") issues.push("editorial_review_rejected");
  if (input.review.unsupportedClaims.length > 0) issues.push("unsupported_claims");
  if (input.review.similarityRisks.length > 0) issues.push("review_similarity_risk");
  if (input.review.issues.length > 0) issues.push("editorial_issues");
  const sourceSimilarity = jaccard(
    tokens(sourceExpression(input.source)),
    tokens(briefExpression(input.selection.brief)),
  );
  if (sourceSimilarity >= 0.55) issues.push("deterministic_source_similarity");
  return { valid: issues.length === 0, issues: [...new Set(issues)], sourceSimilarity };
};
