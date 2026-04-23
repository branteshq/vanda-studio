import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const listMine = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user) {
            return [];
        }

        return await ctx.db
            .query("social_connections")
            .withIndex("by_user_platform", (q) => q.eq("userId", user._id).eq("platform", "instagram"))
            .collect();
    },
});

export const upsertConnectionInternal = internalMutation({
    args: {
        clerkId: v.string(),
        platform: v.string(),
        provider: v.string(),
        status: v.string(),
        externalAccountId: v.string(),
        externalAccountName: v.optional(v.string()),
        handle: v.optional(v.string()),
        pageId: v.optional(v.string()),
        pageName: v.optional(v.string()),
        scopes: v.optional(v.array(v.string())),
        tokenCiphertext: v.string(),
        tokenIv: v.string(),
        tokenAuthTag: v.string(),
        tokenExpiresAt: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<{
        _id: Id<"social_connections">;
        externalAccountId: string;
        handle?: string;
        pageName?: string;
    }> => {
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
            .unique();
        if (!user) {
            throw new Error("Usuário não encontrado");
        }

        const now = Date.now();
        const existing = await ctx.db
            .query("social_connections")
            .withIndex("by_external_account", (q) =>
                q.eq("provider", args.provider).eq("externalAccountId", args.externalAccountId)
            )
            .first();

        const patch = {
            userId: user._id,
            platform: args.platform,
            provider: args.provider,
            status: args.status,
            externalAccountId: args.externalAccountId,
            tokenCiphertext: args.tokenCiphertext,
            tokenIv: args.tokenIv,
            tokenAuthTag: args.tokenAuthTag,
            lastConnectedAt: now,
            updatedAt: now,
            ...(args.externalAccountName ? { externalAccountName: args.externalAccountName } : {}),
            ...(args.handle ? { handle: args.handle } : {}),
            ...(args.pageId ? { pageId: args.pageId } : {}),
            ...(args.pageName ? { pageName: args.pageName } : {}),
            ...(args.scopes ? { scopes: args.scopes } : {}),
            ...(args.tokenExpiresAt ? { tokenExpiresAt: args.tokenExpiresAt } : {}),
        };

        if (existing) {
            if (existing.userId !== user._id) {
                throw new Error("Esta conta do Instagram já está conectada a outro usuário");
            }
            await ctx.db.patch(existing._id, patch);
            return {
                _id: existing._id,
                externalAccountId: args.externalAccountId,
                ...(args.handle ? { handle: args.handle } : {}),
                ...(args.pageName ? { pageName: args.pageName } : {}),
            };
        }

        const id = await ctx.db.insert("social_connections", {
            ...patch,
            createdAt: now,
        });

        return {
            _id: id,
            externalAccountId: args.externalAccountId,
            ...(args.handle ? { handle: args.handle } : {}),
            ...(args.pageName ? { pageName: args.pageName } : {}),
        };
    },
});
