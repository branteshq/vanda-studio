import { describe, expect, it } from "vitest";
import { nextPublishSlot, publishRestrictionUntil } from "./publishPacing";

const HOUR = 3_600_000;

/** 2026-10-16 09:00 in São Paulo (12:00 UTC). */
const morning = Date.parse("2026-10-16T12:00:00Z");

describe("nextPublishSlot", () => {
  it("keeps a free time and moves a crowded one past every neighbour", () => {
    expect(nextPublishSlot(morning, [morning - 3 * HOUR, morning + 3 * HOUR])).toBe(morning);
    // 30 min after one post and 1h before another: the gap must hold on both sides.
    expect(nextPublishSlot(morning, [morning - HOUR / 2, morning + HOUR])).toBe(morning + 3 * HOUR);
  });

  it("spreads a burst and rolls past a full day to the next local midnight", () => {
    const taken: number[] = [];

    for (let index = 0; index < 6; index++) taken.push(nextPublishSlot(morning, taken));

    expect(taken.slice(0, 4)).toEqual([0, 2, 4, 6].map((hours) => morning + hours * HOUR));
    // The 17th starts at 00:00 in São Paulo, 03:00 UTC.
    expect(taken.slice(4)).toEqual([
      Date.parse("2026-10-17T03:00:00Z"),
      Date.parse("2026-10-17T05:00:00Z"),
    ]);
  });
});

describe("publishRestrictionUntil", () => {
  const now = Date.parse("2026-10-16T18:20:00Z");

  it("reads the end of Upload-Post's pause from its message", () => {
    const precheck =
      'PublisherRequestFailed: Instagram has temporarily restricted @klommerce from publishing ("Action suspected as spam. Activity is restricted"). Your account stays connected; Upload-Post will not send feed posts for it until 2026-10-17 18:20 UTC so the restriction is not extended.';

    expect(publishRestrictionUntil(precheck, now)).toBe(Date.parse("2026-10-17T18:20:00Z"));
  });

  it("falls back to a day for a bare spam block and ignores unrelated failures", () => {
    const block =
      "PublisherRequestFailed: Action suspected as spam. Activity is restricted. If this is a mistake, please review your account.";

    expect(publishRestrictionUntil(block, now)).toBe(now + 24 * HOUR);
    expect(
      publishRestrictionUntil("PublisherRequestFailed: mídia inacessível (HTTP 404)", now),
    ).toBeNull();
  });
});
