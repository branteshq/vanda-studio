import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import * as FastCheck from "effect/testing/FastCheck";
import {
  contradictBelief,
  decayBelief,
  dropSignal,
  isThemeSaturated,
  meetsEvidenceThreshold,
  recomputeMomentum,
  reinforceBelief,
  statusFor,
} from "./discernment";
import { Belief, defaultPolicy, Policy, type Theme } from "./memory";

const policy = defaultPolicy;
// Raw beliefs (confidence and status independent): the functions must normalize
// status on every path, so the generator deliberately explores inconsistent
// inputs rather than hiding the asymmetry behind a pre-normalized generator.
const beliefArb = Schema.toArbitrary(Belief);
const ts = FastCheck.integer({ min: 0, max: 4_000_000_000_000 });
const elapsed = FastCheck.integer({ min: 0, max: 10 * policy.decayHalfLifeMs });
const id = FastCheck.string();

const beliefBase: Belief = {
  accountId: "acct",
  statement: "customers love the winter combo",
  kind: "audience",
  confidence: 0.9,
  supportingSignalIds: ["s1", "s2", "s3"],
  firstSeenAt: 0,
  confidenceAsOf: 0,
  status: "active",
};

const themeBase: Omit<Theme, "lastPostedAt"> = {
  accountId: "acct",
  name: "Dog content",
  summary: "the resident golden retriever",
  momentum: "steady",
  postCount: 0,
  signalCount: 0,
};

describe("reinforceBelief", () => {
  it.prop("keeps confidence within [0,1]", [beliefArb, id, ts], ([belief, signalId, now]) => {
    const c = reinforceBelief(belief, signalId, now, policy).confidence;
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });

  it.prop("never lowers confidence", [beliefArb, id, ts], ([belief, signalId, now]) => {
    expect(reinforceBelief(belief, signalId, now, policy).confidence).toBeGreaterThanOrEqual(
      belief.confidence,
    );
  });

  it.prop(
    "is idempotent per signal id",
    [beliefArb, id, ts, ts],
    ([belief, signalId, now1, now2]) => {
      const once = reinforceBelief(belief, signalId, now1, policy);
      const twice = reinforceBelief(once, signalId, now2, policy);
      expect(twice.confidence).toBe(once.confidence);
      expect(twice.supportingSignalIds.length).toBe(once.supportingSignalIds.length);
    },
  );

  it.prop("counts a new signal exactly once", [beliefArb, id, ts], ([belief, signalId, now]) => {
    if (belief.supportingSignalIds.includes(signalId)) return; // only new ids are evidence
    const next = reinforceBelief(belief, signalId, now, policy);
    expect(next.supportingSignalIds).toContain(signalId);
    expect(next.supportingSignalIds.length).toBe(belief.supportingSignalIds.length + 1);
    expect(next.confidenceAsOf).toBe(now);
  });

  it.prop(
    "always derives status from confidence",
    [beliefArb, id, ts],
    ([belief, signalId, now]) => {
      const next = reinforceBelief(belief, signalId, now, policy);
      expect(next.status).toBe(statusFor(next.confidence, policy));
    },
  );

  it("moves confidence by learningRate of the remaining gap", () => {
    const next = reinforceBelief(
      { ...beliefBase, confidence: 0.5, supportingSignalIds: [] },
      "x",
      1,
      policy,
    );
    expect(next.confidence).toBeCloseTo(0.5 + (1 - 0.5) * policy.learningRate, 10); // 0.65
  });

  it("normalizes status even on the idempotent no-op path", () => {
    // confidence 0.05 is below retireBelow (0.1) but status is falsely "active".
    const stale: Belief = {
      ...beliefBase,
      confidence: 0.05,
      status: "active",
      supportingSignalIds: ["dup"],
    };
    const next = reinforceBelief(stale, "dup", 999, policy); // duplicate id => no-op path
    expect(next.confidence).toBe(0.05);
    expect(next.status).toBe("retired");
  });
});

describe("decayBelief", () => {
  it.prop("keeps confidence within [0,1]", [beliefArb, elapsed], ([belief, dt]) => {
    const c = decayBelief(belief, belief.confidenceAsOf + dt, policy).confidence;
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });

  it.prop("never raises confidence", [beliefArb, elapsed], ([belief, dt]) => {
    expect(decayBelief(belief, belief.confidenceAsOf + dt, policy).confidence).toBeLessThanOrEqual(
      belief.confidence,
    );
  });

  it.prop(
    "is monotonic non-increasing in elapsed time",
    [beliefArb, elapsed, elapsed],
    ([belief, a, b]) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const cLo = decayBelief(belief, belief.confidenceAsOf + lo, policy).confidence;
      const cHi = decayBelief(belief, belief.confidenceAsOf + hi, policy).confidence;
      expect(cHi).toBeLessThanOrEqual(cLo);
    },
  );

  it.prop(
    "is identity at or before the last reinforcement",
    [beliefArb, elapsed],
    ([belief, back]) => {
      const now = Math.max(0, belief.confidenceAsOf - back);
      expect(decayBelief(belief, now, policy).confidence).toBe(belief.confidence);
    },
  );

  it.prop("always derives status from confidence", [beliefArb, elapsed], ([belief, dt]) => {
    const next = decayBelief(belief, belief.confidenceAsOf + dt, policy);
    expect(next.status).toBe(statusFor(next.confidence, policy));
  });

  it("halves confidence after exactly one half-life", () => {
    const next = decayBelief(
      { ...beliefBase, confidence: 0.8, confidenceAsOf: 0 },
      policy.decayHalfLifeMs,
      policy,
    );
    expect(next.confidence).toBeCloseTo(0.4, 10);
  });

  it("telescopes: re-decaying counts only the new elapsed time, not the whole interval", () => {
    const hl = policy.decayHalfLifeMs;
    const belief = { ...beliefBase, confidence: 0.8, confidenceAsOf: 0 };
    const once = decayBelief(belief, 2 * hl, policy);
    const twice = decayBelief(decayBelief(belief, hl, policy), 2 * hl, policy);
    expect(once.confidence).toBeCloseTo(0.2, 10); // 0.8 * 0.5^2
    expect(twice.confidence).toBeCloseTo(once.confidence, 10); // no compounding
  });
});

describe("contradictBelief", () => {
  it.prop("lowers confidence, stays in [0,1], status consistent", [beliefArb], ([belief]) => {
    const next = contradictBelief(belief, 0, policy);
    expect(next.confidence).toBeGreaterThanOrEqual(0);
    expect(next.confidence).toBeLessThanOrEqual(belief.confidence);
    expect(next.status).toBe(statusFor(next.confidence, policy));
  });

  it("scales confidence by contradictionFactor", () => {
    expect(contradictBelief({ ...beliefBase, confidence: 0.8 }, 0, policy).confidence).toBeCloseTo(
      0.8 * policy.contradictionFactor,
      10,
    ); // 0.4
  });

  it("advances the decay anchor to now", () => {
    expect(
      contradictBelief({ ...beliefBase, confidenceAsOf: 0 }, 5000, policy).confidenceAsOf,
    ).toBe(5000);
  });
});

describe("meetsEvidenceThreshold", () => {
  it.prop("implies each of its conditions", [beliefArb], ([belief]) => {
    if (!meetsEvidenceThreshold(belief, policy)) return;
    expect(belief.status).toBe("active");
    expect(belief.confidence).toBeGreaterThanOrEqual(policy.minConfidence);
    expect(belief.supportingSignalIds.length).toBeGreaterThanOrEqual(policy.minEvidence);
  });

  it("accepts a belief exactly at the confidence and evidence bar", () => {
    expect(
      meetsEvidenceThreshold(
        { ...beliefBase, confidence: policy.minConfidence, supportingSignalIds: ["a", "b", "c"] },
        policy,
      ),
    ).toBe(true);
  });

  it("rejects a hair under the confidence bar", () => {
    expect(
      meetsEvidenceThreshold({ ...beliefBase, confidence: policy.minConfidence - 1e-6 }, policy),
    ).toBe(false);
  });

  it("rejects one signal short of the evidence bar", () => {
    expect(meetsEvidenceThreshold({ ...beliefBase, supportingSignalIds: ["a", "b"] }, policy)).toBe(
      false,
    );
  });

  it("rejects a non-active belief regardless of evidence", () => {
    expect(meetsEvidenceThreshold({ ...beliefBase, status: "decaying" }, policy)).toBe(false);
  });
});

describe("isThemeSaturated", () => {
  it("is not saturated when never posted", () => {
    expect(isThemeSaturated({ ...themeBase }, 1_000_000, policy)).toBe(false);
  });

  it.prop(
    "is saturated within the cadence window and free after it",
    [ts, elapsed],
    ([postedAt, gap]) => {
      const theme: Theme = { ...themeBase, lastPostedAt: postedAt };
      expect(isThemeSaturated(theme, postedAt + gap, policy)).toBe(gap < policy.cadenceWindowMs);
    },
  );
});

describe("recomputeMomentum", () => {
  it("is steady exactly at the rising ratio (strict comparison)", () => {
    expect(recomputeMomentum(120, 100, policy)).toBe("steady"); // 120 > 100*1.2 is false
  });

  it("is rising just above the rising ratio", () => {
    expect(recomputeMomentum(121, 100, policy)).toBe("rising");
  });

  it("is steady exactly at the falling ratio (strict comparison)", () => {
    expect(recomputeMomentum(80, 100, policy)).toBe("steady"); // 80 < 100*0.8 is false
  });

  it("is falling just below the falling ratio", () => {
    expect(recomputeMomentum(79, 100, policy)).toBe("falling");
  });

  it("is rising from a zero baseline with any activity", () => {
    expect(recomputeMomentum(1, 0, policy)).toBe("rising");
  });

  it("is steady from a zero baseline with no activity", () => {
    expect(recomputeMomentum(0, 0, policy)).toBe("steady");
  });
});

describe("dropSignal", () => {
  it.prop(
    "dropping an unheld signal leaves confidence and support unchanged",
    [beliefArb, id, ts],
    ([belief, signalId, now]) => {
      if (belief.supportingSignalIds.includes(signalId)) return;
      const out = dropSignal(belief, signalId, now, policy);
      expect(out.confidence).toBeCloseTo(belief.confidence, 10);
      expect(out.supportingSignalIds).toEqual(belief.supportingSignalIds);
    },
  );

  it.prop(
    "reinforce then drop restores confidence and support",
    [beliefArb, ts],
    ([belief, now]) => {
      const signalId = "drop-roundtrip";
      if (belief.supportingSignalIds.includes(signalId)) return;
      const reinforced = reinforceBelief(belief, signalId, now, policy);
      const dropped = dropSignal(reinforced, signalId, now, policy);
      expect(dropped.confidence).toBeCloseTo(belief.confidence, 6);
      expect(dropped.supportingSignalIds).toEqual(belief.supportingSignalIds);
    },
  );

  it.prop(
    "dropping a held signal removes it and never raises confidence",
    [beliefArb, ts],
    ([belief, now]) => {
      if (belief.supportingSignalIds.length === 0) return;
      const signalId = belief.supportingSignalIds[0]!;
      const out = dropSignal(belief, signalId, now, policy);
      expect(out.supportingSignalIds).not.toContain(signalId);
      expect(out.confidence).toBeLessThanOrEqual(belief.confidence + 1e-9);
      expect(out.confidence).toBeGreaterThanOrEqual(0);
      expect(out.confidence).toBeLessThanOrEqual(1);
    },
  );

  it.prop(
    "always derives status from confidence",
    [beliefArb, id, ts],
    ([belief, signalId, now]) => {
      const out = dropSignal(belief, signalId, now, policy);
      expect(out.status).toBe(statusFor(out.confidence, policy));
    },
  );

  it("inverts a single reinforcement exactly", () => {
    const base: Belief = { ...beliefBase, confidence: 0.5, supportingSignalIds: [] };
    const reinforced = reinforceBelief(base, "x", 1, policy); // 0.5 + 0.5*0.3 = 0.65
    const dropped = dropSignal(reinforced, "x", 2, policy);
    expect(dropped.confidence).toBeCloseTo(0.5, 10);
    expect(dropped.supportingSignalIds).toEqual([]);
  });
});

describe("Policy", () => {
  it("accepts the default policy", () => {
    expect(() => Schema.decodeUnknownSync(Policy)(defaultPolicy)).not.toThrow();
  });

  it("rejects a saturated learning rate (>= 1) — reinforcement must stay invertible", () => {
    expect(() => Schema.decodeUnknownSync(Policy)({ ...defaultPolicy, learningRate: 1 })).toThrow();
  });
});
