import { v } from "convex/values";
import { action } from "../_generated/server";
import { autumn } from "../autumn";

const BASE_URL = process.env.PUBLIC_APP_URL || "http://localhost:3000";
const PlanIdSchema = v.union(v.literal("basico"), v.literal("mediano"), v.literal("profissional"));

function summarizeCustomer(customerData: any) {
	const activeProduct = customerData?.products?.find(
		(product: any) => product.status === "active" || product.status === "trialing",
	);
	const scheduled = customerData?.products?.find((product: any) => product.status === "scheduled");
	return {
		activePlanId: activeProduct?.id ?? null,
		scheduledPlan: scheduled
			? {
					id: scheduled.id,
					startsAt: scheduled.current_period_start ?? scheduled.started_at ?? null,
				}
			: null,
		accessStatus: activeProduct?.status === "trialing" ? "trialing" : activeProduct ? "active" : "trial_eligible",
		trialEligible: !activeProduct,
		renewalAt: activeProduct?.current_period_end ?? activeProduct?.trial_ends_at ?? null,
	};
}

export const startCheckout = action({
	args: { planId: PlanIdSchema },
	handler: async (ctx, args): Promise<{ checkoutUrl: string | null }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const result = await autumn.checkout(ctx, {
			productId: args.planId,
			successUrl: `${BASE_URL}/billing`,
			checkoutSessionParams: {
				cancel_url: `${BASE_URL}/billing`,
			},
		});
		if (result.error) throw new Error(result.error.message || "Autumn checkout failed");
		return { checkoutUrl: result.data?.url ?? null };
	},
});

export const getBillingPortalUrl = action({
	args: {},
	handler: async (ctx): Promise<{ url: string }> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const result = await autumn.customers.billingPortal(ctx, { returnUrl: `${BASE_URL}/billing` });
		if (result.error) throw new Error(result.error.message || "Failed to open billing portal");
		return { url: result.data?.url ?? "" };
	},
});

export const getBillingOverview = action({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		const result = await autumn.customers.get(ctx);
		if (result.error) throw new Error(result.error.message || "Failed to load customer");
		return summarizeCustomer(result.data);
	},
});
