import { describe, expect, it } from "vitest";
import { detectBreakout } from "./market";

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
