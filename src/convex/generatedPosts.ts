import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { rankSearchMatch } from "./search";

type ResolvedPostMedia = {
    _id: Id<"media_items">;
    position: number;
    role: string;
    mediaItemId: Id<"media_items">;
    url: string | null;
    thumbnailUrl?: string | null;
    mimeType: string;
    width: number;
    height: number;
    createdAt: number;
    sourceType: string;
    model?: string;
    prompt?: string;
};

type PostCard = {
    _id: Id<"generated_posts">;
    caption: string;
    title?: string;
    platform: string;
    status: string;
    createdAt: number;
    updatedAt: number;
    projectId?: Id<"projects">;
    projectName?: string;
    scheduledFor?: number;
    schedulingStatus?: string;
    mediaCount: number;
    coverUrl: string | null;
    coverThumbnailUrl?: string | null;
    mediaPreview: Array<{
        mediaItemId: Id<"media_items">;
        url: string | null;
        thumbnailUrl?: string | null;
        mimeType: string;
    }>;
};

function normalizePostPlatform(platform?: string | null): string {
    if (platform === "twitter" || platform === "linkedin" || platform === "instagram") {
        return platform;
    }
    return "instagram";
}

async function getCurrentUser(
    ctx: Pick<QueryCtx, "auth" | "db">,
) {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
        return null;
    }

    const user = await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
        .unique();

    return user ?? null;
}

async function canAccessPost(
    ctx: Pick<QueryCtx, "db">,
    userId: Id<"users">,
    post: Doc<"generated_posts">
) {
    if (post.userId === userId) {
        return true;
    }

    if (!post.projectId) {
        return false;
    }

    const project = await ctx.db.get(post.projectId);
    return project?.userId === userId;
}

async function resolvePostMediaByPostId(
    ctx: QueryCtx,
    postIds: Id<"generated_posts">[]
) {
    const uniquePostIds = [...new Set(postIds)];
    const rowsByPost = await Promise.all(
        uniquePostIds.map((postId) =>
            ctx.db
                .query("post_media_items")
                .withIndex("by_post", (q) => q.eq("postId", postId))
                .collect()
        )
    );

    const mediaIds = [...new Set(
        rowsByPost.flatMap((rows) => rows.map((row) => row.mediaItemId))
    )];

    const mediaItems = await Promise.all(mediaIds.map((mediaId) => ctx.db.get(mediaId)));
    const mediaMap = new Map<Id<"media_items">, Doc<"media_items">>();
    for (const item of mediaItems) {
        if (item) {
            mediaMap.set(item._id, item);
        }
    }

    const storageIds = [...new Set(
        [...mediaMap.values()].flatMap((item) =>
            item.thumbnailStorageId ? [item.storageId, item.thumbnailStorageId] : [item.storageId]
        )
    )];
    const storageUrls = await Promise.all(storageIds.map((storageId) => ctx.storage.getUrl(storageId)));
    const urlMap = new Map<Id<"_storage">, string | null>();
    for (let index = 0; index < storageIds.length; index += 1) {
        const storageId = storageIds[index];
        if (storageId) {
            urlMap.set(storageId, storageUrls[index] ?? null);
        }
    }

    const result = new Map<Id<"generated_posts">, ResolvedPostMedia[]>();
    for (let index = 0; index < uniquePostIds.length; index += 1) {
        const postId = uniquePostIds[index];
        const rows = rowsByPost[index] ?? [];
        const resolvedRows = rows
            .sort((a, b) => a.position - b.position)
            .flatMap((row) => {
                const mediaItem = mediaMap.get(row.mediaItemId);
                if (!mediaItem || mediaItem.deletedAt) {
                    return [];
                }

                return [{
                    _id: mediaItem._id,
                    mediaItemId: mediaItem._id,
                    position: row.position,
                    role: row.role,
                    url: urlMap.get(mediaItem.storageId) ?? null,
                    ...(mediaItem.thumbnailStorageId
                        ? { thumbnailUrl: urlMap.get(mediaItem.thumbnailStorageId) ?? null }
                        : {}),
                    mimeType: mediaItem.mimeType,
                    width: mediaItem.width,
                    height: mediaItem.height,
                    createdAt: mediaItem.createdAt,
                    sourceType: mediaItem.sourceType,
                    ...(mediaItem.model ? { model: mediaItem.model } : {}),
                    ...(mediaItem.prompt ? { prompt: mediaItem.prompt } : {}),
                }];
            });

        if (postId) {
            result.set(postId, resolvedRows);
        }
    }

    return result;
}

async function buildPostCards(
    ctx: QueryCtx,
    posts: Doc<"generated_posts">[],
    projectNameById: Map<Id<"projects">, string>
): Promise<PostCard[]> {
    const mediaMap = await resolvePostMediaByPostId(ctx, posts.map((post) => post._id));
    const fallbackStorageIds = [...new Set(
        posts
            .filter((post) => (mediaMap.get(post._id)?.length ?? 0) === 0 && post.imageStorageId)
            .map((post) => post.imageStorageId)
            .filter(Boolean)
    )] as Id<"_storage">[];
    const fallbackStorageUrls = await Promise.all(
        fallbackStorageIds.map((storageId) => ctx.storage.getUrl(storageId))
    );
    const fallbackUrlMap = new Map<Id<"_storage">, string | null>();
    for (let index = 0; index < fallbackStorageIds.length; index += 1) {
        const storageId = fallbackStorageIds[index];
        if (storageId) {
            fallbackUrlMap.set(storageId, fallbackStorageUrls[index] ?? null);
        }
    }

    return posts.map((post): PostCard => {
        const mediaItems = mediaMap.get(post._id) ?? [];
        const cover = mediaItems[0];
        const fallbackCoverUrl = !cover && post.imageStorageId
            ? (fallbackUrlMap.get(post.imageStorageId) ?? null)
            : null;
        const projectName = post.projectId ? projectNameById.get(post.projectId) : undefined;
        return {
            _id: post._id,
            caption: post.caption,
            ...(post.title ? { title: post.title } : {}),
            platform: normalizePostPlatform(post.platform),
            status: post.status,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
            ...(post.projectId ? { projectId: post.projectId } : {}),
            ...(projectName ? { projectName } : {}),
            ...(post.scheduledFor !== undefined ? { scheduledFor: post.scheduledFor } : {}),
            ...(post.schedulingStatus ? { schedulingStatus: post.schedulingStatus } : {}),
            mediaCount: mediaItems.length || (fallbackCoverUrl ? 1 : 0),
            coverUrl: cover?.url ?? fallbackCoverUrl,
            ...(cover?.thumbnailUrl !== undefined ? { coverThumbnailUrl: cover.thumbnailUrl } : {}),
            mediaPreview: mediaItems.slice(0, 3).map((item) => ({
                mediaItemId: item.mediaItemId,
                url: item.url,
                ...(item.thumbnailUrl !== undefined ? { thumbnailUrl: item.thumbnailUrl } : {}),
                mimeType: item.mimeType,
            })),
        };
    });
}

// Get a single generated post with resolved image URL
export const get = query({
    args: {
        id: v.id("generated_posts"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return null;
        }

        const post = await ctx.db.get(args.id);
        if (!post) {
            return null;
        }

        // If post has a project, verify user owns it
        if (post.projectId) {
            const project = await ctx.db.get(post.projectId);
            if (!project) {
                return null;
            }

            const user = await ctx.db
                .query("users")
                .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
                .unique();

            if (!user || project.userId !== user._id) {
                return null;
            }
        }
        // For standalone posts (no projectId), auth check above is sufficient

        // Resolve image URL if available
        let imageUrl: string | null = null;
        if (post.imageStorageId) {
            imageUrl = await ctx.storage.getUrl(post.imageStorageId);
        }

        return {
            ...post,
            platform: normalizePostPlatform(post.platform),
            imageUrl,
        };
    },
});

// List all generated posts for a project
export const listByProject = query({
    args: {
        projectId: v.id("projects"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        // Verify user owns the project
        const project = await ctx.db.get(args.projectId);
        if (!project) {
            return [];
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user || project.userId !== user._id) {
            return [];
        }

        const posts = await ctx.db
            .query("generated_posts")
            .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();

        // Resolve image URLs
        return Promise.all(
            posts.map(async (post) => {
                let imageUrl: string | null = null;
                if (post.imageStorageId) {
                    imageUrl = await ctx.storage.getUrl(post.imageStorageId);
                }
                return {
                    ...post,
                    imageUrl,
                };
            })
        );
    },
});

// Get count of generated posts for a project
export const countByProject = query({
    args: {
        projectId: v.id("projects"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return 0;
        }

        const posts = await ctx.db
            .query("generated_posts")
            .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
            .collect();

        return posts.length;
    },
});

// Create a new generated post
export const create = mutation({
    args: {
        projectId: v.optional(v.id("projects")), // Optional - can be null for standalone posts
        platform: v.optional(v.string()),
        title: v.optional(v.string()),
        caption: v.string(),
        sourcePostIds: v.optional(v.array(v.id("social_posts"))),
        reasoning: v.optional(v.string()),
        model: v.optional(v.string()),
        imageStorageId: v.optional(v.id("_storage")),
        imagePrompt: v.optional(v.string()),
        imageModel: v.optional(v.string()),
        status: v.optional(v.string()), // "generating_caption" | "generating_images" | "generated" | "in_progress"
        // Progressive loading fields
        pendingImageModels: v.optional(v.array(v.string())),
        totalImageModels: v.optional(v.number()),
        // Full brief used for generation
        brief: v.optional(v.object({
            postType: v.string(),
            contentPillar: v.optional(v.string()),
            customTopic: v.optional(v.string()),
            toneOverride: v.optional(v.array(v.string())),
            captionLength: v.optional(v.string()),
            includeHashtags: v.optional(v.boolean()),
            additionalContext: v.optional(v.string()),
            referenceText: v.optional(v.string()),
            referenceImageIds: v.optional(v.array(v.id("_storage"))),
        })),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        // Get current user
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        // If projectId is provided, verify user owns the project
        if (args.projectId) {
            const project = await ctx.db.get(args.projectId);
            if (!project) {
                throw new Error("Project not found");
            }

            if (!user || project.userId !== user._id) {
                throw new Error("Not authorized");
            }
        }

        const now = Date.now();
        return await ctx.db.insert("generated_posts", {
            ...(args.projectId && { projectId: args.projectId }),
            ...(user && { userId: user._id }), // Always save userId for tracking
            ...(args.platform && { platform: args.platform }),
            ...(args.title && { title: args.title }),
            caption: args.caption,
            sourcePostIds: args.sourcePostIds ?? [],
            ...(args.reasoning && { reasoning: args.reasoning }),
            ...(args.model && { model: args.model }),
            ...(args.imageStorageId && { imageStorageId: args.imageStorageId }),
            ...(args.imagePrompt && { imagePrompt: args.imagePrompt }),
            ...(args.imageModel && { imageModel: args.imageModel }),
            ...(args.brief && { brief: args.brief }),
            ...(args.pendingImageModels && { pendingImageModels: args.pendingImageModels }),
            ...(args.totalImageModels !== undefined && { totalImageModels: args.totalImageModels }),
            status: args.status ?? "generated",
            createdAt: now,
            updatedAt: now,
        });
    },
});

// Create or update a real post composition that references library media
export const saveComposedDraft = mutation({
    args: {
        id: v.optional(v.id("generated_posts")),
        projectId: v.optional(v.id("projects")),
        platform: v.optional(v.string()),
        title: v.optional(v.string()),
        caption: v.string(),
        mediaItemIds: v.array(v.id("media_items")),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        if (args.mediaItemIds.length === 0) {
            throw new Error("At least one media item is required");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        if (args.projectId) {
            const project = await ctx.db.get(args.projectId);
            if (!project || project.userId !== user._id) {
                throw new Error("Not authorized");
            }
        }

        const mediaItems = await Promise.all(args.mediaItemIds.map((id) => ctx.db.get(id)));
        if (mediaItems.some((item) => !item || item.userId !== user._id || item.deletedAt)) {
            throw new Error("Invalid media selection");
        }

        const orderedMediaItems = mediaItems as Doc<"media_items">[];
        const firstMediaItem = orderedMediaItems[0];
        if (!firstMediaItem) {
            throw new Error("At least one media item is required");
        }

        const now = Date.now();
        let postId = args.id;

        if (postId) {
            const post = await ctx.db.get(postId);
            if (!post) {
                throw new Error("Generated post not found");
            }

            let hasAccess = post.userId === user._id;
            if (!hasAccess && post.projectId) {
                const project = await ctx.db.get(post.projectId);
                hasAccess = project?.userId === user._id;
            }

            if (!hasAccess) {
                throw new Error("Not authorized");
            }

            await ctx.db.patch(postId, {
                userId: post.userId ?? user._id,
                projectId: args.projectId,
                platform: normalizePostPlatform(args.platform),
                title: args.title,
                caption: args.caption,
                imageStorageId: firstMediaItem.storageId,
                imagePrompt: firstMediaItem.prompt,
                imageModel: firstMediaItem.model,
                isComposed: true,
                status: "draft",
                updatedAt: now,
            });
        } else {
            postId = await ctx.db.insert("generated_posts", {
                userId: user._id,
                platform: normalizePostPlatform(args.platform),
                ...(args.title ? { title: args.title } : {}),
                caption: args.caption,
                imageStorageId: firstMediaItem.storageId,
                isComposed: true,
                status: "draft",
                createdAt: now,
                updatedAt: now,
                ...(args.projectId && { projectId: args.projectId }),
                ...(firstMediaItem.prompt && { imagePrompt: firstMediaItem.prompt }),
                ...(firstMediaItem.model && { imageModel: firstMediaItem.model }),
            });
        }

        const existingLinks = await ctx.db
            .query("post_media_items")
            .withIndex("by_post", (q) => q.eq("postId", postId))
            .collect();

        for (const link of existingLinks) {
            await ctx.db.delete(link._id);
        }

        for (const [position, mediaItemId] of args.mediaItemIds.entries()) {
            await ctx.db.insert("post_media_items", {
                postId,
                mediaItemId,
                position,
                role: position === 0 ? "cover" : "attachment",
            });
        }

        return postId;
    },
});

export const getComposer = query({
    args: {
        id: v.id("generated_posts"),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) {
            return null;
        }

        const post = await ctx.db.get(args.id);
        if (!post || !(await canAccessPost(ctx, user._id, post))) {
            return null;
        }

        const mediaMap = await resolvePostMediaByPostId(ctx, [post._id]);
        return {
            ...post,
            platform: normalizePostPlatform(post.platform),
            mediaItems: mediaMap.get(post._id) ?? [],
        };
    },
});

export const listCardsByUser = query({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) {
            return [];
        }

        const directPosts = await ctx.db
            .query("generated_posts")
            .withIndex("by_user_created", (q) => q.eq("userId", user._id))
            .order("desc")
            .take(args.limit ?? 60);

        const ownedProjects = await ctx.db
            .query("projects")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        const projectPosts = await Promise.all(
            ownedProjects.map((project) =>
                ctx.db
                    .query("generated_posts")
                    .withIndex("by_project_id", (q) => q.eq("projectId", project._id))
                    .order("desc")
                    .collect()
            )
        );

        const postMap = new Map<Id<"generated_posts">, Doc<"generated_posts">>();
        for (const post of directPosts) {
            if (!post.deletedAt) {
                postMap.set(post._id, post);
            }
        }
        for (const rows of projectPosts) {
            for (const post of rows) {
                if (!post.deletedAt) {
                    postMap.set(post._id, post);
                }
            }
        }

        const posts = [...postMap.values()]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, args.limit ?? 60);

        const projectIds = [...new Set(posts.map((post) => post.projectId).filter(Boolean))] as Id<"projects">[];
        const projects = await Promise.all(projectIds.map((projectId) => ctx.db.get(projectId)));
        const projectMap = new Map<Id<"projects">, string>();
        for (const project of projects) {
            if (project) {
                projectMap.set(project._id, project.name);
            }
        }

        return buildPostCards(ctx, posts, projectMap);
    },
});

export const searchCards = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number()),
        platform: v.optional(v.string()),
        projectId: v.optional(v.id("projects")),
        schedulingStatus: v.optional(v.union(v.literal("scheduled"), v.literal("draft"))),
    },
    handler: async (ctx, args) => {
        const user = await getCurrentUser(ctx);
        if (!user) {
            return [];
        }

        const searchTerm = args.query.trim();
        if (!searchTerm) {
            return [];
        }

        const limit = args.limit ?? 20;
        const ownedProjects = await ctx.db
            .query("projects")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();
        const projectNameById = new Map(
            ownedProjects.map((project) => [project._id, project.name] as const)
        );

        const candidatePosts = args.projectId
            ? await (async () => {
                const project = projectNameById.get(args.projectId!);
                if (!project) {
                    return [] as Doc<"generated_posts">[];
                }

                return ctx.db
                    .query("generated_posts")
                    .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId!))
                    .collect();
            })()
            : await (async () => {
                const directPosts = await ctx.db
                    .query("generated_posts")
                    .withIndex("by_user_id", (q) => q.eq("userId", user._id))
                    .collect();
                const projectPostsArrays = await Promise.all(
                    ownedProjects.map((project) =>
                        ctx.db
                            .query("generated_posts")
                            .withIndex("by_project_id", (q) => q.eq("projectId", project._id))
                            .collect()
                    )
                );

                const uniquePosts = new Map<Id<"generated_posts">, Doc<"generated_posts">>();
                for (const post of [...directPosts, ...projectPostsArrays.flat()]) {
                    uniquePosts.set(post._id, post);
                }

                return [...uniquePosts.values()];
            })();

        const matchedPosts = candidatePosts
            .filter((post) => !post.deletedAt)
            .filter((post) => !args.platform || normalizePostPlatform(post.platform) === args.platform)
            .filter((post) => {
                if (args.schedulingStatus === "scheduled") {
                    return post.schedulingStatus === "scheduled";
                }

                if (args.schedulingStatus === "draft") {
                    return post.schedulingStatus !== "scheduled";
                }

                return true;
            })
            .flatMap((post) => {
                const match = rankSearchMatch(searchTerm, [
                    { value: post.title, weight: 12 },
                    { value: post.caption, weight: 10 },
                    { value: post.imagePrompt, weight: 7 },
                    { value: post.projectId ? projectNameById.get(post.projectId) : null, weight: 4 },
                ]);

                if (!match) {
                    return [];
                }

                return [{ post, score: match.score }];
            })
            .sort((a, b) => b.score - a.score || b.post.updatedAt - a.post.updatedAt)
            .slice(0, limit)
            .map(({ post }) => post);

        return buildPostCards(ctx, matchedPosts, projectNameById);
    },
});

// Update from chat (for chat-based generation)
export const updateFromChat = mutation({
    args: {
        id: v.id("generated_posts"),
        caption: v.optional(v.string()),
        imageStorageId: v.optional(v.id("_storage")),
        imagePrompt: v.optional(v.string()),
        model: v.optional(v.string()),
        imageModel: v.optional(v.string()),
        status: v.optional(v.string()),
        // Progressive loading fields
        pendingImageModels: v.optional(v.array(v.string())),
        totalImageModels: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.id);
        if (!post) {
            throw new Error("Generated post not found");
        }

        // If post has a project, verify user owns it
        if (post.projectId) {
            const project = await ctx.db.get(post.projectId);
            if (!project) {
                throw new Error("Project not found");
            }

            const user = await ctx.db
                .query("users")
                .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
                .unique();

            if (!user || project.userId !== user._id) {
                throw new Error("Not authorized");
            }
        }
        // For standalone posts (no projectId), auth check above is sufficient

        await ctx.db.patch(args.id, {
            ...(args.caption && { caption: args.caption }),
            ...(args.imageStorageId && { imageStorageId: args.imageStorageId }),
            ...(args.imagePrompt && { imagePrompt: args.imagePrompt }),
            ...(args.model && { model: args.model }),
            ...(args.imageModel && { imageModel: args.imageModel }),
            ...(args.status && { status: args.status }),
            ...(args.pendingImageModels !== undefined && { pendingImageModels: args.pendingImageModels }),
            ...(args.totalImageModels !== undefined && { totalImageModels: args.totalImageModels }),
            updatedAt: Date.now(),
        });
    },
});

// Remove a model from pending list (called when image generation completes)
export const removeFromPending = mutation({
    args: {
        id: v.id("generated_posts"),
        model: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.id);
        if (!post) return;
        
        const pending = post.pendingImageModels?.filter(m => m !== args.model) ?? [];
        await ctx.db.patch(args.id, { 
            pendingImageModels: pending,
            updatedAt: Date.now(),
        });
    },
});

// Update caption (for editing) - also saves to history
export const updateCaption = mutation({
    args: {
        id: v.id("generated_posts"),
        caption: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.id);
        if (!post) {
            throw new Error("Generated post not found");
        }

        // If post has a project, verify user owns it
        if (post.projectId) {
            const project = await ctx.db.get(post.projectId);
            if (!project) {
                throw new Error("Project not found");
            }

            const user = await ctx.db
                .query("users")
                .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
                .unique();

            if (!user || project.userId !== user._id) {
                throw new Error("Not authorized");
            }
        }
        // For standalone posts (no projectId), auth check above is sufficient

        // Save to history before updating
        const existingVersions = await ctx.db
            .query("generation_history")
            .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", args.id))
            .collect();

        await ctx.db.insert("generation_history", {
            generatedPostId: args.id,
            version: existingVersions.length + 1,
            caption: args.caption,
            ...(post.imageStorageId && { imageStorageId: post.imageStorageId }),
            ...(post.imagePrompt && { imagePrompt: post.imagePrompt }),
            action: "edit_caption",
            ...(post.model && { model: post.model }),
            ...(post.imageModel && { imageModel: post.imageModel }),
            createdAt: Date.now(),
        });

        await ctx.db.patch(args.id, {
            caption: args.caption,
            status: "edited",
            updatedAt: Date.now(),
        });
    },
});

// Update image (after regeneration)
export const updateImage = mutation({
    args: {
        id: v.id("generated_posts"),
        imageStorageId: v.id("_storage"),
        imagePrompt: v.string(),
        imageModel: v.optional(v.string()),
        feedback: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.id);
        if (!post) {
            throw new Error("Generated post not found");
        }

        // If post has a project, verify user owns it
        if (post.projectId) {
            const project = await ctx.db.get(post.projectId);
            if (!project) {
                throw new Error("Project not found");
            }

            const user = await ctx.db
                .query("users")
                .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
                .unique();

            if (!user || project.userId !== user._id) {
                throw new Error("Not authorized");
            }
        }
        // For standalone posts (no projectId), auth check above is sufficient

        // Save to history before updating
        const existingVersions = await ctx.db
            .query("generation_history")
            .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", args.id))
            .collect();

        await ctx.db.insert("generation_history", {
            generatedPostId: args.id,
            version: existingVersions.length + 1,
            caption: post.caption,
            imageStorageId: args.imageStorageId,
            imagePrompt: args.imagePrompt,
            action: "regenerate_image",
            ...(args.feedback && { feedback: args.feedback }),
            ...(post.model && { model: post.model }),
            ...(args.imageModel && { imageModel: args.imageModel }),
            createdAt: Date.now(),
        });

        await ctx.db.patch(args.id, {
            imageStorageId: args.imageStorageId,
            imagePrompt: args.imagePrompt,
            imageModel: args.imageModel,
            status: "regenerated",
            updatedAt: Date.now(),
        });
    },
});

// Update status after regeneration
export const updateRegenerated = mutation({
    args: {
        id: v.id("generated_posts"),
        caption: v.string(),
        reasoning: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.id);
        if (!post) {
            throw new Error("Generated post not found");
        }

        await ctx.db.patch(args.id, {
            caption: args.caption,
            reasoning: args.reasoning,
            status: "regenerated",
            updatedAt: Date.now(),
        });
    },
});

// Delete a generated post (hard delete - use softDelete for trash)
export const remove = mutation({
    args: {
        id: v.id("generated_posts"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.id);
        if (!post) {
            throw new Error("Generated post not found");
        }

        // If post has a project, verify user owns it
        if (post.projectId) {
            const project = await ctx.db.get(post.projectId);
            if (!project) {
                throw new Error("Project not found");
            }

            const user = await ctx.db
                .query("users")
                .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
                .unique();

            if (!user || project.userId !== user._id) {
                throw new Error("Not authorized");
            }
        }
        // For standalone posts (no projectId), auth check above is sufficient

        // Delete associated generated images
        const images = await ctx.db
            .query("generated_images")
            .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", args.id))
            .collect();
        
        for (const img of images) {
            await ctx.db.delete(img._id);
        }

        // Delete associated history
        const history = await ctx.db
            .query("generation_history")
            .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", args.id))
            .collect();
        
        for (const h of history) {
            await ctx.db.delete(h._id);
        }

        // Delete associated chat messages
        const messages = await ctx.db
            .query("chat_messages")
            .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", args.id))
            .collect();
        
        for (const m of messages) {
            await ctx.db.delete(m._id);
        }

        const mediaLinks = await ctx.db
            .query("post_media_items")
            .withIndex("by_post", (q) => q.eq("postId", args.id))
            .collect();

        for (const link of mediaLinks) {
            await ctx.db.delete(link._id);
        }

        await ctx.db.delete(args.id);
    },
});

// ============================================================================
// Gallery & History Queries
// ============================================================================

type GalleryEntry = Doc<"generated_posts"> & {
    imageUrl: string | null;
    imageModel?: string;
    galleryImageId?: Id<"generated_images">;
};

async function buildGalleryEntries(
    ctx: QueryCtx,
    posts: Doc<"generated_posts">[]
): Promise<GalleryEntry[]> {
    // Fetch all images for each post in parallel
    const postImages = await Promise.all(
        posts.map((post) =>
            ctx.db
                .query("generated_images")
                .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", post._id))
                .collect()
        )
    );

    const imagesByPostId = new Map<Id<"generated_posts">, Doc<"generated_images">[]>();
    for (let i = 0; i < posts.length; i++) {
        const post = posts[i];
        const images = postImages[i];
        if (post) {
            imagesByPostId.set(post._id, images ?? []);
        }
    }

    // Resolve all storage URLs in one batch
    const storageIdsToResolve: Id<"_storage">[] = [];
    for (const post of posts) {
        if (post.imageStorageId) {
            storageIdsToResolve.push(post.imageStorageId);
        }
    }
    for (const images of postImages) {
        for (const image of images ?? []) {
            storageIdsToResolve.push(image.storageId);
        }
    }

    const uniqueStorageIds = Array.from(new Set(storageIdsToResolve));
    const storageUrls = await Promise.all(
        uniqueStorageIds.map((storageId) => ctx.storage.getUrl(storageId))
    );

    const urlByStorageId = new Map<Id<"_storage">, string | null>();
    for (let i = 0; i < uniqueStorageIds.length; i++) {
        const storageId = uniqueStorageIds[i];
        if (storageId !== undefined) {
            urlByStorageId.set(storageId, storageUrls[i] ?? null);
        }
    }

    // Build one gallery entry per image output; fallback to one entry for legacy posts
    const entries: GalleryEntry[] = [];
    for (const post of posts) {
        const images = imagesByPostId.get(post._id) ?? [];

        if (images.length > 0) {
            const sortedImages = [...images].sort((a, b) => b.createdAt - a.createdAt);
            for (const image of sortedImages) {
                entries.push({
                    ...post,
                    imageUrl: urlByStorageId.get(image.storageId) ?? null,
                    imageModel: image.model,
                    galleryImageId: image._id,
                });
            }
            continue;
        }

        entries.push({
            ...post,
            imageUrl: post.imageStorageId
                ? (urlByStorageId.get(post.imageStorageId) ?? null)
                : null,
            ...(post.imageModel && { imageModel: post.imageModel }),
        });
    }

    return entries;
}

// List all posts for current user (not deleted) with cursor-based pagination
export const listByUser = query({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return { posts: [], nextCursor: null, hasMore: false };
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            return { posts: [], nextCursor: null, hasMore: false };
        }

        const limit = args.limit ?? 30;

        // Single paginated query using by_user_created index
        const result = await ctx.db
            .query("generated_posts")
            .withIndex("by_user_created", (q) => q.eq("userId", user._id))
            .order("desc")
            .paginate({ cursor: args.cursor ?? null, numItems: limit });

        // Filter out deleted posts
        const allPosts = result.page.filter((post) => !post.deletedAt);

        // Only fetch first images for posts WITHOUT imageStorageId
        const postsNeedingFirstImage = allPosts.filter((p) => !p.imageStorageId);
        const postIdsNeedingImage = postsNeedingFirstImage.map((p) => p._id);

        const allFirstImages = await Promise.all(
            postIdsNeedingImage.map((postId) =>
                ctx.db
                    .query("generated_images")
                    .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", postId))
                    .first()
            )
        );

        // Create lookup map only for posts that needed it
        const firstImageByPostId = new Map<Id<"generated_posts">, NonNullable<(typeof allFirstImages)[0]>>();
        for (let i = 0; i < postIdsNeedingImage.length; i++) {
            const postId = postIdsNeedingImage[i];
            const img = allFirstImages[i];
            if (postId && img) {
                firstImageByPostId.set(postId, img);
            }
        }

        // Collect all storage IDs to resolve in one batch
        const storageIdsToResolve: Id<"_storage">[] = [];
        for (const post of allPosts) {
            if (post.imageStorageId) storageIdsToResolve.push(post.imageStorageId);
        }
        for (const img of allFirstImages) {
            if (img) storageIdsToResolve.push(img.storageId);
        }

        // Batch resolve all storage URLs at once
        const storageUrls = await Promise.all(
            storageIdsToResolve.map((id) => ctx.storage.getUrl(id))
        );

        // Create URL lookup map
        const urlByStorageId = new Map<string, string | null>();
        for (let i = 0; i < storageIdsToResolve.length; i++) {
            const storageId = storageIdsToResolve[i];
            const url = storageUrls[i];
            if (storageId !== undefined) {
                urlByStorageId.set(storageId, url ?? null);
            }
        }

        // Map posts with resolved data (no async needed)
        const posts = allPosts.map((post) => {
            const firstImage = firstImageByPostId.get(post._id);
            const postImageUrl = post.imageStorageId
                ? (urlByStorageId.get(post.imageStorageId) ?? null)
                : null;
            const firstImageUrl = firstImage
                ? (urlByStorageId.get(firstImage.storageId) ?? null)
                : null;
            const imageModel = post.imageModel ?? firstImage?.model;

            return {
                ...post,
                imageUrl: firstImageUrl ?? postImageUrl ?? null,
                ...(imageModel && { imageModel }),
            };
        });

        return {
            posts,
            nextCursor: result.continueCursor,
            hasMore: !result.isDone,
        };
    },
});

// List gallery entries for current user (one entry per generated image output)
export const listGalleryByUser = query({
    args: {
        cursor: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return { posts: [], nextCursor: null, hasMore: false };
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            return { posts: [], nextCursor: null, hasMore: false };
        }

        const limit = args.limit ?? 30;
        const result = await ctx.db
            .query("generated_posts")
            .withIndex("by_user_created", (q) => q.eq("userId", user._id))
            .order("desc")
            .paginate({ cursor: args.cursor ?? null, numItems: limit });

        const visiblePosts = result.page.filter((post) => !post.deletedAt);
        const posts = await buildGalleryEntries(ctx, visiblePosts);

        return {
            posts,
            nextCursor: result.continueCursor,
            hasMore: !result.isDone,
        };
    },
});

// List gallery entries for a single project (one entry per generated image output)
export const listGalleryByProject = query({
    args: {
        projectId: v.id("projects"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const project = await ctx.db.get(args.projectId);
        if (!project) {
            return [];
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user || project.userId !== user._id) {
            return [];
        }

        const posts = await ctx.db
            .query("generated_posts")
            .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
            .order("desc")
            .collect();

        return buildGalleryEntries(
            ctx,
            posts.filter((post) => !post.deletedAt)
        );
    },
});

// Get post with all images and history
export const getWithHistory = query({
    args: {
        id: v.id("generated_posts"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return null;
        }

        const post = await ctx.db.get(args.id);
        if (!post) {
            return null;
        }

        // Verify user has access
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            return null;
        }

        // Check ownership via userId or projectId
        let hasAccess = post.userId === user._id;
        if (!hasAccess && post.projectId) {
            const project = await ctx.db.get(post.projectId);
            hasAccess = project?.userId === user._id;
        }

        if (!hasAccess) {
            return null;
        }

        // Fetch images and messages in parallel
        const [images, messages] = await Promise.all([
            ctx.db
                .query("generated_images")
                .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", args.id))
                .collect(),
            ctx.db
                .query("chat_messages")
                .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", args.id))
                .order("asc")
                .collect(),
        ]);

        // Collect all storage IDs to resolve in one batch
        const storageIds: Id<"_storage">[] = images.map((img) => img.storageId);
        if (post.imageStorageId) {
            storageIds.push(post.imageStorageId);
        }

        // Batch resolve all storage URLs
        const urls = await Promise.all(storageIds.map((id) => ctx.storage.getUrl(id)));

        // Build URL lookup map
        const urlByStorageId = new Map<Id<"_storage">, string | null>();
        for (let i = 0; i < storageIds.length; i++) {
            const storageId = storageIds[i];
            if (storageId !== undefined) {
                urlByStorageId.set(storageId, urls[i] ?? null);
            }
        }

        // Map images with URLs
        const imagesWithUrls = images.map((img) => ({
            ...img,
            url: urlByStorageId.get(img.storageId) ?? null,
        }));

        return {
            ...post,
            imageUrl: post.imageStorageId ? urlByStorageId.get(post.imageStorageId) ?? null : null,
            images: imagesWithUrls,
            messages,
        };
    },
});

// Soft delete (move to trash)
export const softDelete = mutation({
    args: {
        id: v.id("generated_posts"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.id);
        if (!post) {
            throw new Error("Generated post not found");
        }

        // Verify user has access
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        // Check ownership
        let hasAccess = post.userId === user._id;
        if (!hasAccess && post.projectId) {
            const project = await ctx.db.get(post.projectId);
            hasAccess = project?.userId === user._id;
        }

        if (!hasAccess) {
            throw new Error("Not authorized");
        }

        await ctx.db.patch(args.id, {
            deletedAt: Date.now(),
            updatedAt: Date.now(),
        });
    },
});

// Restore from trash
export const restore = mutation({
    args: {
        id: v.id("generated_posts"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.id);
        if (!post) {
            throw new Error("Generated post not found");
        }

        // Verify user has access
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        // Check ownership
        let hasAccess = post.userId === user._id;
        if (!hasAccess && post.projectId) {
            const project = await ctx.db.get(post.projectId);
            hasAccess = project?.userId === user._id;
        }

        if (!hasAccess) {
            throw new Error("Not authorized");
        }

        await ctx.db.patch(args.id, {
            deletedAt: undefined,
            updatedAt: Date.now(),
        });
    },
});

// List deleted posts (trash)
export const listDeleted = query({
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

        // Get deleted posts by userId
        const standalonePosts = await ctx.db
            .query("generated_posts")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        // Get deleted posts via projects
        const userProjects = await ctx.db
            .query("projects")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        const projectPostsPromises = userProjects.map((project) =>
            ctx.db
                .query("generated_posts")
                .withIndex("by_project_id", (q) => q.eq("projectId", project._id))
                .collect()
        );
        const projectPostsArrays = await Promise.all(projectPostsPromises);
        const projectPosts = projectPostsArrays.flat();

        // Filter only deleted, sort by deletedAt desc
        const deletedPosts = [...standalonePosts, ...projectPosts]
            .filter((post) => post.deletedAt)
            .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));

        // Resolve image URLs
        return Promise.all(
            deletedPosts.map(async (post) => {
                let imageUrl: string | null = null;
                if (post.imageStorageId) {
                    imageUrl = await ctx.storage.getUrl(post.imageStorageId);
                }

                // Get first generated image
                const images = await ctx.db
                    .query("generated_images")
                    .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", post._id))
                    .take(1);
                
                let firstImageUrl: string | null = null;
                const firstImage = images[0];
                if (firstImage) {
                    firstImageUrl = await ctx.storage.getUrl(firstImage.storageId);
                }

                return {
                    ...post,
                    imageUrl: firstImageUrl ?? imageUrl,
                };
            })
        );
    },
});

// Permanent delete from trash
export const permanentDelete = mutation({
    args: {
        id: v.id("generated_posts"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.id);
        if (!post) {
            throw new Error("Generated post not found");
        }

        // Must be soft-deleted first
        if (!post.deletedAt) {
            throw new Error("Post must be in trash to permanently delete");
        }

        // Verify user has access
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        // Check ownership
        let hasAccess = post.userId === user._id;
        if (!hasAccess && post.projectId) {
            const project = await ctx.db.get(post.projectId);
            hasAccess = project?.userId === user._id;
        }

        if (!hasAccess) {
            throw new Error("Not authorized");
        }

        // Delete all associated data
        const images = await ctx.db
            .query("generated_images")
            .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", args.id))
            .collect();
        
        for (const img of images) {
            await ctx.storage.delete(img.storageId);
            await ctx.db.delete(img._id);
        }

        const history = await ctx.db
            .query("generation_history")
            .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", args.id))
            .collect();
        
        for (const h of history) {
            if (h.imageStorageId) {
                await ctx.storage.delete(h.imageStorageId);
            }
            await ctx.db.delete(h._id);
        }

        const messages = await ctx.db
            .query("chat_messages")
            .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", args.id))
            .collect();
        
        for (const m of messages) {
            await ctx.db.delete(m._id);
        }

        const mediaLinks = await ctx.db
            .query("post_media_items")
            .withIndex("by_post", (q) => q.eq("postId", args.id))
            .collect();

        for (const link of mediaLinks) {
            await ctx.db.delete(link._id);
        }

        // Delete main image storage
        if (post.imageStorageId) {
            await ctx.storage.delete(post.imageStorageId);
        }

        await ctx.db.delete(args.id);
    },
});

// Search posts by prompt
export const search = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
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

        const searchTerm = args.query.toLowerCase();
        const limit = args.limit ?? 20;

        const scanLimit = Math.max(limit * 12, 120);
        const perProjectLimit = Math.max(limit * 4, 30);

        const standalonePosts = await ctx.db
            .query("generated_posts")
            .withIndex("by_user_created", (q) => q.eq("userId", user._id))
            .order("desc")
            .take(scanLimit);

        const userProjects = await ctx.db
            .query("projects")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        const projectPostsPromises = userProjects.map((project) =>
            ctx.db
                .query("generated_posts")
                .withIndex("by_project_id", (q) => q.eq("projectId", project._id))
                .order("desc")
                .take(perProjectLimit)
        );
        const projectPostsArrays = await Promise.all(projectPostsPromises);
        const projectPosts = projectPostsArrays.flat();

        const uniquePosts = new Map<Id<"generated_posts">, Doc<"generated_posts">>();
        for (const post of [...standalonePosts, ...projectPosts]) {
            uniquePosts.set(post._id, post);
        }

        // Filter by search term in caption or imagePrompt, exclude deleted
        const allPosts = [...uniquePosts.values()]
            .filter((post) => !post.deletedAt)
            .filter((post) => {
                const captionMatch = post.caption?.toLowerCase().includes(searchTerm);
                const promptMatch = post.imagePrompt?.toLowerCase().includes(searchTerm);
                return captionMatch || promptMatch;
            })
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit);

        // Resolve image URLs
        return Promise.all(
            allPosts.map(async (post) => {
                const images = await ctx.db
                    .query("generated_images")
                    .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", post._id))
                    .take(1);

                let imageUrl: string | null = null;
                const firstImage = images[0];
                if (firstImage) {
                    imageUrl = await ctx.storage.getUrl(firstImage.storageId);
                } else if (post.imageStorageId) {
                    imageUrl = await ctx.storage.getUrl(post.imageStorageId);
                }

                return {
                    ...post,
                    imageUrl,
                };
            })
        );
    },
});

// Search gallery entries (one entry per generated image output)
export const searchGallery = query({
    args: {
        query: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
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

        const searchTerm = args.query.toLowerCase();
        const limit = args.limit ?? 20;

        const scanLimit = Math.max(limit * 12, 120);
        const perProjectLimit = Math.max(limit * 4, 30);

        const standalonePosts = await ctx.db
            .query("generated_posts")
            .withIndex("by_user_created", (q) => q.eq("userId", user._id))
            .order("desc")
            .take(scanLimit);

        const userProjects = await ctx.db
            .query("projects")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        const projectPostsArrays = await Promise.all(
            userProjects.map((project) =>
                ctx.db
                    .query("generated_posts")
                    .withIndex("by_project_id", (q) => q.eq("projectId", project._id))
                    .order("desc")
                    .take(perProjectLimit)
            )
        );
        const projectPosts = projectPostsArrays.flat();

        // Deduplicate by post ID because many project posts also have userId populated.
        const uniquePosts = new Map<Id<"generated_posts">, Doc<"generated_posts">>();
        for (const post of [...standalonePosts, ...projectPosts]) {
            uniquePosts.set(post._id, post);
        }

        const matchedPosts = [...uniquePosts.values()]
            .filter((post) => !post.deletedAt)
            .filter((post) => {
                const captionMatch = post.caption?.toLowerCase().includes(searchTerm);
                const promptMatch = post.imagePrompt?.toLowerCase().includes(searchTerm);
                return captionMatch || promptMatch;
            })
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit);

        return buildGalleryEntries(ctx, matchedPosts);
    },
});

// ============================================================================
// Migration: Backfill userId on posts that only have projectId
// ============================================================================

// Internal mutation to backfill userId on posts that only have projectId
export const backfillUserIdOnPosts = internalMutation({
    args: {
        batchSize: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const batchSize = args.batchSize ?? 100;

        // Get posts that have projectId but no userId
        const postsToFix = await ctx.db
            .query("generated_posts")
            .filter((q) => q.eq(q.field("userId"), undefined))
            .take(batchSize);

        let fixed = 0;
        let skipped = 0;

        for (const post of postsToFix) {
            if (!post.projectId) {
                // Post has neither projectId nor userId - skip
                skipped++;
                continue;
            }

            const project = await ctx.db.get(post.projectId);
            if (!project) {
                // Project not found - skip
                skipped++;
                continue;
            }

            // Set userId from project owner
            await ctx.db.patch(post._id, {
                userId: project.userId,
            });
            fixed++;
        }

        return {
            fixed,
            skipped,
            hasMore: postsToFix.length === batchSize,
        };
    },
});
