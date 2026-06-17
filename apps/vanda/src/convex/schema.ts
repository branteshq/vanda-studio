import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	users: defineTable({
		name: v.string(),
		email: v.string(),
		clerkId: v.string(),
		imageUrl: v.optional(v.string()),
		createdAt: v.optional(v.number()),
		updatedAt: v.optional(v.number()),
	}).index("by_clerk_id", ["clerkId"]),

	instagramConnections: defineTable({
		userId: v.id("users"),
		provider: v.literal("instagram_graph"),
		status: v.union(v.literal("connected"), v.literal("error"), v.literal("expired")),
		externalAccountId: v.string(),
		externalAccountName: v.optional(v.string()),
		handle: v.optional(v.string()),
		accountType: v.optional(v.string()),
		mediaCount: v.optional(v.number()),
		scopes: v.optional(v.array(v.string())),
		tokenCiphertext: v.optional(v.string()),
		tokenIv: v.optional(v.string()),
		tokenAuthTag: v.optional(v.string()),
		tokenExpiresAt: v.optional(v.number()),
		lastConnectedAt: v.number(),
		lastSyncAt: v.optional(v.number()),
		lastError: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_user_id", ["userId"])
		.index("by_external_account", ["provider", "externalAccountId"]),

	instagramPosts: defineTable({
		userId: v.id("users"),
		connectionId: v.id("instagramConnections"),
		externalPostId: v.string(),
		caption: v.optional(v.string()),
		mediaType: v.string(),
		mediaUrl: v.optional(v.string()),
		thumbnailUrl: v.optional(v.string()),
		permalink: v.string(),
		publishedAt: v.number(),
		likeCount: v.optional(v.number()),
		commentsCount: v.optional(v.number()),
		importedAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_connection_external", ["connectionId", "externalPostId"])
		.index("by_user_published", ["userId", "publishedAt"]),
});
