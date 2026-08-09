import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { autumn } from "../autumn";
import { allowanceForPlan } from "../usage";
import { PLAN_PRODUCT_IDS } from "./plans";

/**
 * Autumn is the billing brain: plans, checkout, portal, subscription state.
 * Enforcement never calls it — syncBilling copies the active plan and period
 * onto the users row (the snapshot usage.ts reads), on dashboard load, after
 * checkout, and via a daily cron backstop.
 */

const BASE_URL =
  process.env.PUBLIC_APP_URL || process.env.PUBLIC_AP_URL || "http://localhost:3000";

const PlanIdSchema = v.union(...PLAN_PRODUCT_IDS.map((id) => v.literal(id)));

interface CustomerProduct {
  id?: string;
  status?: string;
  current_period_start?: number | null;
  current_period_end?: number | null;
  started_at?: number | null;
}

interface BillingSnapshot {
  planId: string | null;
  periodStart: number | null;
  periodEnd: number | null;
  scheduledPlanId: string | null;
  status: "active" | "trialing" | "none";
}

const snapshotOf = (customer: { products?: CustomerProduct[] } | null): BillingSnapshot => {
  const active = customer?.products?.find(
    (product) => product.status === "active" || product.status === "trialing",
  );
  // Downgrades don't switch immediately — Autumn schedules them for the next
  // renewal. The UI needs to know, or the owner clicks "change plan" twice.
  const scheduled = customer?.products?.find((product) => product.status === "scheduled");
  if (!active?.id) {
    return {
      planId: null,
      periodStart: null,
      periodEnd: null,
      scheduledPlanId: scheduled?.id ?? null,
      status: "none",
    };
  }
  return {
    planId: active.id,
    periodStart: active.current_period_start ?? active.started_at ?? null,
    periodEnd: active.current_period_end ?? null,
    scheduledPlanId: scheduled?.id ?? null,
    status: active.status === "trialing" ? "trialing" : "active",
  };
};

/** Write the snapshot usage enforcement reads. Null plan = back to trial pool. */
export const applySnapshot = internalMutation({
  args: {
    clerkId: v.string(),
    planId: v.union(v.string(), v.null()),
    periodStart: v.union(v.number(), v.null()),
    periodEnd: v.union(v.number(), v.null()),
    scheduledPlanId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { clerkId, planId, periodStart, periodEnd, scheduledPlanId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
    if (!user) return;
    await ctx.db.patch(user._id, {
      planId: planId ?? undefined,
      usageAllowanceMicroUsd: allowanceForPlan(planId ?? undefined),
      billingPeriodStart: periodStart ?? undefined,
      billingPeriodEnd: periodEnd ?? undefined,
      scheduledPlanId: scheduledPlanId ?? undefined,
      billingSyncedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/** Pull the caller's subscription from Autumn and cache it for enforcement. */
export const syncBilling = action({
  args: {},
  handler: async (ctx): Promise<BillingSnapshot | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const result = await autumn.customers.get(ctx);
    if (result.error) throw new Error(result.error.message || "Failed to load customer");
    const snapshot = snapshotOf(result.data as { products?: CustomerProduct[] } | null);
    await ctx.runMutation(internal.billing.autumn.applySnapshot, {
      clerkId: identity.subject,
      planId: snapshot.planId,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      scheduledPlanId: snapshot.scheduledPlanId,
    });
    return snapshot;
  },
});

export const startCheckout = action({
  args: { planId: PlanIdSchema },
  handler: async (
    ctx,
    args,
  ): Promise<{ checkoutUrl: string | null; attached: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const result = await autumn.checkout(ctx, {
      productId: args.planId,
      successUrl: `${BASE_URL}/perfil`,
      checkoutSessionParams: {
        cancel_url: `${BASE_URL}/perfil`,
      },
    });
    if (result.error) throw new Error(result.error.message || "Autumn checkout failed");
    const url = result.data?.url ?? null;
    if (url) return { checkoutUrl: url, attached: false };
    // No payment page needed (card on file, upgrades, sandbox): Autumn's
    // checkout is only a preview — attach executes the purchase.
    const attach = await autumn.attach(ctx, { productId: args.planId });
    if (attach.error) {
      const message = attach.error.message || "Autumn attach failed";
      // Downgrades are deferred to the renewal; a second click hits this.
      if (message.includes("already scheduled")) {
        throw new Error("Essa mudança de plano já está agendada para a próxima renovação.");
      }
      throw new Error(message);
    }
    return { checkoutUrl: null, attached: true };
  },
});

export const getBillingPortalUrl = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const result = await autumn.customers.billingPortal(ctx, { returnUrl: `${BASE_URL}/perfil` });
    if (result.error) throw new Error(result.error.message || "Failed to open billing portal");
    return { url: result.data?.url ?? "" };
  },
});

export const listSubscribed = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<{ clerkId: string }>> => {
    const users = await ctx.db.query("users").collect();
    return users
      .filter((user) => user.planId !== undefined)
      .map((user) => ({ clerkId: user.clerkId }));
  },
});

/**
 * Daily backstop: re-sync every subscribed user straight from Autumn's REST
 * API (the component client only resolves the authenticated caller). Keeps
 * period rollovers and cancellations honest even if no one opens the app.
 */
export const syncAllSubscribed = internalAction({
  args: {},
  handler: async (ctx): Promise<number> => {
    const secretKey = process.env.AUTUMN_SECRET_KEY;
    if (!secretKey) return 0;
    const subscribed: Array<{ clerkId: string }> = await ctx.runQuery(
      internal.billing.autumn.listSubscribed,
      {},
    );
    let synced = 0;
    for (const user of subscribed) {
      try {
        const response = await fetch(
          `https://api.useautumn.com/v1/customers/${encodeURIComponent(user.clerkId)}`,
          { headers: { Authorization: `Bearer ${secretKey}` } },
        );
        if (!response.ok) continue;
        const customer = (await response.json()) as { products?: CustomerProduct[] };
        const snapshot = snapshotOf(customer);
        await ctx.runMutation(internal.billing.autumn.applySnapshot, {
          clerkId: user.clerkId,
          planId: snapshot.planId,
          periodStart: snapshot.periodStart,
          periodEnd: snapshot.periodEnd,
          scheduledPlanId: snapshot.scheduledPlanId,
        });
        synced++;
      } catch {
        // One bad customer never blocks the sweep; the next run retries.
      }
    }
    return synced;
  },
});
