import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

async function currentUser(ctx: QueryCtx | MutationCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) return null;
	return await ctx.db
		.query("users")
		.withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
		.unique();
}

function publicConnection(connection: Doc<"instagramConnections">) {
	const {
		tokenCiphertext: _tokenCiphertext,
		tokenIv: _tokenIv,
		tokenAuthTag: _tokenAuthTag,
		...safe
	} = connection;
	return safe;
}

export const listMine = query({
	args: {},
	handler: async (ctx) => {
		const user = await currentUser(ctx);
		if (!user) return [];
		const connections = await ctx.db
			.query("instagramConnections")
			.withIndex("by_user_id", (q) => q.eq("userId", user._id))
			.collect();
		return connections.map(publicConnection);
	},
});

export const disconnect = mutation({
	args: {
		connectionId: v.id("instagramConnections"),
	},
	handler: async (ctx, args) => {
		const user = await currentUser(ctx);
		if (!user) throw new Error("Not authenticated");
		const connection = await ctx.db.get(args.connectionId);
		if (!connection || connection.userId !== user._id) throw new Error("Instagram connection not found");
		await ctx.db.patch(args.connectionId, {
			status: "expired",
			tokenCiphertext: undefined,
			tokenIv: undefined,
			tokenAuthTag: undefined,
			updatedAt: Date.now(),
		});
	},
});

export const upsertConnectionInternal = internalMutation({
	args: {
		clerkId: v.string(),
		externalAccountId: v.string(),
		externalAccountName: v.optional(v.string()),
		handle: v.optional(v.string()),
		accountType: v.optional(v.string()),
		mediaCount: v.optional(v.number()),
		scopes: v.optional(v.array(v.string())),
		tokenCiphertext: v.string(),
		tokenIv: v.string(),
		tokenAuthTag: v.string(),
		tokenExpiresAt: v.optional(v.number()),
	},
	handler: async (ctx, args): Promise<{ _id: Id<"instagramConnections">; externalAccountId: string; handle?: string }> => {
		const now = Date.now();
		let user = await ctx.db
			.query("users")
			.withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
			.unique();

		if (!user) {
			const userId = await ctx.db.insert("users", {
				name: "User",
				email: "",
				clerkId: args.clerkId,
				createdAt: now,
				updatedAt: now,
			});
			user = (await ctx.db.get(userId))!;
		}

		const existing = await ctx.db
			.query("instagramConnections")
			.withIndex("by_external_account", (q) =>
				q.eq("provider", "instagram_graph").eq("externalAccountId", args.externalAccountId),
			)
			.first();

		const patch = {
			userId: user._id,
			provider: "instagram_graph" as const,
			status: "connected" as const,
			externalAccountId: args.externalAccountId,
			...(args.externalAccountName ? { externalAccountName: args.externalAccountName } : {}),
			...(args.handle ? { handle: args.handle } : {}),
			...(args.accountType ? { accountType: args.accountType } : {}),
			...(args.mediaCount !== undefined ? { mediaCount: args.mediaCount } : {}),
			...(args.scopes ? { scopes: args.scopes } : {}),
			tokenCiphertext: args.tokenCiphertext,
			tokenIv: args.tokenIv,
			tokenAuthTag: args.tokenAuthTag,
			...(args.tokenExpiresAt ? { tokenExpiresAt: args.tokenExpiresAt } : {}),
			lastConnectedAt: now,
			updatedAt: now,
		};

		if (existing) {
			await ctx.db.patch(existing._id, patch);
			return { _id: existing._id, externalAccountId: args.externalAccountId, ...(args.handle ? { handle: args.handle } : {}) };
		}

		const id = await ctx.db.insert("instagramConnections", {
			...patch,
			createdAt: now,
		});
		return { _id: id, externalAccountId: args.externalAccountId, ...(args.handle ? { handle: args.handle } : {}) };
	},
});
