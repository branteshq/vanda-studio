import type { Belief, BeliefStatus, Momentum, Policy, Theme } from "./memory";

/** A belief's lifecycle status follows from its confidence and the policy thresholds. */
export const statusFor = (confidence: number, policy: Policy): BeliefStatus =>
  confidence < policy.retireBelow
    ? "retired"
    : confidence < policy.decayingBelow
      ? "decaying"
      : "active";

/**
 * Set a belief's confidence (clamped to a finite 0..1) and re-derive its status.
 * Every confidence change — including the reinforce no-op — routes through here,
 * so the "status follows confidence" invariant cannot be forgotten and a stray
 * NaN collapses to a retired 0 rather than leaking through.
 */
const withConfidence = (belief: Belief, raw: number, policy: Policy): Belief => {
  const confidence = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  return { ...belief, confidence, status: statusFor(confidence, policy) };
};

/**
 * Fold one piece of evidence into a belief. Idempotent per signal id, so the
 * same signal (or a user's repeated comment, keyed by id) never inflates
 * confidence twice. Confidence approaches 1 asymptotically, so it stays in 0..1.
 */
export const reinforceBelief = (
  belief: Belief,
  signalId: string,
  now: number,
  policy: Policy,
): Belief => {
  if (belief.supportingSignalIds.includes(signalId)) {
    return withConfidence(belief, belief.confidence, policy);
  }
  return {
    ...withConfidence(
      belief,
      belief.confidence + (1 - belief.confidence) * policy.learningRate,
      policy,
    ),
    supportingSignalIds: [...belief.supportingSignalIds, signalId],
    confidenceAsOf: now,
  };
};

/**
 * Remove one signal's evidence from a belief: peel exactly one reinforcement off
 * the CURRENT confidence — the algebraic inverse of reinforceBelief's
 * `c → c + (1−c)·r`, i.e. `c → (c − r)/(1 − r)` — and drop it from the support
 * set. Reinforcement is order-independent, so this recovers "as if this signal
 * never supported it" without an event log, while any decay/contradiction already
 * baked into the current value is preserved. Confidence only decreases and stays
 * in 0..1. A no-op (just re-normalizes status) when the signal isn't held.
 */
export const dropSignal = (
  belief: Belief,
  signalId: string,
  now: number,
  policy: Policy,
): Belief => {
  if (!belief.supportingSignalIds.includes(signalId)) {
    return withConfidence(belief, belief.confidence, policy);
  }
  // Policy guarantees learningRate < 1, so (1 − r) > 0; withConfidence still
  // clamps any non-finite result defensively.
  const r = policy.learningRate;
  const raw = (belief.confidence - r) / (1 - r);
  return {
    ...withConfidence(belief, raw, policy),
    supportingSignalIds: belief.supportingSignalIds.filter((id) => id !== signalId),
    confidenceAsOf: now,
  };
};

/**
 * Apply time decay since the belief's confidence was last set. Confidence halves
 * every `decayHalfLifeMs`, so it is non-increasing in elapsed time and never
 * leaves 0..1. The decay anchor (`confidenceAsOf`) advances to `now`, so the
 * decayed value telescopes: re-decaying it later only counts the new elapsed
 * time rather than re-applying the whole interval (which would compound when the
 * decayed value is persisted and decayed again next pass).
 */
export const decayBelief = (belief: Belief, now: number, policy: Policy): Belief => {
  const elapsed = Math.max(0, now - belief.confidenceAsOf);
  return {
    ...withConfidence(
      belief,
      belief.confidence * Math.pow(0.5, elapsed / policy.decayHalfLifeMs),
      policy,
    ),
    confidenceAsOf: Math.max(belief.confidenceAsOf, now),
  };
};

/** Lower a belief's confidence in response to contradicting evidence, as of `now`. */
export const contradictBelief = (belief: Belief, now: number, policy: Policy): Belief => ({
  ...withConfidence(belief, belief.confidence * policy.contradictionFactor, policy),
  confidenceAsOf: now,
});

/** Whether a belief is strong and well-evidenced enough to drive a suggestion. */
export const meetsEvidenceThreshold = (belief: Belief, policy: Policy): boolean =>
  belief.status === "active" &&
  belief.confidence >= policy.minConfidence &&
  belief.supportingSignalIds.length >= policy.minEvidence;

/** Whether a theme was posted too recently to post about again. */
export const isThemeSaturated = (theme: Theme, now: number, policy: Policy): boolean =>
  theme.lastPostedAt !== undefined && now - theme.lastPostedAt < policy.cadenceWindowMs;

/**
 * Classify a theme's trajectory from windowed signal counts. The caller supplies
 * `recent` vs `prior` counts over equal-length windows; `Theme.signalCount` is
 * cumulative and is not one of these (the windows come from signal queries in a
 * later phase).
 */
export const recomputeMomentum = (recent: number, prior: number, policy: Policy): Momentum =>
  recent > prior * policy.momentumRisingRatio
    ? "rising"
    : recent < prior * policy.momentumFallingRatio
      ? "falling"
      : "steady";
