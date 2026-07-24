import { describe, expect, it } from "vitest";
import { candidatePassesRelevanceGate, detectBreakout, scoreCandidateRelevance } from "./market";

describe("candidate relevance", () => {
  const strong = {
    topicalOverlap: 0.95,
    audienceOverlap: 0.9,
    offerOverlap: 0.8,
    geographicOverlap: 1,
    languageMatch: 1,
    contentActivity: 0.8,
    confidence: 0.9,
    vetoes: [],
  } as const;

  it("keeps a strongly aligned candidate", () => {
    expect(scoreCandidateRelevance(strong)).toBeGreaterThan(0.8);
    expect(candidatePassesRelevanceGate(strong)).toBe(true);
  });

  it("honors hard vetoes even for a high semantic score", () => {
    expect(candidatePassesRelevanceGate({ ...strong, vetoes: ["agregador de reposts"] })).toBe(
      false,
    );
  });
});

describe("detectBreakout", () => {
  it("flags audience-normalized traction", () => {
    expect(detectBreakout({ followers: 600, views: 2_400, observedAt: 1_000 })).toMatchObject({
      triggerType: "audience_ratio",
    });
  });

  it("flags view velocity from two snapshots", () => {
    expect(
      detectBreakout(
        { followers: 800, views: 1_800, observedAt: 3_600_000 },
        { followers: 800, views: 800, observedAt: 0 },
      ),
    ).toMatchObject({ triggerType: "velocity" });
  });

  it("does not flag ordinary performance", () => {
    expect(detectBreakout({ followers: 800, views: 900, observedAt: 1_000 })).toBeUndefined();
  });
});
