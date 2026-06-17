import { mutation, query } from "./_generated/server";

function normalizeName(name: unknown, email: unknown): string {
	if (typeof name === "string" && name.trim()) return name.trim();
	if (typeof email === "string" && email.includes("@")) return email.split("@")[0]!.trim();
	return "User";
}

function normalizeEmail(email: unknown): string {
	return typeof email === "string" ? email.trim() : "";
}

export const ensureCurrent = mutation({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");

		const now = Date.now();
		const name = normalizeName(identity.name, identity.email);
		const email = normalizeEmail(identity.email);
		const imageUrl = typeof identity.pictureUrl === "string" ? identity.pictureUrl : undefined;

		const existing = await ctx.db
			.query("users")
			.withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, {
				name,
				email,
				...(imageUrl ? { imageUrl } : {}),
				updatedAt: now,
			});
			return existing._id;
		}

		return await ctx.db.insert("users", {
			name,
			email,
			clerkId: identity.subject,
			...(imageUrl ? { imageUrl } : {}),
			createdAt: now,
			updatedAt: now,
		});
	},
});

export const current = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		return await ctx.db
			.query("users")
			.withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
			.unique();
	},
});
