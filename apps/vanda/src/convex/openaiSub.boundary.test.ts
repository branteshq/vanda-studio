// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { PLAN_PRODUCT_IDS, planLabel, tierOfPlan } from "./billing/plans";
import { TIER_ALLOWANCE_MICRO_USD, allowanceForPlan } from "./usage";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async (userPatch: Record<string, unknown>) => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Ana",
      email: "ana@e.com",
      clerkId: "ana",
      ...userPatch,
    });
    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      name: "Café da Ana",
      createdAt: now,
      updatedAt: now,
    });
    return { userId, accountId };
  });
  return { t, ...ids };
};

describe("conectado plan", () => {
  it("is registered end to end: product id, label, tier, allowance", () => {
    expect(PLAN_PRODUCT_IDS).toContain("conectado");
    expect(planLabel("conectado")).toBe("ChatGPT");
    expect(tierOfPlan("conectado")).toBe("conectado");
    expect(allowanceForPlan("conectado")).toBe(TIER_ALLOWANCE_MICRO_USD.conectado);
  });

  it("routes through the subscription only when plan AND tokens are present", async () => {
    const connected = await setup({
      planId: "conectado",
      openaiAccountId: "acc_1",
      openaiAccessCiphertext: "x",
      openaiAccessIv: "y",
      openaiAccessAuthTag: "z",
    });
    const state = await connected.t.query(internal.openaiSub.subscriberState, {
      accountId: connected.accountId,
    });
    expect(state.active).toBe(true);
    expect(state.userId).toBe(connected.userId);
  });

  it("stays inactive without tokens or on other plans", async () => {
    const planNoTokens = await setup({ planId: "conectado" });
    expect(
      (
        await planNoTokens.t.query(internal.openaiSub.subscriberState, {
          accountId: planNoTokens.accountId,
        })
      ).active,
    ).toBe(false);

    const tokensWrongPlan = await setup({
      planId: "basico",
      openaiAccessCiphertext: "x",
      openaiAccessIv: "y",
      openaiAccessAuthTag: "z",
    });
    expect(
      (
        await tokensWrongPlan.t.query(internal.openaiSub.subscriberState, {
          accountId: tokensWrongPlan.accountId,
        })
      ).active,
    ).toBe(false);
  });

  it("disconnect clears the connection", async () => {
    const { t } = await setup({
      planId: "conectado",
      openaiAccountId: "acc_1",
      openaiAccessCiphertext: "x",
      openaiAccessIv: "y",
      openaiAccessAuthTag: "z",
      openaiRefreshCiphertext: "r",
      openaiRefreshIv: "ri",
      openaiRefreshAuthTag: "ra",
      openaiConnectedAt: 1,
    });
    const asAna = t.withIdentity({ subject: "ana" });
    const before = await asAna.query(api.openaiSub.connectionStatus, {});
    expect(before?.connected).toBe(true);
    await asAna.mutation(api.openaiSub.disconnect, {});
    const after = await asAna.query(api.openaiSub.connectionStatus, {});
    expect(after?.connected).toBe(false);
  });
});
