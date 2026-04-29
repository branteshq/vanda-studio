import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const socialPostInput = v.object({
    externalPostId: v.string(),
    caption: v.optional(v.string()),
    mediaType: v.string(),
    mediaProductType: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    permalink: v.string(),
    publishedAt: v.number(),
    likeCount: v.optional(v.number()),
    commentsCount: v.optional(v.number()),
    reach: v.optional(v.number()),
    impressions: v.optional(v.number()),
    saved: v.optional(v.number()),
    shares: v.optional(v.number()),
    totalInteractions: v.optional(v.number()),
    engagementScore: v.optional(v.float64()),
    children: v.optional(v.array(v.object({
        externalPostId: v.string(),
        mediaType: v.string(),
        mediaUrl: v.optional(v.string()),
        thumbnailUrl: v.optional(v.string()),
        permalink: v.optional(v.string()),
    }))),
});

const accountMetricsInput = v.object({
    followersCount: v.optional(v.number()),
    followingCount: v.optional(v.number()),
    postsCount: v.optional(v.number()),
    reach: v.optional(v.number()),
    profileViews: v.optional(v.number()),
});

export const importInstagramForProjectInternal = internalMutation({
    args: {
        userId: v.id("users"),
        projectId: v.id("projects"),
        connectionId: v.id("social_connections"),
        externalAccountId: v.string(),
        handle: v.optional(v.string()),
        externalAccountName: v.optional(v.string()),
        profilePictureUrl: v.optional(v.string()),
        accountMetrics: accountMetricsInput,
        posts: v.array(socialPostInput),
        capturedAt: v.number(),
    },
    handler: async (ctx, args) => {
        const [project, connection] = await Promise.all([
            ctx.db.get(args.projectId),
            ctx.db.get(args.connectionId),
        ]);

        if (!project || project.userId !== args.userId) {
            throw new Error("Projeto não encontrado");
        }
        if (!connection || connection.userId !== args.userId || connection.projectId !== args.projectId) {
            throw new Error("Conexão do Instagram não encontrada para este projeto");
        }

        const now = Date.now();
        const importedIds: Id<"social_posts">[] = [];

        await ctx.db.insert("account_metric_snapshots", {
            userId: args.userId,
            projectId: args.projectId,
            connectionId: args.connectionId,
            platform: "instagram",
            provider: connection.provider,
            externalAccountId: args.externalAccountId,
            capturedAt: args.capturedAt,
            ...(args.accountMetrics.followersCount !== undefined
                ? { followersCount: args.accountMetrics.followersCount }
                : {}),
            ...(args.accountMetrics.followingCount !== undefined
                ? { followingCount: args.accountMetrics.followingCount }
                : {}),
            ...(args.accountMetrics.postsCount !== undefined
                ? { postsCount: args.accountMetrics.postsCount }
                : {}),
            ...(args.accountMetrics.reach !== undefined
                ? { reach: args.accountMetrics.reach }
                : {}),
            ...(args.accountMetrics.profileViews !== undefined
                ? { profileViews: args.accountMetrics.profileViews }
                : {}),
        });

        for (const post of args.posts) {
            const existing = await ctx.db
                .query("social_posts")
                .withIndex("by_connection_external", (q) =>
                    q.eq("connectionId", args.connectionId).eq("externalPostId", post.externalPostId)
                )
                .first();

            const postPatch = {
                userId: args.userId,
                projectId: args.projectId,
                connectionId: args.connectionId,
                platform: "instagram",
                provider: connection.provider,
                externalAccountId: args.externalAccountId,
                externalPostId: post.externalPostId,
                mediaType: post.mediaType,
                permalink: post.permalink,
                publishedAt: post.publishedAt,
                importedAt: now,
                updatedAt: now,
                ...(post.caption ? { caption: post.caption } : {}),
                ...(post.mediaProductType ? { mediaProductType: post.mediaProductType } : {}),
                ...(post.mediaUrl ? { mediaUrl: post.mediaUrl } : {}),
                ...(post.thumbnailUrl ? { thumbnailUrl: post.thumbnailUrl } : {}),
                ...(post.likeCount !== undefined ? { likeCount: post.likeCount } : {}),
                ...(post.commentsCount !== undefined ? { commentsCount: post.commentsCount } : {}),
                ...(post.reach !== undefined ? { reach: post.reach } : {}),
                ...(post.impressions !== undefined ? { impressions: post.impressions } : {}),
                ...(post.saved !== undefined ? { saved: post.saved } : {}),
                ...(post.shares !== undefined ? { shares: post.shares } : {}),
                ...(post.totalInteractions !== undefined ? { totalInteractions: post.totalInteractions } : {}),
                ...(post.engagementScore !== undefined ? { engagementScore: post.engagementScore } : {}),
                insightsCapturedAt: args.capturedAt,
                ...(post.children?.length ? { children: post.children } : {}),
            };

            const socialPostId = existing?._id ?? (await ctx.db.insert("social_posts", postPatch));
            if (existing) {
                await ctx.db.patch(existing._id, postPatch);
            }
            importedIds.push(socialPostId);

            await ctx.db.insert("post_metric_snapshots", {
                userId: args.userId,
                projectId: args.projectId,
                connectionId: args.connectionId,
                socialPostId,
                platform: "instagram",
                provider: connection.provider,
                externalAccountId: args.externalAccountId,
                externalPostId: post.externalPostId,
                capturedAt: args.capturedAt,
                ...(post.likeCount !== undefined ? { likeCount: post.likeCount } : {}),
                ...(post.commentsCount !== undefined ? { commentsCount: post.commentsCount } : {}),
                ...(post.reach !== undefined ? { reach: post.reach } : {}),
                ...(post.impressions !== undefined ? { impressions: post.impressions } : {}),
                ...(post.saved !== undefined ? { saved: post.saved } : {}),
                ...(post.shares !== undefined ? { shares: post.shares } : {}),
                ...(post.totalInteractions !== undefined ? { totalInteractions: post.totalInteractions } : {}),
                ...(post.engagementScore !== undefined ? { engagementScore: post.engagementScore } : {}),
            });
        }

        const projectPatch: Partial<Doc<"projects">> = {
            platform: "instagram",
            isFetching: false,
            lastInstagramSyncAt: args.capturedAt,
            lastInstagramSyncMode: "intel_only",
        };
        if (args.handle) {
            projectPatch.instagramHandle = args.handle;
            projectPatch.instagramUrl = `https://www.instagram.com/${args.handle}/`;
        }
        if (args.profilePictureUrl) projectPatch.profilePictureUrl = args.profilePictureUrl;
        if (args.accountMetrics.followersCount !== undefined) {
            projectPatch.followersCount = args.accountMetrics.followersCount;
        }
        if (args.accountMetrics.followingCount !== undefined) {
            projectPatch.followingCount = args.accountMetrics.followingCount;
        }
        if (args.accountMetrics.postsCount !== undefined) {
            projectPatch.postsCount = args.accountMetrics.postsCount;
        }

        await ctx.db.patch(args.projectId, projectPatch);
        await ctx.db.patch(args.connectionId, {
            status: "connected",
            lastSyncAt: args.capturedAt,
            lastError: undefined,
            updatedAt: now,
            ...(args.handle ? { handle: args.handle } : {}),
            ...(args.externalAccountName ? { externalAccountName: args.externalAccountName } : {}),
        });

        return {
            importedCount: importedIds.length,
            accountSnapshotCreated: true,
            postSnapshotsCreated: args.posts.length,
        };
    },
});

export const markInstagramImportErrorInternal = internalMutation({
    args: {
        projectId: v.id("projects"),
        connectionId: v.id("social_connections"),
        error: v.string(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        await Promise.all([
            ctx.db.patch(args.projectId, { isFetching: false }),
            ctx.db.patch(args.connectionId, {
                lastError: args.error.slice(0, 1000),
                updatedAt: now,
            }),
        ]);
    },
});

export const listByProject = query({
    args: {
        projectId: v.id("projects"),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return [];

        const project = await ctx.db.get(args.projectId);
        if (!project) return [];

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user || project.userId !== user._id) return [];

        const limit = Math.min(100, Math.max(1, args.limit ?? 30));
        const posts = await ctx.db
            .query("social_posts")
            .withIndex("by_project_published", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .take(limit);

        return posts;
    },
});

export const getForAnalysisInternal = internalQuery({
    args: {
        clerkId: v.string(),
        socialPostId: v.id("social_posts"),
    },
    handler: async (ctx, args) => {
        const post = await ctx.db.get(args.socialPostId);
        if (!post) {
            throw new Error("Post importado não encontrado");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
            .unique();
        if (!user || post.userId !== user._id) {
            throw new Error("Não autorizado");
        }

        return post;
    },
});

export const setPostIntelligenceInternal = internalMutation({
    args: {
        socialPostId: v.id("social_posts"),
        intelligence: v.object({
            topic: v.string(),
            hook: v.string(),
            format: v.string(),
            visualSignals: v.array(v.string()),
            performanceNotes: v.array(v.string()),
            recommendationWeight: v.number(),
            analyzedAt: v.number(),
        }),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.socialPostId, {
            intelligence: args.intelligence,
            updatedAt: Date.now(),
        });
    },
});

export const createPublishedInstagramPostInternal = internalMutation({
    args: {
        userId: v.id("users"),
        projectId: v.id("projects"),
        connectionId: v.id("social_connections"),
        externalAccountId: v.string(),
        externalPostId: v.string(),
        caption: v.string(),
        mediaUrl: v.string(),
        permalink: v.string(),
        publishedAt: v.number(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("social_posts")
            .withIndex("by_connection_external", (q) =>
                q.eq("connectionId", args.connectionId).eq("externalPostId", args.externalPostId)
            )
            .first();
        const now = Date.now();
        const patch = {
            userId: args.userId,
            projectId: args.projectId,
            connectionId: args.connectionId,
            platform: "instagram",
            provider: "instagram_graph",
            externalAccountId: args.externalAccountId,
            externalPostId: args.externalPostId,
            caption: args.caption,
            mediaType: "IMAGE",
            mediaUrl: args.mediaUrl,
            permalink: args.permalink,
            publishedAt: args.publishedAt,
            importedAt: now,
            updatedAt: now,
        };
        if (existing) {
            await ctx.db.patch(existing._id, patch);
            return existing._id;
        }
        return await ctx.db.insert("social_posts", patch);
    },
});

export const listCaptionSnippetsForDigestInternal = internalQuery({
    args: {
        projectId: v.id("projects"),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = Math.min(50, Math.max(1, args.limit ?? 30));
        const posts = await ctx.db
            .query("social_posts")
            .withIndex("by_project_published", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .take(limit);

        return posts
            .filter((post) => post.caption?.trim())
            .map((post) => ({
                _id: post._id,
                caption: post.caption ?? "",
                mediaType: post.mediaType,
                timestamp: new Date(post.publishedAt).toISOString(),
                likeCount: post.likeCount,
                commentsCount: post.commentsCount,
                engagementScore: post.engagementScore,
            }));
    },
});

export const listRecommendationContextInternal = internalQuery({
    args: {
        projectId: v.id("projects"),
        limit: v.number(),
    },
    handler: async (ctx, args) => {
        const limit = Math.min(20, Math.max(1, args.limit));
        const posts = await ctx.db
            .query("social_posts")
            .withIndex("by_project_published", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .take(Math.max(limit, 12));

        return posts
            .sort((a, b) => {
                const scoreA = a.intelligence?.recommendationWeight ?? a.engagementScore ?? 0;
                const scoreB = b.intelligence?.recommendationWeight ?? b.engagementScore ?? 0;
                return scoreB - scoreA;
            })
            .slice(0, limit)
            .map((post) => ({
                caption: post.caption,
                mediaType: post.mediaType,
                publishedAt: post.publishedAt,
                likeCount: post.likeCount,
                commentsCount: post.commentsCount,
                reach: post.reach,
                impressions: post.impressions,
                saved: post.saved,
                shares: post.shares,
                totalInteractions: post.totalInteractions,
                engagementScore: post.engagementScore,
                intelligence: post.intelligence,
            }));
    },
});
