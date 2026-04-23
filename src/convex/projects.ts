import { v } from "convex/values";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
    compileBrandContextMarkdown,
    mergeBrandKit,
    mergeBrandKitFillEmpty,
} from "./brandContextCompile";
import {
    brandKitValidator,
    onboardingPathValidator,
    onboardingStatusValidator,
} from "./brandKitShape";
import { instagramContentDigestValidator } from "./instagramDigestShape";
import { launchPostsGenerationValidator } from "../lib/convex/launchPostsShape";
import type { InstagramConnectionPublic } from "./instagramGraph";

// Type for project with storage URL
type ProjectWithStorageUrl = Doc<"projects"> & {
    profilePictureStorageUrl: string | null;
    logoStorageUrl: string | null;
    instagramConnection: InstagramConnectionPublic | null;
};

type ProjectSummary = ProjectWithStorageUrl & {
    postCount: number;
    mediaCount: number;
};

async function getCurrentUser(ctx: QueryCtx, clerkId: string) {
    return ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
        .unique();
}

function brandCompileFromDoc(project: Doc<"projects">): string {
    return compileBrandContextMarkdown({
        name: project.name,
        ...(project.brandKit ? { brandKit: project.brandKit } : {}),
        ...(project.accountDescription?.trim()
            ? { accountDescription: project.accountDescription }
            : {}),
        ...(project.brandTraits?.length ? { brandTraits: project.brandTraits } : {}),
        ...(project.additionalContext?.trim()
            ? { additionalContext: project.additionalContext }
            : {}),
    });
}

async function resolveProjectsWithUrls(
    ctx: QueryCtx,
    projects: Doc<"projects">[]
): Promise<ProjectWithStorageUrl[]> {
    const [profileUrls, logoUrls, instagramConnections] = await Promise.all([
        Promise.all(
            projects.map((project) =>
                project.profilePictureStorageId
                    ? ctx.storage.getUrl(project.profilePictureStorageId)
                    : Promise.resolve(null)
            )
        ),
        Promise.all(
            projects.map((project) =>
                project.brandKit?.logoStorageId
                    ? ctx.storage.getUrl(project.brandKit.logoStorageId)
                    : Promise.resolve(null)
            )
        ),
        Promise.all(projects.map((project) => resolveInstagramConnection(ctx, project._id))),
    ]);

    return projects.map((project, index) => ({
        ...project,
        profilePictureStorageUrl: profileUrls[index] ?? null,
        logoStorageUrl: logoUrls[index] ?? null,
        instagramConnection: instagramConnections[index] ?? null,
    }));
}

async function resolveInstagramConnection(
    ctx: QueryCtx,
    projectId: Doc<"projects">["_id"]
): Promise<InstagramConnectionPublic | null> {
    const doc = await ctx.db
        .query("social_connections")
        .withIndex("by_project_platform", (q) =>
            q.eq("projectId", projectId).eq("platform", "instagram")
        )
        .first();
    if (!doc) return null;
    return {
        _id: doc._id,
        platform: doc.platform,
        provider: doc.provider,
        status: doc.status,
        externalAccountId: doc.externalAccountId,
        lastConnectedAt: doc.lastConnectedAt,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        ...(doc.projectId ? { projectId: doc.projectId } : {}),
        ...(doc.externalAccountName ? { externalAccountName: doc.externalAccountName } : {}),
        ...(doc.handle ? { handle: doc.handle } : {}),
        ...(doc.pageId ? { pageId: doc.pageId } : {}),
        ...(doc.pageName ? { pageName: doc.pageName } : {}),
        ...(doc.scopes ? { scopes: doc.scopes } : {}),
        ...(doc.tokenExpiresAt ? { tokenExpiresAt: doc.tokenExpiresAt } : {}),
        ...(doc.lastSyncAt ? { lastSyncAt: doc.lastSyncAt } : {}),
        ...(doc.lastError ? { lastError: doc.lastError } : {}),
    };
}

export const create = mutation({
    args: {
        name: v.string(),
        instagramUrl: v.optional(v.string()),
        brandKit: v.optional(brandKitValidator),
        onboardingPath: v.optional(onboardingPathValidator),
        onboardingStatus: v.optional(onboardingStatusValidator),
        accountDescription: v.optional(v.string()),
        brandTraits: v.optional(v.array(v.string())),
        additionalContext: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Called create project without authentication present");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        const trimmedName = args.name.trim();
        const trimmedIg = args.instagramUrl?.trim();
        const hasInstagram = Boolean(trimmedIg);

        const brandKit = args.brandKit ? { ...args.brandKit } : undefined;
        const brandContextMarkdown = compileBrandContextMarkdown({
            name: trimmedName,
            ...(brandKit ? { brandKit } : {}),
            ...(args.accountDescription?.trim()
                ? { accountDescription: args.accountDescription.trim() }
                : {}),
            ...(args.brandTraits?.length ? { brandTraits: args.brandTraits } : {}),
            ...(args.additionalContext?.trim()
                ? { additionalContext: args.additionalContext.trim() }
                : {}),
        });

        const insertFields: Record<string, unknown> = {
            userId: user._id,
            name: trimmedName,
            isFetching: hasInstagram,
            createdAt: Date.now(),
            onboardingStatus: args.onboardingStatus ?? "complete",
        };
        if (hasInstagram && trimmedIg) {
            insertFields.instagramUrl = trimmedIg;
        }
        if (brandKit) {
            insertFields.brandKit = brandKit;
        }
        if (args.onboardingPath !== undefined) {
            insertFields.onboardingPath = args.onboardingPath;
        }
        const ad = args.accountDescription?.trim();
        if (ad) {
            insertFields.accountDescription = ad;
        }
        if (args.brandTraits !== undefined && args.brandTraits.length > 0) {
            insertFields.brandTraits = args.brandTraits;
        }
        const ac = args.additionalContext?.trim();
        if (ac) {
            insertFields.additionalContext = ac;
        }
        if (brandContextMarkdown) {
            insertFields.brandContextMarkdown = brandContextMarkdown;
        }

        /* eslint-disable @typescript-eslint/no-explicit-any -- dynamic optional fields for insert */
        const projectId = await ctx.db.insert("projects", insertFields as any);

        return projectId;
    },
});

export const list = query({
    args: {},
    handler: async (ctx): Promise<ProjectWithStorageUrl[]> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const user = await getCurrentUser(ctx, identity.subject);

        if (!user) {
            return [];
        }

        const projects = await ctx.db
            .query("projects")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        return resolveProjectsWithUrls(ctx, projects);
    },
});

export const listSummaries = query({
    args: {},
    handler: async (ctx): Promise<ProjectSummary[]> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const user = await getCurrentUser(ctx, identity.subject);

        if (!user) {
            return [];
        }

        const projects = await ctx.db
            .query("projects")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        const projectsWithUrls = await resolveProjectsWithUrls(ctx, projects);
        const counts = await Promise.all(
            projects.map(async (project) => {
                const [posts, mediaItems] = await Promise.all([
                    ctx.db
                        .query("generated_posts")
                        .withIndex("by_project_id", (q) => q.eq("projectId", project._id))
                        .collect(),
                    ctx.db
                        .query("media_items")
                        .withIndex("by_project_id", (q) => q.eq("projectId", project._id))
                        .collect(),
                ]);

                return {
                    postCount: posts.filter((post) => !post.deletedAt).length,
                    mediaCount: mediaItems.filter((item) => !item.deletedAt).length,
                };
            })
        );

        return projectsWithUrls.map((project, index) => ({
            ...project,
            postCount: counts[index]?.postCount ?? 0,
            mediaCount: counts[index]?.mediaCount ?? 0,
        }));
    },
});

export const updateProfileData = mutation({
    args: {
        projectId: v.id("projects"),
        instagramHandle: v.optional(v.string()),
        profilePictureUrl: v.optional(v.string()),
        bio: v.optional(v.string()),
        followersCount: v.optional(v.number()),
        followingCount: v.optional(v.number()),
        postsCount: v.optional(v.number()),
        website: v.optional(v.string()),
        isFetching: v.optional(v.boolean()),
        lastInstagramSyncAt: v.optional(v.number()),
        lastInstagramSyncMode: v.optional(v.union(v.literal("intel_only"), v.literal("full"))),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Called updateProfileData without authentication");
        }

        const project = await ctx.db.get(args.projectId);
        if (!project) {
            throw new Error("Project not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user || project.userId !== user._id) {
            throw new Error("Not authorized to update this project");
        }

        const patch: Record<string, unknown> = {};
        if (args.instagramHandle !== undefined) patch.instagramHandle = args.instagramHandle;
        if (args.profilePictureUrl !== undefined) patch.profilePictureUrl = args.profilePictureUrl;
        if (args.bio !== undefined) patch.bio = args.bio;
        if (args.followersCount !== undefined) patch.followersCount = args.followersCount;
        if (args.followingCount !== undefined) patch.followingCount = args.followingCount;
        if (args.postsCount !== undefined) patch.postsCount = args.postsCount;
        if (args.website !== undefined) patch.website = args.website;
        if (args.isFetching !== undefined) patch.isFetching = args.isFetching;
        if (args.lastInstagramSyncAt !== undefined) patch.lastInstagramSyncAt = args.lastInstagramSyncAt;
        if (args.lastInstagramSyncMode !== undefined) patch.lastInstagramSyncMode = args.lastInstagramSyncMode;

        if (Object.keys(patch).length === 0) {
            return project;
        }

        await ctx.db.patch(args.projectId, patch);
        return await ctx.db.get(args.projectId);
    },
});

export const setInstagramContentDigestInternal = internalMutation({
    args: {
        projectId: v.id("projects"),
        digest: v.union(v.null(), instagramContentDigestValidator),
    },
    handler: async (ctx, args) => {
        if (args.digest === null) {
            await ctx.db.patch(args.projectId, { instagramContentDigest: undefined });
        } else {
            await ctx.db.patch(args.projectId, { instagramContentDigest: args.digest });
        }
    },
});

export const setLaunchPostsGenerationInternal = internalMutation({
    args: {
        projectId: v.id("projects"),
        state: v.union(v.null(), launchPostsGenerationValidator),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.projectId, {
            launchPostsGeneration: args.state ?? undefined,
        });
    },
});

export const get = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return null;
        }

        const project = await ctx.db.get(args.projectId);
        if (!project) return null;

        // Authorization check: Ensure the project belongs to the current user
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user || project.userId !== user._id) {
            return null;
        }

        // Get storage URL for profile picture if available
        let profilePictureStorageUrl: string | null = null;
        if (project.profilePictureStorageId) {
            profilePictureStorageUrl = await ctx.storage.getUrl(project.profilePictureStorageId);
        }

        let logoStorageUrl: string | null = null;
        if (project.brandKit?.logoStorageId) {
            logoStorageUrl = await ctx.storage.getUrl(project.brandKit.logoStorageId) ?? null;
        }

        return {
            ...project,
            profilePictureStorageUrl,
            logoStorageUrl,
            instagramConnection: await resolveInstagramConnection(ctx, args.projectId),
        };
    },
});

export const remove = mutation({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Called remove project without authentication");
        }

        const project = await ctx.db.get(args.projectId);
        if (!project) {
            throw new Error("Project not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user || project.userId !== user._id) {
            throw new Error("Not authorized to delete this project");
        }

        const contextImages = await ctx.db
            .query("context_images")
            .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
            .collect();
        for (const doc of contextImages) {
            await ctx.storage.delete(doc.storageId);
            await ctx.db.delete(doc._id);
        }

        if (project.brandKit?.logoStorageId) {
            try {
                await ctx.storage.delete(project.brandKit.logoStorageId);
            } catch {
                // ignore missing blob
            }
        }

        if (project.profilePictureStorageId) {
            try {
                await ctx.storage.delete(project.profilePictureStorageId);
            } catch {
                // ignore missing blob
            }
        }

        // Clean up related data when deleting a project
        const instagramPosts = await ctx.db
            .query("instagram_posts")
            .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
            .collect();
        for (const doc of instagramPosts) {
            await ctx.db.delete(doc._id);
        }

        const generatedPosts = await ctx.db
            .query("generated_posts")
            .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
            .collect();
        for (const doc of generatedPosts) {
            await ctx.db.delete(doc._id);
        }

        const referenceImages = await ctx.db
            .query("reference_images")
            .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
            .collect();
        for (const doc of referenceImages) {
            await ctx.db.delete(doc._id);
        }

        await ctx.db.delete(args.projectId);
    },
});

export const updateProfilePictureStorage = mutation({
    args: {
        projectId: v.id("projects"),
        storageId: v.id("_storage"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Called updateProfilePictureStorage without authentication");
        }

        const project = await ctx.db.get(args.projectId);
        if (!project) {
            throw new Error("Project not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user || project.userId !== user._id) {
            throw new Error("Not authorized to update this project");
        }

        await ctx.db.patch(args.projectId, {
            profilePictureStorageId: args.storageId,
        });
    },
});

export const update = mutation({
    args: {
        projectId: v.id("projects"),
        name: v.optional(v.string()),
        instagramUrl: v.optional(v.string()),
        // Brand context fields
        platform: v.optional(v.string()),
        accountDescription: v.optional(v.string()),
        brandTraits: v.optional(v.array(v.string())),
        additionalContext: v.optional(v.string()),
        brandKit: v.optional(brandKitValidator),
        /** merge = shallow merge; replace = use args.brandKit as full kit; fill_empty = only empty kit fields */
        brandKitStrategy: v.optional(
            v.union(v.literal("merge"), v.literal("replace"), v.literal("fill_empty"))
        ),
        onboardingStatus: v.optional(onboardingStatusValidator),
        onboardingPath: v.optional(onboardingPathValidator),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Called update project without authentication");
        }

        const project = await ctx.db.get(args.projectId);
        if (!project) {
            throw new Error("Project not found");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user || project.userId !== user._id) {
            throw new Error("Not authorized to update this project");
        }

        const patch: Record<string, unknown> = {};
        if (args.name !== undefined) patch.name = args.name.trim();
        if (args.instagramUrl !== undefined) {
            const t = args.instagramUrl.trim();
            patch.instagramUrl = t.length > 0 ? t : undefined;
        }
        if (args.platform !== undefined) patch.platform = args.platform;
        if (args.accountDescription !== undefined) patch.accountDescription = args.accountDescription;
        if (args.brandTraits !== undefined) patch.brandTraits = args.brandTraits;
        if (args.additionalContext !== undefined) patch.additionalContext = args.additionalContext;
        if (args.onboardingStatus !== undefined) patch.onboardingStatus = args.onboardingStatus;
        if (args.onboardingPath !== undefined) patch.onboardingPath = args.onboardingPath;

        if (args.brandKit !== undefined) {
            const strategy = args.brandKitStrategy ?? "merge";
            if (strategy === "replace") {
                patch.brandKit = args.brandKit;
            } else if (strategy === "fill_empty") {
                patch.brandKit = mergeBrandKitFillEmpty(project.brandKit ?? undefined, args.brandKit);
            } else {
                patch.brandKit = mergeBrandKit(project.brandKit ?? undefined, args.brandKit);
            }
        }

        if (Object.keys(patch).length === 0) {
            return await ctx.db.get(args.projectId);
        }

        await ctx.db.patch(args.projectId, patch as Partial<Doc<"projects">>);
        const updated = await ctx.db.get(args.projectId);
        if (!updated) {
            throw new Error("Project not found after update");
        }

        const markdown = brandCompileFromDoc(updated);
        await ctx.db.patch(args.projectId, {
            brandContextMarkdown: markdown.length > 0 ? markdown : undefined,
        });

        return await ctx.db.get(args.projectId);
    },
});
