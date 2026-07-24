import { describe, expect, it } from "vitest";
import { DAY_MS, assessFinalInput, type FinalInput } from "./inputQuality";

const now = 20 * DAY_MS;
const healthy: FinalInput = {
  now,
  publishedAt: now - DAY_MS,
  followers: 700,
  views: 3_500,
  creatorRelevanceScore: 0.9,
  brandReady: true,
  caption: "Veja como planejar um atendimento seguro e explicar cada etapa para seus pacientes.",
  transcript: "Hoje eu vou mostrar os cuidados essenciais antes de iniciar este procedimento.",
  hasDurableVideo: true,
  hasDurableThumbnail: true,
  frameCount: 1,
};

const fixtures: ReadonlyArray<{
  readonly name: string;
  readonly input: FinalInput;
  readonly expected: "qualified" | "rejected";
  readonly code?: string | undefined;
}> = [
  { name: "complete spoken reel", input: healthy, expected: "qualified" },
  {
    name: "visual demonstration",
    input: { ...healthy, transcript: undefined, caption: undefined, hasDurableVideo: true },
    expected: "qualified",
  },
  {
    name: "caption-led reel",
    input: { ...healthy, transcript: undefined, hasDurableVideo: false },
    expected: "qualified",
  },
  {
    name: "stale lifetime winner",
    input: { ...healthy, publishedAt: now - 8 * DAY_MS },
    expected: "rejected",
    code: "source_too_old",
  },
  {
    name: "future timestamp",
    input: { ...healthy, publishedAt: now + 2 * 3_600_000 },
    expected: "rejected",
    code: "invalid_published_at",
  },
  {
    name: "missing views",
    input: { ...healthy, views: undefined },
    expected: "rejected",
    code: "missing_views",
  },
  {
    name: "missing followers",
    input: { ...healthy, followers: undefined },
    expected: "rejected",
    code: "missing_followers",
  },
  {
    name: "irrelevant creator",
    input: { ...healthy, creatorRelevanceScore: 0.4 },
    expected: "rejected",
    code: "creator_irrelevant",
  },
  {
    name: "blocked creator",
    input: { ...healthy, creatorBlocked: true },
    expected: "rejected",
    code: "creator_blocked",
  },
  {
    name: "incomplete brand",
    input: { ...healthy, brandReady: false },
    expected: "rejected",
    code: "brand_incomplete",
  },
  {
    name: "expired provider URLs",
    input: {
      ...healthy,
      hasDurableVideo: false,
      hasDurableThumbnail: false,
      frameCount: 0,
    },
    expected: "rejected",
    code: "missing_media",
  },
  {
    name: "noise without visual evidence",
    input: {
      ...healthy,
      caption: undefined,
      transcript: "woo oh oh",
      hasDurableVideo: false,
      hasDurableThumbnail: false,
      frameCount: 0,
    },
    expected: "rejected",
    code: "unusable_transcript",
  },
];

describe("input qualification golden fixtures", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const result = assessFinalInput(fixture.input);
      expect(result.decision).toBe(fixture.expected);
      if (fixture.code) expect(result.rejectionCodes).toContain(fixture.code);
    });
  }

  it("never accepts a stale fixture", () => {
    for (let daysOld = 8; daysOld <= 90; daysOld += 1) {
      expect(assessFinalInput({ ...healthy, publishedAt: now - daysOld * DAY_MS }).decision).toBe(
        "rejected",
      );
    }
  });

  it("never accepts a metric-incomplete fixture", () => {
    for (const patch of [
      { views: undefined },
      { followers: undefined },
      { views: Number.NaN },
      { followers: 0 },
    ]) {
      expect(assessFinalInput({ ...healthy, ...patch }).decision).toBe("rejected");
    }
  });
});
