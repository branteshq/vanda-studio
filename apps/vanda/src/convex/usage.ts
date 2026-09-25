import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { PLAN_TIERS, tierOfPlan } from "./billing/plans";
import { isConnectedSubscriber } from "./openaiSub";
import { modelUsageValidator } from "./usageDetails";
import type { AgentActivityId } from "./agentActivity";

/**
 * The usage meter: every real-money cost (model calls, image generation,
 * sandbox time, market scans) is charged here in micro-USD — USD because
 * that's the currency providers bill us in. Subscriptions are per user and
 * the pool is global across their businesses; accountId on each event keeps
 * per-business attribution for analytics.
 *
 * Enforcement never leaves Convex: allowance and billing period are a cached
 * snapshot on the users row (synced from Autumn), and balance checks read one
 * counter row. Autumn is consulted once per period change, never per call.
 */

/** Pinned FX for converting BRL plan budgets into the USD meter. Revisit when
 * the rate moves — this constant is where the margin is maintained. */
export const BRL_PER_USD = 5.5;

const microUsdFromBrl = (brl: number): number => Math.round((brl / BRL_PER_USD) * 1_000_000);

/** Provider spend is capped at the same share of each plan's monthly price.
 * R$40 on the R$96 Básico plan establishes a 41.67% cost envelope. */
export const PLAN_COST_SHARE = 40 / 96;

export const TIER_ALLOWANCE_BRL: Record<string, number> = Object.fromEntries(
  PLAN_TIERS.map((plan) => [plan.tier, plan.monthly.priceBrl * PLAN_COST_SHARE]),
);

export const TIER_ALLOWANCE_MICRO_USD: Record<string, number> = Object.fromEntries(
  Object.entries(TIER_ALLOWANCE_BRL).map(([tier, brl]) => [tier, microUsdFromBrl(brl)]),
);

/** One-time pool for users without a subscription (≈ R$7). */
export const TRIAL_ALLOWANCE_MICRO_USD = microUsdFromBrl(7);

export const allowanceForPlan = (planId: string | undefined): number =>
  planId === undefined
    ? TRIAL_ALLOWANCE_MICRO_USD
    : (TIER_ALLOWANCE_MICRO_USD[tierOfPlan(planId)] ?? TRIAL_ALLOWANCE_MICRO_USD);

/** Trial spend accumulates in one lifetime bucket; subscribers per period. */
const periodKeyOf = (user: Doc<"users">): string =>
  user.planId && user.billingPeriodStart ? `p${user.billingPeriodStart}` : "trial";

export interface BudgetState {
  ok: boolean;
  spentMicroUsd: number;
  allowanceMicroUsd: number;
  periodKey: string;
}

const resolveUser = async (
  ctx: QueryCtx,
  args: { userId?: Id<"users"> | undefined; accountId?: Id<"accounts"> | undefined },
): Promise<Doc<"users"> | null> => {
  if (args.userId) return ctx.db.get(args.userId);

  if (!args.accountId) return null;
  const account = await ctx.db.get(args.accountId);

  return account?.ownerUserId ? ctx.db.get(account.ownerUserId) : null;
};

const periodRow = (ctx: QueryCtx, userId: Id<"users">, periodKey: string) =>
  ctx.db
    .query("usagePeriods")
    .withIndex("by_user_period", (q) => q.eq("userId", userId).eq("periodKey", periodKey))
    .unique();

export const budgetOf = async (ctx: QueryCtx, user: Doc<"users">): Promise<BudgetState> => {
  const periodKey = periodKeyOf(user);
  const row = await periodRow(ctx, user._id, periodKey);
  const spentMicroUsd = row?.spentMicroUsd ?? 0;

  // Paid allowances follow the current plan configuration immediately instead
  // of retaining the amount cached when the subscription was last synchronized.
  const allowanceMicroUsd = user.planId
    ? allowanceForPlan(user.planId)
    : (user.usageAllowanceMicroUsd ?? TRIAL_ALLOWANCE_MICRO_USD);

  return { ok: spentMicroUsd < allowanceMicroUsd, spentMicroUsd, allowanceMicroUsd, periodKey };
};

/**
 * Append a charge and bump the period counter. Callable from any mutation
 * (transactional with the write that produced the cost). Accounts without an
 * owner are logged nowhere — there is no one to bill.
 */
export const chargeUsage = async (
  ctx: MutationCtx,
  args: {
    accountId?: Id<"accounts"> | undefined;
    userId?: Id<"users"> | undefined;
    kind: string;
    usd: number;
    ref?: string | undefined;
    requestId?: string | undefined;
    threadId?: string | undefined;
    activityId?: AgentActivityId | undefined;
    modelUsage?: Doc<"usageEvents">["modelUsage"];
  },
): Promise<void> => {
  const user = await resolveUser(ctx, args);

  if (!user) return;
  const microUsd = Math.round(args.usd * 1_000_000);

  if (microUsd < 0 || (microUsd === 0 && !args.modelUsage)) return;
  const periodKey = periodKeyOf(user);
  const now = Date.now();

  const event = {
    userId: user._id,
    kind: args.kind,
    microUsd,
    periodKey,
    createdAt: now,
  };

  if (args.accountId) Object.assign(event, { accountId: args.accountId });

  if (args.ref) Object.assign(event, { ref: args.ref.slice(0, 120) });

  if (args.modelUsage) Object.assign(event, { modelUsage: args.modelUsage });

  if (args.requestId) Object.assign(event, { requestId: args.requestId });

  if (args.threadId) Object.assign(event, { threadId: args.threadId });

  if (args.activityId) {
    const activity = await ctx.db.get(args.activityId);

    if (
      activity &&
      ("accountId" in activity
        ? activity.accountId === args.accountId
        : activity.userId === user._id)
    )
      Object.assign(event, {
        requestId:
          "accountId" in activity
            ? (activity.requestId ?? activity.promptMessageId)
            : activity.promptMessageId,
        threadId: activity.threadId,
      });
  }

  await ctx.db.insert("usageEvents", event);

  if (microUsd === 0) return;
  const row = await periodRow(ctx, user._id, periodKey);

  if (row) {
    await ctx.db.patch(row._id, { spentMicroUsd: row.spentMicroUsd + microUsd, updatedAt: now });
  } else {
    await ctx.db.insert("usagePeriods", {
      userId: user._id,
      periodKey,
      spentMicroUsd: microUsd,
      updatedAt: now,
    });
  }
};

/** Actions charge through this; accountId or userId, cost in USD. */
export const charge = internalMutation({
  args: {
    accountId: v.optional(v.id("accounts")),
    userId: v.optional(v.id("users")),
    kind: v.string(),
    usd: v.number(),
    ref: v.optional(v.string()),
    requestId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    modelUsage: v.optional(modelUsageValidator),
  },
  handler: (ctx, args) => chargeUsage(ctx, args),
});

/** One original prompt, including delegated agents/tools and repeated attempts. */
export const requestCosts = internalQuery({
  args: { userId: v.id("users"), requestId: v.string() },
  handler: async (ctx, { userId, requestId }) => {
    const events = await ctx.db
      .query("usageEvents")
      .withIndex("by_user_request", (q) => q.eq("userId", userId).eq("requestId", requestId))
      .collect();

    let microUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let modelSteps = 0;
    let estimatedSteps = 0;
    let unpricedAttempts = 0;

    for (const event of events) {
      microUsd += event.microUsd;

      if (!event.modelUsage) continue;

      if (event.modelUsage.costSource === "unknown") {
        unpricedAttempts++;
        continue;
      }

      modelSteps++;

      if (event.modelUsage.costSource === "estimated") estimatedSteps++;
      inputTokens += event.modelUsage.inputTokens ?? 0;
      outputTokens += event.modelUsage.outputTokens ?? 0;
      cacheReadTokens += event.modelUsage.cacheReadTokens ?? 0;
      cacheWriteTokens += event.modelUsage.cacheWriteTokens ?? 0;
    }

    return {
      microUsd,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      modelSteps,
      estimatedSteps,
      unpricedAttempts,
      events,
    };
  },
});

/**
 * The gate actions consult before spending. Accounts without an owner are
 * never blocked (nothing to bill). Callers throw publicError("USAGE_LIMIT") on !ok.
 */
export const budget = internalQuery({
  args: { accountId: v.optional(v.id("accounts")), userId: v.optional(v.id("users")) },
  handler: async (ctx, args): Promise<BudgetState> => {
    const user = await resolveUser(ctx, args);

    if (!user) {
      return { ok: true, spentMicroUsd: 0, allowanceMicroUsd: 0, periodKey: "none" };
    }

    return budgetOf(ctx, user);
  },
});

/**
 * What the owner sees: a percentage, never the underlying money. `plan` is
 * the Autumn product id (null = trial), `renewsAt` the period end.
 */
export const summary = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    plan: string | null;
    scheduledPlan: string | null;
    usedPct: number;
    limited: boolean;
    chatLimited: boolean;
    renewsAt: number | null;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) return null;
    const state = await budgetOf(ctx, user);

    const usedPct =
      state.allowanceMicroUsd > 0
        ? Math.min(100, Math.round((state.spentMicroUsd / state.allowanceMicroUsd) * 100))
        : 100;

    return {
      plan: user.planId ?? null,
      scheduledPlan: user.scheduledPlanId ?? null,
      usedPct,
      limited: !state.ok,
      chatLimited: !state.ok && !isConnectedSubscriber(user),
      renewsAt: user.planId ? (user.billingPeriodEnd ?? null) : null,
    };
  },
});
