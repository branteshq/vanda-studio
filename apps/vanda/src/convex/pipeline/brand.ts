import * as Schema from "effect/Schema";
import { brandCanonKinds, brandKinds } from "./constants";

/** A number in [0, 1] — detection confidence. */
export const UnitInterval = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

/**
 * The brand-profile stage models onboarding's "Vanda reads your account and
 * proposes what she understood." `proposeBrandProfile` (pipeline/brandProfile.ts)
 * turns a corpus (profile + captions + comments) into a `BrandAnalysis` via one
 * structured LLM pass; the owner edits it on the Confirmar screen and approves it
 * into `brandCanon`. Nothing here is persisted as a draft — the analysis flows
 * action -> client -> `approveBrandProfile`.
 */

/** The owner-confirmed canon kinds (single source: constants). */
export const BrandCanonKind = Schema.Literals(brandCanonKinds);
export type BrandCanonKind = typeof BrandCanonKind.Type;

/**
 * One single-valued analysis card (identity, summary) with the model's evidence
 * line and detection confidence — the provenance the Confirmar screen surfaces so
 * the owner knows what to scrutinize before confirming.
 */
export const BrandText = Schema.Struct({
  text: Schema.String,
  evidence: Schema.String,
  confidence: UnitInterval,
});
export type BrandText = typeof BrandText.Type;

/**
 * One multi-valued analysis card (voice, themes, characters, restrictions,
 * opportunities): atomic chips plus a single shared evidence/confidence, matching
 * the Confirmar card layout (one confidence dot per card, chips inside).
 */
export const BrandGroup = Schema.Struct({
  items: Schema.Array(Schema.String),
  evidence: Schema.String,
  confidence: UnitInterval,
});
export type BrandGroup = typeof BrandGroup.Type;

/**
 * The brand TYPE Vanda proposes — a place/product ("negocio") or a person who is
 * the brand ("pessoal", e.g. the owner appears in the posts). The owner confirms
 * or flips it; it sets `accounts.kind` and shapes how create generates.
 */
export const BrandKind = Schema.Literals(brandKinds);
export type BrandKind = typeof BrandKind.Type;

export const BrandKindCard = Schema.Struct({
  value: BrandKind,
  evidence: Schema.String,
  confidence: UnitInterval,
});
export type BrandKindCard = typeof BrandKindCard.Type;

/**
 * Vanda's structured read of a brand — the `generateObject` schema and the shape
 * the owner approves. `identity`/`voice`/`character`/`restriction`/`summary` persist
 * as `brandCanon`; `kind` sets the account's brand type; `themes` seed the `themes`
 * table; `opportunities` are previews the planner later earns, so neither is canon.
 */
export const BrandAnalysis = Schema.Struct({
  identity: BrandText,
  summary: BrandText,
  kind: BrandKindCard,
  voice: BrandGroup,
  themes: BrandGroup,
  characters: BrandGroup,
  restrictions: BrandGroup,
  opportunities: BrandGroup,
});
export type BrandAnalysis = typeof BrandAnalysis.Type;

/** The Instagram profile facts that anchor the analysis (all best-effort). */
export interface BrandProfileInfo {
  readonly name?: string | undefined;
  readonly username?: string | undefined;
  readonly biography?: string | undefined;
  readonly accountType?: string | undefined;
  readonly mediaCount?: number | undefined;
}

/**
 * The raw material the analysis reasons over: the profile plus the text of recent
 * posts and the comments under them. Assembled by `fetchBrandCorpus`
 * (pipeline/liveBrand.ts); consumed by `proposeBrandProfile`.
 */
export interface BrandCorpus {
  readonly profile: BrandProfileInfo;
  readonly captions: ReadonlyArray<string>;
  readonly comments: ReadonlyArray<string>;
}

/** Presentation counts for the "LI N POSTS · N COMENTÁRIOS · N MENÇÕES" trust line. */
export interface CorpusStats {
  readonly posts: number;
  readonly comments: number;
  readonly mentions: number;
}

/** What `fetchBrandCorpus` returns: the LLM corpus plus the counts the UI displays. */
export interface BrandCorpusResult {
  readonly corpus: BrandCorpus;
  readonly stats: CorpusStats;
}
