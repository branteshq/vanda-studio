import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internalAction } from "./_generated/server";
import { plan } from "./pipeline/plan";
import { planLayer } from "./pipeline/livePlan";

/**
 * Plan one account: deliberate over its consolidated memory and persist the
 * resulting suggestions. Reads the OpenRouter key from the deployment env; a
 * model/persistence failure aborts the pass (next cycle retries).
 */
export const planAccount = internalAction({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    await Effect.runPromise(plan(accountId).pipe(Effect.provide(planLayer(ctx, apiKey))));
  },
});
