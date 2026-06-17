import { components } from "./_generated/api";
import { Autumn } from "@useautumn/convex";

const autumnComponent = (components as { autumn?: unknown }).autumn;
if (!autumnComponent) {
	throw new Error("Autumn component not configured in convex.config.ts");
}

export const autumn = new Autumn(autumnComponent as never, {
	secretKey: process.env.AUTUMN_SECRET_KEY ?? "",
	identify: async (ctx: any) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		return {
			customerId: identity.subject,
			customerData: {
				name: typeof identity.name === "string" ? identity.name : undefined,
				email: typeof identity.email === "string" ? identity.email : undefined,
			},
		};
	},
});
