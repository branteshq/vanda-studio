import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalAction, internalMutation, internalQuery } from "../_generated/server";
import { autumn } from "../autumn";
import { allowanceForPlan } from "../usage";
import { customerOrNull } from "./customerLookup";
import { PLAN_PRODUCT_IDS } from "./plans";
import {
  billingRequest,
  planChangeParams,
  parsePreview,
  assertPreviewUnchanged,
} from "./planChanges";

/**
 * Autumn is the billing brain: plans, checkout, portal, subscription state.
 * Enforcement never calls it — syncBilling copies the active plan and period
 * onto the users row (the snapshot usage.ts reads), on dashboard load and
 * after checkout or a plan change.
 */

// Trailing slashes are stripped so `${BASE_URL}/perfil` never doubles up —
// a stray "https://host/" in the env once 404'd every checkout return.
const BASE_URL = (
  process.env.PUBLIC_APP_URL ||
  process.env.PUBLIC_AP_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

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
  const products = customer?.products?.filter(
    (product) => product.id && (PLAN_PRODUCT_IDS as readonly string[]).includes(product.id),
  );
  const active = products?.find(
    (product) => product.status === "active" || product.status === "trialing",
  );
  // Preserve scheduled changes, including legacy automatically deferred downgrades.
  const scheduled = products?.find((product) => product.status === "scheduled");
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
    const customer = customerOrNull(result);
    const snapshot = snapshotOf(customer as { products?: CustomerProduct[] } | null);
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
  handler: async (ctx, args): Promise<{ checkoutUrl: string | null; attached: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    // A NEW subscriber must always land on the Stripe page — without
    // forceCheckout, a customer with a card on file (e.g. from an earlier
    // subscription) gets silently charged by attach, which reads as "the
    // button did nothing". Plan CHANGES stay direct: Autumn handles
    // upgrade/downgrade proration through attach, not checkout.
    const customer = customerOrNull(await autumn.customers.get(ctx));
    const products = (customer as { products?: CustomerProduct[] } | null)?.products ?? [];
    const current = snapshotOf({ products });
    if (current.planId !== null) {
      throw new Error("Confira e confirme a prévia para mudar de plano.");
    }
    // Self-heal wedged attachments: an abandoned/failed checkout can leave a
    // plan product in past_due/incomplete — invisible to the UI (which shows
    // trial) yet blocking every new attach with "already attached". Anything
    // neither live nor scheduled is dead weight; clear it before proceeding.
    // (The component client has no cancel method — raw REST, like the sync
    // backstop below.)
    const secretKey = process.env.AUTUMN_SECRET_KEY;
    for (const product of products) {
      if (
        secretKey !== undefined &&
        product.id !== undefined &&
        (PLAN_PRODUCT_IDS as readonly string[]).includes(product.id) &&
        product.status !== "active" &&
        product.status !== "trialing" &&
        product.status !== "scheduled"
      ) {
        console.log(`[Autumn] clearing wedged product ${product.id} (${product.status})`);
        const response = await fetch("https://api.useautumn.com/v1/cancel", {
          method: "POST",
          headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            customer_id: identity.subject,
            product_id: product.id,
            cancel_immediately: true,
          }),
        });
        if (!response.ok) {
          console.log(`[Autumn] failed to clear ${product.id}: ${await response.text()}`);
        }
      }
    }
    const result = await autumn.checkout(ctx, {
      productId: args.planId,
      successUrl: `${BASE_URL}/perfil`,
      forceCheckout: current.planId === null,
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

const ScheduleSchema = v.union(v.literal("immediate"), v.literal("end_of_cycle"));

export const previewPlanChange = action({
  args: { planId: PlanIdSchema, schedule: ScheduleSchema },
  handler: async (ctx, { planId, schedule }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const current = snapshotOf(customerOrNull(await autumn.customers.get(ctx)));
    if (!current.planId) throw new Error("Assine um plano antes de solicitar uma mudança.");
    const preview = parsePreview(
      await billingRequest("preview_attach", planChangeParams(identity.subject, planId, schedule)),
    );
    return {
      ...preview,
      currentPlanId: current.planId,
      scheduledPlanId: current.scheduledPlanId,
      effectiveAt: schedule === "immediate" ? null : current.periodEnd,
    };
  },
});

export const acquireChangeLock = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
    if (!user) throw new Error("user not found");
    const now = Date.now();
    if (user.billingChangeStartedAt && now - user.billingChangeStartedAt < 10 * 60_000) {
      throw new Error("Uma mudança de plano já está em andamento. Aguarde e confira seu plano.");
    }
    await ctx.db.patch(user._id, { billingChangeStartedAt: now });
    return now;
  },
});

export const releaseChangeLock = internalMutation({
  args: { clerkId: v.string(), startedAt: v.number() },
  handler: async (ctx, { clerkId, startedAt }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
    if (user?.billingChangeStartedAt === startedAt)
      await ctx.db.patch(user._id, { billingChangeStartedAt: undefined });
  },
});

export const changePlan = action({
  args: {
    planId: PlanIdSchema,
    schedule: ScheduleSchema,
    currentPlanId: v.string(),
    scheduledPlanId: v.union(v.string(), v.null()),
    total: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args): Promise<{ checkoutUrl: string | null; attached: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const startedAt = await ctx.runMutation(internal.billing.autumn.acquireChangeLock, {
      clerkId: identity.subject,
    });
    try {
      const current = snapshotOf(customerOrNull(await autumn.customers.get(ctx)));
      if (
        current.planId !== args.currentPlanId ||
        current.scheduledPlanId !== args.scheduledPlanId
      ) {
        throw new Error("Seu plano mudou. Atualize a prévia antes de confirmar.");
      }
      const params = planChangeParams(identity.subject, args.planId, args.schedule);
      assertPreviewUnchanged(parsePreview(await billingRequest("preview_attach", params)), args);
      // A scheduled downgrade must be removed on the active plan, never by
      // canceling the active subscription. Sync even if the replacement fails.
      try {
        if (current.scheduledPlanId) {
          await billingRequest("update", {
            customer_id: identity.subject,
            plan_id: current.planId,
            cancel_action: "uncancel",
          });
          assertPreviewUnchanged(
            parsePreview(await billingRequest("preview_attach", params)),
            args,
          );
        }
        const result = (await billingRequest("attach", {
          ...params,
          success_url: `${BASE_URL}/perfil`,
          redirect_mode: "if_required",
        })) as { payment_url?: string | null; required_action?: unknown };
        if (result.required_action && !result.payment_url) {
          throw new Error("A cobrança precisa de atenção. Abra Gerenciar cobrança e faturas.");
        }
        return { checkoutUrl: result.payment_url ?? null, attached: !result.payment_url };
      } finally {
        await ctx.runAction(internal.billing.autumn.syncCallerBilling, {
          clerkId: identity.subject,
        });
      }
    } finally {
      await ctx.runMutation(internal.billing.autumn.releaseChangeLock, {
        clerkId: identity.subject,
        startedAt,
      });
    }
  },
});

/** Refresh after a billing write even when the browser closes before its response. */
export const syncCallerBilling = internalAction({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const key = process.env.AUTUMN_SECRET_KEY;
    if (!key) throw new Error("Autumn não configurado");
    const response = await fetch(
      `https://api.useautumn.com/v1/customers/${encodeURIComponent(clerkId)}`,
      {
        headers: { Authorization: `Bearer ${key}` },
      },
    );
    if (!response.ok) throw new Error("Não foi possível sincronizar o plano.");
    const snapshot = snapshotOf(await response.json());
    await ctx.runMutation(internal.billing.autumn.applySnapshot, {
      clerkId,
      planId: snapshot.planId,
      periodStart: snapshot.periodStart,
      periodEnd: snapshot.periodEnd,
      scheduledPlanId: snapshot.scheduledPlanId,
    });
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
 * Manual repair: re-sync subscribers from Autumn. No polling cron is registered.
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
