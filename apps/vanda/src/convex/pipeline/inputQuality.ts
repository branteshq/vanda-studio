import * as Schema from "effect/Schema";

export const DAY_MS = 86_400_000;
export const MAX_SOURCE_AGE_MS = 7 * DAY_MS;
export const EMERGING_SOURCE_AGE_MS = 72 * 3_600_000;
export const INPUT_QUALITY_VERSION = "input-quality-v1";
export const BREAKOUT_DETECTOR_VERSION = "breakout-v2";

export const InputRejectionCode = Schema.Literals([
  "brand_incomplete",
  "creator_irrelevant",
  "creator_blocked",
  "source_too_old",
  "invalid_published_at",
  "missing_views",
  "missing_followers",
  "weak_breakout",
  "missing_media",
  "unusable_transcript",
  "insufficient_visual_context",
  "unsupported_language",
  "provider_data_inconsistent",
  "duplicate_opportunity",
]);
export type InputRejectionCode = typeof InputRejectionCode.Type;

export const InputAssessmentDecision = Schema.Literals(["qualified", "rejected"]);
export type InputAssessmentDecision = typeof InputAssessmentDecision.Type;

export const InputAssessmentStage = Schema.Literals(["preflight", "final"]);
export type InputAssessmentStage = typeof InputAssessmentStage.Type;

export class InputAssessment extends Schema.Class<InputAssessment>("InputAssessment")({
  decision: InputAssessmentDecision,
  qualityScore: Schema.Number,
  rejectionCodes: Schema.Array(InputRejectionCode),
  warnings: Schema.Array(Schema.String),
}) {}

export interface BrandReadinessInput {
  readonly confirmedKinds: ReadonlyArray<string>;
}

export interface BrandReadinessResult {
  readonly ready: boolean;
  readonly score: number;
  readonly missingRequired: ReadonlyArray<string>;
  readonly missingRecommended: ReadonlyArray<string>;
}

const REQUIRED_BRAND_KINDS = ["identity", "summary", "voice"] as const;
const RECOMMENDED_BRAND_KINDS = [
  "positioning",
  "audience",
  "offer",
  "objective",
  "restriction",
] as const;

export const assessBrandReadiness = ({
  confirmedKinds,
}: BrandReadinessInput): BrandReadinessResult => {
  const kinds = new Set(confirmedKinds);
  const missingRequired = REQUIRED_BRAND_KINDS.filter((kind) => !kinds.has(kind));
  const missingRecommended = RECOMMENDED_BRAND_KINDS.filter((kind) => !kinds.has(kind));
  const total = REQUIRED_BRAND_KINDS.length + RECOMMENDED_BRAND_KINDS.length;
  const score = (total - missingRequired.length - missingRecommended.length) / Math.max(1, total);
  return {
    ready: missingRequired.length === 0,
    score,
    missingRequired,
    missingRecommended,
  };
};

const semanticWords = (value: string | undefined): ReadonlyArray<string> =>
  (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu) ?? [];

export const isUsableSemanticText = (value: string | undefined): boolean => {
  const words = semanticWords(value);
  if (words.length < 6) return false;
  return new Set(words).size >= 4;
};

export interface PreflightInput {
  readonly now: number;
  readonly publishedAt: number;
  readonly followers?: number | undefined;
  readonly views?: number | undefined;
  readonly plays?: number | undefined;
  readonly creatorRelevanceScore: number;
  readonly creatorBlocked?: boolean | undefined;
  readonly brandReady: boolean;
}

export const assessPreflightInput = (input: PreflightInput): InputAssessment => {
  const rejectionCodes: InputRejectionCode[] = [];
  const warnings: string[] = [];
  const views = input.views ?? input.plays;
  const age = input.now - input.publishedAt;

  if (!input.brandReady) rejectionCodes.push("brand_incomplete");
  if (input.creatorBlocked) rejectionCodes.push("creator_blocked");
  if (input.creatorRelevanceScore < 0.65) rejectionCodes.push("creator_irrelevant");
  if (!Number.isFinite(input.publishedAt) || age < -3_600_000)
    rejectionCodes.push("invalid_published_at");
  else if (age > MAX_SOURCE_AGE_MS) rejectionCodes.push("source_too_old");
  if (views === undefined || !Number.isFinite(views) || views < 0)
    rejectionCodes.push("missing_views");
  if (input.followers === undefined || !Number.isFinite(input.followers) || input.followers <= 0)
    rejectionCodes.push("missing_followers");
  if (age > EMERGING_SOURCE_AGE_MS && age <= MAX_SOURCE_AGE_MS)
    warnings.push("source_outside_emerging_window");

  const freshness = Number.isFinite(age)
    ? Math.max(0, 1 - Math.max(0, age) / MAX_SOURCE_AGE_MS)
    : 0;
  const metricConfidence = views !== undefined && input.followers !== undefined ? 1 : 0;
  const qualityScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        (input.creatorRelevanceScore * 0.45 + freshness * 0.35 + metricConfidence * 0.2) * 100,
      ),
    ),
  );

  return InputAssessment.make({
    decision: rejectionCodes.length === 0 ? "qualified" : "rejected",
    qualityScore,
    rejectionCodes,
    warnings,
  });
};

export interface FinalInput extends PreflightInput {
  readonly caption?: string | undefined;
  readonly transcript?: string | undefined;
  readonly hasDurableVideo: boolean;
  readonly hasDurableThumbnail: boolean;
  readonly frameCount: number;
  readonly visualDescription?: string | undefined;
}

export const assessFinalInput = (input: FinalInput): InputAssessment => {
  const preflight = assessPreflightInput(input);
  const rejectionCodes = [...preflight.rejectionCodes];
  const warnings = [...preflight.warnings];
  const usableTranscript = isUsableSemanticText(input.transcript);
  const usableCaption = isUsableSemanticText(input.caption);
  const usableVisualEvidence =
    input.frameCount >= 3 ||
    input.hasDurableVideo ||
    (input.hasDurableThumbnail && isUsableSemanticText(input.visualDescription));

  if (!input.hasDurableVideo && !input.hasDurableThumbnail && input.frameCount === 0)
    rejectionCodes.push("missing_media");
  if (input.transcript && !usableTranscript) warnings.push("transcript_unusable");
  if (!usableTranscript && !usableCaption && !usableVisualEvidence) {
    rejectionCodes.push("unusable_transcript", "insufficient_visual_context");
  }

  const semanticCompleteness = usableTranscript || usableCaption ? 1 : 0.5;
  const visualCompleteness = usableVisualEvidence ? 1 : 0;
  const qualityScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        preflight.qualityScore * 0.7 + semanticCompleteness * 15 + visualCompleteness * 15,
      ),
    ),
  );

  return InputAssessment.make({
    decision: rejectionCodes.length === 0 ? "qualified" : "rejected",
    qualityScore,
    rejectionCodes: [...new Set(rejectionCodes)],
    warnings: [...new Set(warnings)],
  });
};
