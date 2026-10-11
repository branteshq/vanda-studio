import * as Schema from "effect/Schema";
import { brandKinds } from "./constants";

/** A number in [0, 1] — detection confidence. */
export const UnitInterval = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

/**
 * The brand-profile stage models onboarding's "Vanda reads your account and
 * proposes what she understood": `proposeBrandProfile` (pipeline/brandProfile.ts)
 * turns a corpus into a `BrandAnalysis` in one structured LLM pass, which
 * `completeOnboarding` writes into /brand/marca.md. Nothing here is persisted as a draft.
 */

/** One single-valued analysis card (identity, summary) with its evidence and confidence. */
export const BrandText = Schema.Struct({
  text: Schema.String,
  evidence: Schema.String,
  confidence: UnitInterval,
});

export type BrandText = typeof BrandText.Type;

/**
 * One multi-valued analysis card (voice, themes, characters, restrictions,
 * opportunities): atomic items plus a single shared evidence and confidence.
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
export const BrandKindCard = Schema.Struct({
  value: Schema.Literals(brandKinds),
  evidence: Schema.String,
  confidence: UnitInterval,
});

/**
 * Vanda's structured read of a brand from the profile, captions and comments.
 * Onboarding writes the confident cards into the brand file as observed items;
 * `opener` is Caetano's first message of the brand guide, written from the posts;
 * `kind` sets the account's brand type; `themes`/`opportunities` are previews, not memory.
 */
export const BrandAnalysis = Schema.Struct({
  identity: BrandText,
  summary: BrandText,
  kind: BrandKindCard,
  location: BrandText,
  positioning: BrandText,
  offers: BrandGroup,
  audience: BrandGroup,
  voice: BrandGroup,
  themes: BrandGroup,
  characters: BrandGroup,
  proof: BrandGroup,
  restrictions: BrandGroup,
  opportunities: BrandGroup,
  opener: Schema.String,
});

export type BrandAnalysis = typeof BrandAnalysis.Type;

/** The Instagram profile facts that anchor the analysis (all best-effort). */
export interface BrandProfileInfo {
  readonly name?: string | undefined;
  readonly username?: string | undefined;
  readonly biography?: string | undefined;
  readonly accountType?: string | undefined;
  readonly mediaCount?: number | undefined;
  readonly followers?: number | undefined;
  readonly reach?: number | undefined;
  readonly views?: number | undefined;
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

/** Presentation counts for the onboarding corpus trust line. */
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
