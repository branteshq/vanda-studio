import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { tierOfPlan } from "./billing/plans";

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

/** Usage allowance per plan tier, from the BRL cost budgets (R$20 / R$30). */
export const TIER_ALLOWANCE_MICRO_USD: Record<string, number> = {
  basico: microUsdFromBrl(20),
  profissional: microUsdFromBrl(30),
};

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
  const allowanceMicroUsd = user.usageAllowanceMicroUsd ?? allowanceForPlan(user.planId);
  return { ok: spentMicroUsd < allowanceMicroUsd, spentMicroUsd, allowanceMicroUsd, periodKey };
};

/** The user-facing limit message — also the tool/action error text. */
export const USAGE_LIMIT_MESSAGE =
  "Limite de uso do plano atingido. Faça upgrade em Perfil para continuar.";

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
  },
): Promise<void> => {
  const user = await resolveUser(ctx, args);
  if (!user) return;
  const microUsd = Math.round(args.usd * 1_000_000);
  if (microUsd <= 0) return;
  const periodKey = periodKeyOf(user);
  const now = Date.now();
  await ctx.db.insert("usageEvents", {
    userId: user._id,
    ...(args.accountId ? { accountId: args.accountId } : {}),
    kind: args.kind,
    microUsd,
    ...(args.ref ? { ref: args.ref.slice(0, 120) } : {}),
    periodKey,
    createdAt: now,
  });
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
  },
  handler: (ctx, args) => chargeUsage(ctx, args),
});

/**
 * The gate actions consult before spending. Accounts without an owner are
 * never blocked (nothing to bill). Callers throw USAGE_LIMIT_MESSAGE on !ok.
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
    usedPct: number;
    limited: boolean;
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
      usedPct,
      limited: !state.ok,
      renewsAt: user.planId ? (user.billingPeriodEnd ?? null) : null,
    };
  },
});
