// @vitest-environment edge-runtime
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { chatUsageHandler, failedModelAttempt } from "./chatModel";
import { modelCharge } from "./usageDetails";
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
  agentComponent.register(t);

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
  it("aggregates model steps, delegated tools and unknown retry costs under the original request", async () => {
    const { t, accountId, userId } = await setup();
    const requestId = "original-caetano-prompt";

    const activityId = await t.run((ctx) =>
      ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId: "vanda-thread",
        promptMessageId: "delegated-prompt",
        requestId,
        startedAt: 1,
      }),
    );

    const usage = {
      inputTokens: 1000,
      outputTokens: 50,
      totalTokens: 1050,
      inputTokenDetails: { noCacheTokens: 200, cacheReadTokens: 700, cacheWriteTokens: 100 },
      outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
    };

    await t.action(async (ctx) => {
      const call = {
        threadId: "caetano-thread",
        agentName: "caetano",
        usage,
        model: "anthropic/claude-opus-5",
        provider: "openrouter.chat",
        providerMetadata: { openrouter: { usage: { cost: 0.0123 } } },
      };

      await chatUsageHandler("caetano_chat", requestId)(ctx, {
        ...call,
        userId: `caetano:${userId}`,
      });
      await chatUsageHandler("chat", requestId)(ctx, {
        ...call,
        threadId: "vanda-thread",
        userId: accountId,
      });
      await failedModelAttempt(ctx, {
        userId,
        requestId,
        threadId: "caetano-thread",
        model: call.model,
        kind: "caetano_chat",
      });
    });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["image"])));
    await t.mutation(internal.imagesData.savePaintedImage, {
      accountId,
      activityId,
      storageId,
      prompt: "paint",
      mimeType: "image/png",
      width: 10,
      height: 10,
      costUsd: 0.07,
    });

    const codeRunId = await t.mutation(internal.codeRunsData.beginCodeRun, {
      accountId,
      code: "print(1)",
      description: "test",
    });

    await t.mutation(internal.codeRunsData.finishCodeRun, {
      codeRunId,
      activityId,
      status: "ok",
      costUsd: 0.002,
    });
    await t.mutation(internal.instagramData.saveObservation, {
      accountId,
      activityId,
      requestKey: "test",
      operation: "profile",
      target: "cafe",
      workspacePath: "/instagram/profiles/cafe.json",
      source: "apify",
      completeness: "complete",
      payload: {},
      costUsd: 0.003,
      observedAt: 1,
      expiresAt: 2,
    });
    await t.mutation(internal.usage.charge, {
      userId,
      kind: "title",
      requestId: "another-request",
      usd: 0.99,
    });
    const total = await t.query(internal.usage.requestCosts, { userId, requestId });
    expect(total).toMatchObject({
      microUsd: 99_600,
      inputTokens: 2000,
      outputTokens: 100,
      cacheReadTokens: 1400,
      cacheWriteTokens: 200,
      modelSteps: 2,
      estimatedSteps: 0,
      unpricedAttempts: 1,
    });
    expect(total.events).toHaveLength(6);
    expect(total.events.every((event) => event.requestId === requestId)).toBe(true);
    expect((await t.query(internal.usage.budget, { userId })).spentMicroUsd).toBe(1_089_600);

    const stranger = await t.run((ctx) =>
      ctx.db.insert("users", { clerkId: "stranger", name: "Bia", email: "bia@example.com" }),
    );

    expect(
      (await t.query(internal.usage.requestCosts, { userId: stranger, requestId })).events,
    ).toEqual([]);
  });

  it("records free/subscription usage without billing and labels missing prices as estimates", async () => {
    const { t, userId } = await setup();

    const usage = {
      inputTokens: 500,
      outputTokens: 25,
      totalTokens: 525,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };

    const free = modelCharge(
      "opus",
      "openrouter.chat",
      {
        ...usage,
        inputTokenDetails: { noCacheTokens: 30, cacheReadTokens: 450, cacheWriteTokens: 20 },
      },
      { openrouter: { usage: { cost: 0 } } },
    );

    expect(free).toMatchObject({
      usd: 0,
      modelUsage: { cacheReadTokens: 450, cacheWriteTokens: 20, costSource: "reported" },
    });
    const subscription = modelCharge("gpt", "openai.responses", usage, undefined);
    expect(subscription).toMatchObject({ usd: 0, modelUsage: { costSource: "subscription" } });
    const estimated = modelCharge("opus", "openrouter.chat", usage, undefined);
    expect(estimated.usd).toBeCloseTo(0.0012, 10);
    expect(estimated.modelUsage.costSource).toBe("estimated");

    for (const charge of [free, subscription])
      await t.mutation(internal.usage.charge, {
        userId,
        requestId: "free",
        kind: "chat",
        ...charge,
      });
    const total = await t.query(internal.usage.requestCosts, { userId, requestId: "free" });
    expect(total.microUsd).toBe(0);
    expect(total.events).toHaveLength(2);
    expect((await t.query(internal.usage.budget, { userId })).spentMicroUsd).toBe(0);
  });

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

  it("keeps paid-service spending after switching but unblocks connected ChatGPT", async () => {
    const { t, accountId, userId } = await setup();
    await t.run((ctx) =>
      ctx.db.patch(userId, {
        planId: "basico",
        billingPeriodStart: 1_000,
      }),
    );
    await t.mutation(internal.usage.charge, { accountId, kind: "chat", usd: 20 });
    await t.run((ctx) => ctx.db.patch(userId, { planId: "conectado" }));
    const owner = t.withIdentity({ subject: "ana" });
    expect(await owner.query(api.usage.summary, {})).toMatchObject({
      limited: true,
      chatLimited: true,
    });
    await expect(
      owner.mutation(api.chat.sendMessage, { accountId, prompt: "Oi" }),
    ).rejects.toMatchObject({ data: { kind: "vanda-error", code: "USAGE_LIMIT" } });
    await t.run((ctx) => ctx.db.patch(userId, { openaiAccessCiphertext: "encrypted" }));
    expect(await owner.query(api.usage.summary, {})).toMatchObject({
      limited: true,
      chatLimited: false,
    });
    await expect(
      owner.mutation(api.chat.sendMessage, { accountId, prompt: "Oi" }),
    ).resolves.toHaveProperty("threadId");
    expect(await t.query(internal.usage.budget, { accountId })).toMatchObject({
      ok: false,
      spentMicroUsd: 20_000_000,
      periodKey: "p1000",
    });
    await t.run((ctx) => ctx.db.patch(userId, { openaiAccessCiphertext: undefined }));
    expect(await owner.query(api.usage.summary, {})).toMatchObject({ chatLimited: true });
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
