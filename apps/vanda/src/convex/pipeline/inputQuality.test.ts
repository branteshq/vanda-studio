import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  assessBrandReadiness,
  assessFinalInput,
  assessPreflightInput,
  brandSnapshotHash,
  isUsableSemanticText,
} from "./inputQuality";

const now = 10 * DAY_MS;
const base = {
  now,
  publishedAt: now - DAY_MS,
  followers: 600,
  views: 2_400,
  creatorRelevanceScore: 0.9,
  brandReady: true,
} as const;

describe("input quality", () => {
  it("rejects stale posts before source hydration", () => {
    expect(assessPreflightInput({ ...base, publishedAt: now - 8 * DAY_MS })).toMatchObject({
      decision: "rejected",
      rejectionCodes: ["source_too_old"],
    });
  });

  it("rejects missing metrics and incomplete brands", () => {
    const assessment = assessPreflightInput({
      ...base,
      brandReady: false,
      followers: undefined,
      views: undefined,
    });
    expect(assessment.decision).toBe("rejected");
    expect(assessment.rejectionCodes).toEqual(
      expect.arrayContaining(["brand_incomplete", "missing_views", "missing_followers"]),
    );
  });

  it("does not treat noise as a usable transcript", () => {
    expect(isUsableSemanticText("Woo oh oh oh")).toBe(false);
    expect(
      isUsableSemanticText("Veja três cuidados importantes antes de marcar sua cirurgia."),
    ).toBe(true);
  });

  it("accepts a visual source without speech when durable video is available", () => {
    expect(
      assessFinalInput({
        ...base,
        transcript: ".",
        hasDurableVideo: true,
        hasDurableThumbnail: true,
        frameCount: 0,
        visualDescription:
          "O vídeo demonstra visualmente cada etapa do procedimento com texto explicativo.",
      }),
    ).toMatchObject({ decision: "qualified" });
  });

  it("rejects a source with no usable semantic or visual route", () => {
    const assessment = assessFinalInput({
      ...base,
      transcript: ".",
      hasDurableVideo: false,
      hasDurableThumbnail: false,
      frameCount: 0,
    });
    expect(assessment.decision).toBe("rejected");
    expect(assessment.rejectionCodes).toEqual(
      expect.arrayContaining([
        "missing_media",
        "unusable_transcript",
        "insufficient_visual_context",
      ]),
    );
  });

  it("requires the minimum confirmed brand contract", () => {
    expect(assessBrandReadiness({ confirmedKinds: ["identity", "summary"] }).ready).toBe(false);
    expect(
      assessBrandReadiness({ confirmedKinds: ["identity", "summary", "voice"] }),
    ).toMatchObject({ ready: true });
  });

  it("creates a stable brand snapshot key independent of row order", () => {
    expect(brandSnapshotHash(["voice: direta", "identity: Vanda"])).toBe(
      brandSnapshotHash(["identity: Vanda", "voice: direta"]),
    );
  });
});
