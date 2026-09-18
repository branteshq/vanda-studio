import { components } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { Autumn } from "@useautumn/convex";

export const autumn = new Autumn(components.autumn, {
  secretKey: process.env.AUTUMN_SECRET_KEY ?? "",
  identify: async (ctx: ActionCtx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) return null;

    return {
      customerId: identity.subject,
      customerData: {
        name: identity.name,
        email: identity.email,
      },
    };
  },
});
