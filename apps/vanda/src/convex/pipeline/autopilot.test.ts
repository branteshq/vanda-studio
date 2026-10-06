import { describe, expect, it } from "vitest";
import type { InstagramPost } from "../instagram/types";
import {
  DEFAULT_CADENCE,
  cadenceSummary,
  computeAccountMetrics,
  confidenceFor,
  formatScheduleText,
  localSlot,
  normalizeCadence,
  parseCadenceText,
  slotTimestamp,
  weekStartOf,
} from "./autopilot";

// Wednesday 2026-10-07 15:00 São Paulo = 18:00 UTC.
const WEDNESDAY = Date.UTC(2026, 9, 7, 18, 0);
// Monday 2026-10-05 00:00 São Paulo = 03:00 UTC.

const MONDAY = Date.UTC(2026, 9, 5, 3, 0);

describe("week math", () => {
  it("anchors the week at Monday 00:00 in São Paulo", () => {
    expect(weekStartOf(WEDNESDAY)).toBe(MONDAY);
    expect(weekStartOf(MONDAY)).toBe(MONDAY);
    // Sunday 23:30 local still belongs to the previous week.
    expect(weekStartOf(MONDAY - 30 * 60 * 1000)).toBe(MONDAY - 7 * 86_400_000);
  });

  it("places Tuesday 18h São Paulo at 21:00 UTC", () => {
    expect(slotTimestamp(MONDAY, 2, "18:00")).toBe(Date.UTC(2026, 9, 6, 21, 0));
    expect(slotTimestamp(MONDAY, 0, "12:00")).toBe(Date.UTC(2026, 9, 11, 15, 0));
    expect(localSlot(Date.UTC(2026, 9, 6, 21, 0))).toEqual({ weekday: 2, time: "18:00" });
  });
});

describe("normalizeCadence", () => {
  it("forces one slide for images, clamps carousels and drops invalid or duplicate slots", () => {
    expect(
      normalizeCadence([
        { weekday: 6, time: "12:00", type: "carousel", slideCount: 40 },
        { weekday: 2, time: "18:00", type: "image", slideCount: 3 },
        { weekday: 2, time: "18:00", type: "carousel", slideCount: 2 },
        { weekday: 9, time: "18:00", type: "image", slideCount: 1 },
        { weekday: 4, time: "25:00", type: "image", slideCount: 1 },
        { weekday: 4, time: "18:00", type: "carousel", slideCount: 1 },
      ]),
    ).toEqual([
      { weekday: 2, time: "18:00", type: "image", slideCount: 1 },
      { weekday: 4, time: "18:00", type: "carousel", slideCount: 2 },
      { weekday: 6, time: "12:00", type: "carousel", slideCount: 10 },
    ]);
  });

  it("orders Sunday last", () => {
    const sorted = normalizeCadence([
      { weekday: 0, time: "10:00", type: "image", slideCount: 1 },
      { weekday: 1, time: "10:00", type: "image", slideCount: 1 },
    ]);

    expect(sorted.map((entry) => entry.weekday)).toEqual([1, 0]);
  });
});

describe("parseCadenceText", () => {
  it("reads the agency's own way of writing a cadence", () => {
    expect(
      normalizeCadence(
        parseCadenceText("Terça 18h carrossel 2; quinta 18h imagem\nsábado 12h carrossel 3 slides"),
      ),
    ).toEqual(DEFAULT_CADENCE);
    expect(parseCadenceText("seg 9h30 imagem")).toEqual([
      { weekday: 1, time: "09:30", type: "image", slideCount: 1 },
    ]);
  });

  it("accepts the JSON the Posts automáticos view sends and rejects what it can't read", () => {
    expect(parseCadenceText(JSON.stringify(DEFAULT_CADENCE))).toEqual(DEFAULT_CADENCE);
    expect(() => parseCadenceText("toda hora")).toThrow(/não entendi/);
  });
});

describe("PT-BR schedule text", () => {
  it("summarizes the agency default", () => {
    expect(cadenceSummary(DEFAULT_CADENCE)).toBe("3 por semana · Ter e Qui 18h · Sáb 12h");
  });

  it("formats the WhatsApp schedule", () => {
    const text = formatScheduleText([
      {
        scheduledFor: slotTimestamp(MONDAY, 4, "18:00"),
        slideCount: 1,
        purpose: "prova_social",
        hook: "120 entregas em agosto",
        status: "scheduled",
      },
      {
        scheduledFor: slotTimestamp(MONDAY, 2, "18:00"),
        slideCount: 2,
        purpose: "educacional",
        hook: "3 erros no orçamento",
        status: "planned",
      },
    ]);

    expect(text).toBe(
      [
        "📅 Programação da semana — 2 posts",
        'Terça 18h · 2 slides · Educacional — "3 erros no orçamento"',
        'Quinta 18h · 1 slide · Prova social — "120 entregas em agosto" (agendado)',
      ].join("\n"),
    );
  });
});

const post = (
  id: string,
  reach: number | undefined,
  extra: Partial<InstagramPost> = {},
): InstagramPost => ({
  id,
  url: `https://instagram.com/p/${id}`,
  mediaType: "carousel",
  publicEngagement: { likes: 10, comments: 2, shares: 4 },
  privateInsights: reach === undefined ? undefined : { reach, saves: 8 },
  publishedAt: WEDNESDAY - Number(id) * 86_400_000,
  ...extra,
});

describe("computeAccountMetrics", () => {
  it("ranks by outlier multiple against the account median", () => {
    const { basis, ranked, metrics } = computeAccountMetrics(
      [post("1", 1000), post("2", 4000, { mediaType: "image" }), post("3", 1000), post("4", 500)],
      { followers: 2000, now: WEDNESDAY },
    );

    expect(basis).toBe("reach");
    expect(metrics.medianReach).toBe(1000);
    expect(ranked[0]?.post.id).toBe("2");
    expect(ranked[0]?.outlier).toBe(4);
    expect(metrics.sharesPerReach).toBe(Math.round((16 / 6500) * 10000) / 10000);
    expect(metrics.byFormat[0]).toEqual({ key: "imagem", n: 1, meanOutlier: 4 });
    expect(metrics.daysSinceLastPost).toBe(1);
  });

  it("falls back to public interactions when reach is mostly missing", () => {
    const { basis, metrics } = computeAccountMetrics([post("1", undefined), post("2", undefined)], {
      now: WEDNESDAY,
    });

    expect(basis).toBe("interactions");
    expect(metrics.medianReach).toBeUndefined();
    expect(metrics.savesPerReach).toBeUndefined();
  });

  it("grades confidence by sample size", () => {
    expect(confidenceFor(6)).toBe("baixa");
    expect(confidenceFor(12)).toBe("media");
    expect(confidenceFor(30)).toBe("alta");
  });
});
