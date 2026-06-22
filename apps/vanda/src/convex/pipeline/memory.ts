import * as Schema from "effect/Schema";
import {
  accountModes,
  beliefKinds,
  beliefStatuses,
  momenta,
  postTypes,
  suggestionStatuses,
} from "./constants";

// ---------------------------------------------------------------------------
// Value types — shared, checked primitives. The checks make schema-derived
// arbitraries (used by the property tests) generate only well-formed values.
// ---------------------------------------------------------------------------

/** A probability/score in the inclusive range 0..1. */
export const UnitInterval = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

/** A non-negative integer count. */
export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** A non-negative epoch-millis timestamp. */
export const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** A strictly positive integer (e.g. a half-life, which divides). */
export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const BeliefKind = Schema.Literals(beliefKinds);
export type BeliefKind = typeof BeliefKind.Type;

/** Lifecycle of a belief, derived from its confidence (see `statusFor`). */
export const BeliefStatus = Schema.Literals(beliefStatuses);
export type BeliefStatus = typeof BeliefStatus.Type;

export const Momentum = Schema.Literals(momenta);
export type Momentum = typeof Momentum.Type;

/** Per-account autonomy setting; drives a suggestion's initial control status. */
export const AccountMode = Schema.Literals(accountModes);
export type AccountMode = typeof AccountMode.Type;

/** The semantically-distinct media kinds (a feed post, reel, story, tweet, image). */
export const PostType = Schema.Literals(postTypes);
export type PostType = typeof PostType.Type;

/** A suggestion's control status (the per-item states from the canonical control model). */
export const SuggestionStatus = Schema.Literals(suggestionStatuses);
export type SuggestionStatus = typeof SuggestionStatus.Type;

// ---------------------------------------------------------------------------
// Memory entities
// ---------------------------------------------------------------------------

/**
 * A probabilistic claim Vanda holds about the world around a brand. Confidence
 * rises with independent evidence and decays without it. `supportingSignalIds`
 * is the deduplicated evidence set, so the evidence count is its length — there
 * is no separate counter to drift out of sync.
 */
export const Belief = Schema.Struct({
  accountId: Schema.String,
  statement: Schema.String,
  kind: BeliefKind,
  confidence: UnitInterval,
  supportingSignalIds: Schema.Array(Schema.String),
  firstSeenAt: Timestamp,
  /** Decay anchor: the time the stored `confidence` is valid as-of (advances on every confidence change). */
  confidenceAsOf: Timestamp,
  status: BeliefStatus,
});
export type Belief = typeof Belief.Type;

/**
 * A recurring topic Vanda tracks over time. `lastPostedAt` powers the
 * saturation guard; `momentum` summarizes whether the topic is heating up.
 * `signalCount` is cumulative — momentum windows are computed elsewhere.
 */
export const Theme = Schema.Struct({
  accountId: Schema.String,
  name: Schema.String,
  summary: Schema.String,
  momentum: Momentum,
  lastPostedAt: Schema.optionalKey(Timestamp),
  postCount: Count,
  signalCount: Count,
});
export type Theme = typeof Theme.Type;

/**
 * The discernment rules as data: the numeric thresholds the pure functions
 * apply. Stored per account (the "playbook"), owner-tunable and learnable. The
 * struct-level check enforces the band ordering `statusFor`/`meetsEvidenceThreshold`
 * rely on, so a retuned policy can't silently collapse the belief lifecycle.
 */
export const Policy = Schema.Struct({
  /** Minimum confidence for a belief to be actionable. */
  minConfidence: UnitInterval,
  /** Minimum independent evidence for a belief to be actionable. */
  minEvidence: Count,
  /** Time for an un-reinforced belief's confidence to halve. */
  decayHalfLifeMs: PositiveInt,
  /** A theme posted within this trailing window is considered saturated. */
  cadenceWindowMs: Count,
  /** Fraction of the gap to 1 that one new piece of evidence closes. */
  learningRate: UnitInterval,
  /** Confidence multiplier applied when a belief is contradicted. */
  contradictionFactor: UnitInterval,
  /** Below this confidence a belief is retired. */
  retireBelow: UnitInterval,
  /** Below this confidence a belief is decaying (but not yet retired). */
  decayingBelow: UnitInterval,
  /** Recent signal rate must exceed prior by this ratio to count as rising. */
  momentumRisingRatio: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)),
  /** Recent signal rate below prior by this ratio counts as falling. */
  momentumFallingRatio: UnitInterval,
}).check(
  Schema.makeFilter((p) =>
    p.retireBelow <= p.decayingBelow && p.decayingBelow <= p.minConfidence
      ? undefined
      : "policy thresholds must be ordered: retireBelow <= decayingBelow <= minConfidence",
  ),
);
export type Policy = typeof Policy.Type;

/** A sensible starting policy; accounts may override individual fields. */
export const defaultPolicy: Policy = {
  minConfidence: 0.6,
  minEvidence: 3,
  decayHalfLifeMs: 1000 * 60 * 60 * 24 * 14, // 14 days
  cadenceWindowMs: 1000 * 60 * 60 * 24 * 7, // 7 days
  learningRate: 0.3,
  contradictionFactor: 0.5,
  retireBelow: 0.1,
  decayingBelow: 0.4,
  momentumRisingRatio: 1.2,
  momentumFallingRatio: 0.8,
};

/**
 * A short reflection appended after a consolidation pass — the human-readable
 * "what Vanda is thinking" journal that gives continuity between cycles. It
 * records perception (what changed in memory), never a post idea.
 */
export const MemoryNote = Schema.Struct({
  accountId: Schema.String,
  note: Schema.String,
  signalCount: Count,
  createdAt: Timestamp,
});
export type MemoryNote = typeof MemoryNote.Type;

/**
 * The output of plan: a composed post idea grounded in specific beliefs (and the
 * signals behind them), with a reasoning trace and a control status. Rejected
 * candidates are persisted too (status "rejected" + reason) so the owner can see
 * what Vanda considered and skipped — inspectable autonomy.
 */
export const Suggestion = Schema.Struct({
  accountId: Schema.String,
  title: Schema.String,
  rationale: Schema.String,
  /** A format hint when the model proposed one; plan is otherwise format-agnostic (create decides). */
  format: Schema.optionalKey(PostType),
  themeName: Schema.String,
  beliefStatements: Schema.Array(Schema.String),
  signalIds: Schema.Array(Schema.String),
  status: SuggestionStatus,
  requiresApproval: Schema.Boolean,
  rejectionReason: Schema.optionalKey(Schema.String),
  createdAt: Timestamp,
});
export type Suggestion = typeof Suggestion.Type;
