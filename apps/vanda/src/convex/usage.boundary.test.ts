// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import {
  PLAN_COST_SHARE,
  TIER_ALLOWANCE_BRL,
  TIER_ALLOWANCE_MICRO_USD,
  TRIAL_ALLOWANCE_MICRO_USD,
  allowanceForPlan,
} from "./usage";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Ana",
      email: "ana@e.com",
      clerkId: "ana",
    });
    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      name: "Café da Ana",
      createdAt: now,
      updatedAt: now,
    });
    const orphanAccountId = await ctx.db.insert("accounts", {
      createdAt: now,
      updatedAt: now,
    });
    return { userId, accountId, orphanAccountId };
  });
  return { t, ...ids };
};

describe("usage metering", () => {
  it("charges through the account to the owner's pooled meter", async () => {
    const { t, accountId, userId } = await setup();
    await t.mutation(internal.usage.charge, {
      accountId,
      kind: "paint",
      usd: 0.07,
      ref: "nano-banana-2",
    });
    const budget = await t.query(internal.usage.budget, { accountId });
    expect(budget.ok).toBe(true);
    expect(budget.spentMicroUsd).toBe(70_000);
    expect(budget.allowanceMicroUsd).toBe(TRIAL_ALLOWANCE_MICRO_USD);
    expect(budget.periodKey).toBe("trial");

    const events = await t.run((ctx) =>
      ctx.db
        .query("usageEvents")
        .withIndex("by_user_period", (q) => q.eq("userId", userId).eq("periodKey", "trial"))
        .collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.accountId).toBe(accountId);
  });

  it("blocks the gate once the allowance is exhausted", async () => {
    const { t, accountId } = await setup();
    await t.mutation(internal.usage.charge, {
      accountId,
      kind: "chat",
      usd: TRIAL_ALLOWANCE_MICRO_USD / 1_000_000 + 0.01,
    });
    const budget = await t.query(internal.usage.budget, { accountId });
    expect(budget.ok).toBe(false);
  });

  it("never blocks accounts without an owner, and never bills them", async () => {
    const { t, orphanAccountId, userId } = await setup();
    await t.mutation(internal.usage.charge, {
      accountId: orphanAccountId,
      kind: "scan",
      usd: 1,
    });
    const budget = await t.query(internal.usage.budget, { accountId: orphanAccountId });
    expect(budget.ok).toBe(true);
    const periods = await t.run((ctx) =>
      ctx.db
        .query("usagePeriods")
        .withIndex("by_user_period", (q) => q.eq("userId", userId))
        .collect(),
    );
    expect(periods).toHaveLength(0);
  });

  it("resets the meter per billing period for subscribers", async () => {
    const { t, accountId, userId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, {
        planId: "basico",
        usageAllowanceMicroUsd: TIER_ALLOWANCE_MICRO_USD.basico!,
        billingPeriodStart: 1_000,
        billingPeriodEnd: 2_000,
      });
    });
    await t.mutation(internal.usage.charge, { accountId, kind: "chat", usd: 0.5 });
    // The period rolls: same user, fresh counter under the new key.
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { billingPeriodStart: 3_000, billingPeriodEnd: 4_000 });
    });
    const budget = await t.query(internal.usage.budget, { accountId });
    expect(budget.spentMicroUsd).toBe(0);
    expect(budget.periodKey).toBe("p3000");
  });

  it("summarizes as a percentage for the signed-in owner", async () => {
    const { t, accountId } = await setup();
    await t.mutation(internal.usage.charge, {
      accountId,
      kind: "paint",
      usd: (TRIAL_ALLOWANCE_MICRO_USD / 1_000_000) * 0.5,
    });
    const summary = await t.withIdentity({ subject: "ana" }).query(api.usage.summary, {});
    expect(summary).not.toBeNull();
    expect(summary!.plan).toBeNull();
    expect(summary!.usedPct).toBe(50);
    expect(summary!.limited).toBe(false);
  });

  it("keeps the Básico R$40 cost share across paid tiers", () => {
    expect(PLAN_COST_SHARE).toBeCloseTo(40 / 96);
    expect(TIER_ALLOWANCE_BRL.basico).toBe(40);
    expect(TIER_ALLOWANCE_BRL.profissional).toBeCloseTo(146 * (40 / 96));
    expect(TIER_ALLOWANCE_BRL.conectado).toBeCloseTo(50 * (40 / 96));
    expect(allowanceForPlan("basico-anual")).toBe(TIER_ALLOWANCE_MICRO_USD.basico);
    expect(allowanceForPlan("profissional")).toBe(TIER_ALLOWANCE_MICRO_USD.profissional);
    expect(allowanceForPlan(undefined)).toBe(TRIAL_ALLOWANCE_MICRO_USD);
  });

  it("applies updated paid allowances without waiting for a billing resync", async () => {
    const { t, accountId, userId } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(userId, {
        planId: "basico",
        usageAllowanceMicroUsd: 1,
        billingPeriodStart: 1_000,
      }),
    );
    const budget = await t.query(internal.usage.budget, { accountId });
    expect(budget.allowanceMicroUsd).toBe(TIER_ALLOWANCE_MICRO_USD.basico);
  });
});
