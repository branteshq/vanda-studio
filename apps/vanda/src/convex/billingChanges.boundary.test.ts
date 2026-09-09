// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("./autumn", () => ({ autumn: { customers: { get: mocks.get } } }));
const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      clerkId: "ana",
      name: "Ana",
      email: "ana@example.com",
      planId: "basico",
      billingPeriodStart: 1000,
    }),
  );
  const customer = {
    products: [
      { id: "basico", status: "active", current_period_start: 1000, current_period_end: 2000 },
      {
        id: "conectado",
        status: "scheduled",
        current_period_start: 2000,
        current_period_end: 3000,
      },
    ],
  };
  mocks.get.mockImplementation(async () => ({ data: structuredClone(customer) }));
  vi.stubEnv("AUTUMN_SECRET_KEY", "test-key");
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("preview_attach")) return Response.json({ total: -10, currency: "brl" });
    if (url.includes("billing.update")) {
      expect(JSON.parse(init!.body as string)).toMatchObject({
        plan_id: "basico",
        cancel_action: "uncancel",
      });
      customer.products = customer.products.filter((p) => p.status !== "scheduled");
      return Response.json({});
    }
    if (url.includes("billing.attach")) {
      customer.products = [
        { id: "conectado", status: "active", current_period_start: 1000, current_period_end: 2000 },
      ];
      return Response.json({ payment_url: null });
    }
    if (url.includes("/customers/ana")) return Response.json(customer);
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { t, owner: t.withIdentity({ subject: "ana" }), userId, fetchMock };
}

describe("plan change boundary", () => {
  it("previews without writes, replaces a scheduled downgrade and immediately syncs the active plan", async () => {
    const { t, owner, userId, fetchMock } = await setup();
    const preview = await owner.action(api.billing.autumn.previewPlanChange, {
      planId: "conectado",
      schedule: "immediate",
    });
    expect(preview).toMatchObject({
      total: -10,
      currency: "BRL",
      currentPlanId: "basico",
      scheduledPlanId: "conectado",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { effectiveAt: _, ...confirmed } = preview;
    expect(
      await owner.action(api.billing.autumn.changePlan, {
        ...confirmed,
        planId: "conectado",
        schedule: "immediate",
      }),
    ).toEqual({ checkoutUrl: null, attached: true });
    expect(await t.run((ctx) => ctx.db.get(userId))).toMatchObject({
      planId: "conectado",
      billingPeriodStart: 1000,
    });
    expect((await t.run((ctx) => ctx.db.get(userId)))?.scheduledPlanId).toBeUndefined();
  });
  it("rejects unauthenticated changes before any provider request", async () => {
    const { t, fetchMock } = await setup();
    await expect(
      t.action(api.billing.autumn.previewPlanChange, {
        planId: "conectado",
        schedule: "immediate",
      }),
    ).rejects.toThrow("Not authenticated");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a stale preview without touching the scheduled change", async () => {
    const { owner, fetchMock } = await setup();
    await expect(
      owner.action(api.billing.autumn.changePlan, {
        planId: "conectado",
        schedule: "immediate",
        currentPlanId: "profissional",
        scheduledPlanId: null,
        total: -10,
        currency: "BRL",
      }),
    ).rejects.toThrow("Seu plano mudou");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not charge when the confirmed price is stale", async () => {
    const { owner, fetchMock } = await setup();
    await expect(
      owner.action(api.billing.autumn.changePlan, {
        planId: "conectado",
        schedule: "immediate",
        currentPlanId: "basico",
        scheduledPlanId: "conectado",
        total: 100,
        currency: "BRL",
      }),
    ).rejects.toThrow("O valor mudou");
    expect(fetchMock.mock.calls.every(([url]) => url.includes("preview_attach"))).toBe(true);
  });

  it("syncs the actual plan when a replacement fails after removing the schedule", async () => {
    const { t, owner, userId, fetchMock } = await setup();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (url.includes("billing.attach")) throw new Error("payment failed");
      return original(url, init);
    });
    await expect(
      owner.action(api.billing.autumn.changePlan, {
        planId: "conectado",
        schedule: "immediate",
        currentPlanId: "basico",
        scheduledPlanId: "conectado",
        total: -10,
        currency: "BRL",
      }),
    ).rejects.toThrow("payment failed");
    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.planId).toBe("basico");
    expect(user?.scheduledPlanId).toBeUndefined();
    expect(user?.billingChangeStartedAt).toBeUndefined();
  });

  it("returns payment redirects without claiming activation", async () => {
    const { t, owner, userId, fetchMock } = await setup();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (url.includes("billing.attach"))
        return Response.json({ payment_url: "https://checkout.stripe.com/test" });
      return original(url, init);
    });
    expect(
      await owner.action(api.billing.autumn.changePlan, {
        planId: "conectado",
        schedule: "immediate",
        currentPlanId: "basico",
        scheduledPlanId: "conectado",
        total: -10,
        currency: "BRL",
      }),
    ).toEqual({ checkoutUrl: "https://checkout.stripe.com/test", attached: false });
    expect((await t.run((ctx) => ctx.db.get(userId)))?.planId).toBe("basico");
  });

  it("serializes billing changes for an owner", async () => {
    const { t } = await setup();
    const startedAt = await t.mutation(internal.billing.autumn.acquireChangeLock, {
      clerkId: "ana",
    });
    await expect(
      t.mutation(internal.billing.autumn.acquireChangeLock, { clerkId: "ana" }),
    ).rejects.toThrow("já está em andamento");
    await t.mutation(internal.billing.autumn.releaseChangeLock, { clerkId: "ana", startedAt });
    await expect(
      t.mutation(internal.billing.autumn.acquireChangeLock, { clerkId: "ana" }),
    ).resolves.toBeTypeOf("number");
  });
});
