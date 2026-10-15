// @vitest-environment edge-runtime
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { errorCode, errorMessage, publicError, retryAfterMs } from "../errors";
import { internal } from "./_generated/api";
import { LIMITS } from "./rateLimits";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);

  return t;
};

const take = (t: ReturnType<typeof setup>, name: keyof typeof LIMITS, key: string, count = 1) =>
  t.mutation(internal.rateLimits.take, { name, key, count });

describe("rate limits", () => {
  it("admits a burst up to capacity, then refuses with a wait", async () => {
    const t = setup();
    const capacity = LIMITS.agentTurn.capacity;

    for (let i = 0; i < capacity; i++) {
      expect((await take(t, "agentTurn", "owner-a")).ok).toBe(true);
    }

    const refused = await take(t, "agentTurn", "owner-a");

    expect(refused.ok).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
  });

  it("keeps each key on its own budget", async () => {
    const t = setup();
    const capacity = LIMITS.agentTurn.capacity;

    for (let i = 0; i < capacity; i++) await take(t, "agentTurn", "owner-a");

    expect((await take(t, "agentTurn", "owner-a")).ok).toBe(false);
    expect((await take(t, "agentTurn", "owner-b")).ok).toBe(true);
  });

  it("counts images against the hourly cap in one go", async () => {
    const t = setup();
    const hourly = LIMITS.imageGenerationHourly.rate;

    expect((await take(t, "imageGenerationHourly", "owner-a", hourly)).ok).toBe(true);
    expect((await take(t, "imageGenerationHourly", "owner-a", 1)).ok).toBe(false);
    expect((await take(t, "imageGenerationHourly", "owner-b", 1)).ok).toBe(true);
  });
});

describe("rate-limited errors", () => {
  it("carries retryAfterMs through the public envelope and into the copy", () => {
    const error = publicError("RATE_LIMITED", 45_000);

    expect(errorCode(error)).toBe("RATE_LIMITED");
    expect(retryAfterMs(error)).toBe(45_000);
    expect(errorMessage(error)).toMatch(/Tente de novo em 45 segundos\.$/);
    expect(errorMessage(error)).toMatch(/^Você fez muitos pedidos/);
  });

  it("rounds long waits up to minutes", () => {
    expect(errorMessage(publicError("RATE_LIMITED", 61_000))).toMatch(
      /Tente de novo em 2 minutos\.$/,
    );
  });

  it("keeps the plain copy and no retry field when no wait is known", () => {
    const error = publicError("RATE_LIMITED");

    expect(retryAfterMs(error)).toBeNull();
    expect(errorMessage(error)).not.toMatch(/Tente de novo/);
  });
});
