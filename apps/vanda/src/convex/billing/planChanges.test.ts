import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPreviewUnchanged,
  billingRequest,
  parsePreview,
  planChangeParams,
} from "./planChanges";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("plan change billing contract", () => {
  it("explicitly supports immediate and scheduled prorated changes without resetting the period", () => {
    for (const schedule of ["immediate", "end_of_cycle"] as const) {
      expect(planChangeParams("ana", "conectado", schedule)).toEqual({
        customer_id: "ana",
        plan_id: "conectado",
        plan_schedule: schedule,
        proration_behavior: "prorate_immediately",
      });
    }
  });
  it("preserves major currency units and accepts credits", () => {
    expect(parsePreview({ total: -23.45, currency: "brl" })).toEqual({
      total: -23.45,
      currency: "BRL",
    });
    expect(() => parsePreview({ total: "23.45", currency: "brl" })).toThrow();
    expect(() => parsePreview({ total: NaN, currency: "brl" })).toThrow();
  });
  it("requires renewed consent when the price or currency changes", () => {
    const expected = { total: 12, currency: "BRL" };
    expect(() => assertPreviewUnchanged({ total: 13, currency: "BRL" }, expected)).toThrow();
    expect(() => assertPreviewUnchanged({ total: 12, currency: "USD" }, expected)).toThrow();
    expect(() => assertPreviewUnchanged(expected, expected)).not.toThrow();
  });
  it("pins the API version and uses the documented REST field names", async () => {
    vi.stubEnv("AUTUMN_SECRET_KEY", "test-key");

    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ total: 0, currency: "brl" })));

    vi.stubGlobal("fetch", fetchMock);
    const params = planChangeParams("ana", "conectado", "immediate");
    await billingRequest("preview_attach", params);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.useautumn.com/v1/billing.preview_attach",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(params),
        headers: expect.objectContaining({
          "x-api-version": "2.4.0",
          Authorization: "Bearer test-key",
        }),
      }),
    );
  });
});
