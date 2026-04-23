import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export type InstagramConnectionPublic = Pick<
    Doc<"social_connections">,
    | "_id"
    | "projectId"
    | "platform"
    | "provider"
    | "status"
    | "externalAccountId"
    | "externalAccountName"
    | "handle"
    | "pageId"
    | "pageName"
    | "scopes"
    | "tokenExpiresAt"
    | "lastConnectedAt"
    | "lastSyncAt"
    | "lastError"
    | "createdAt"
    | "updatedAt"
>;

function publicConnection(doc: Doc<"social_connections">): InstagramConnectionPublic {
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

async function getUserByClerkId(ctx: QueryCtx | MutationCtx, clerkId: string) {
    return await ctx.db
        .query("users")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
        .unique();
}

export const listMine = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const user = await getUserByClerkId(ctx, identity.subject);
        if (!user) {
            return [];
        }

        const connections = await ctx.db
            .query("social_connections")
            .withIndex("by_user_platform", (q) => q.eq("userId", user._id).eq("platform", "instagram"))
            .collect();
        return connections.map(publicConnection);
    },
});

export const getForProject = query({
    args: {
        projectId: v.id("projects"),
    },
    handler: async (ctx, args): Promise<InstagramConnectionPublic | null> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return null;
        }

        const user = await getUserByClerkId(ctx, identity.subject);
        if (!user) {
            return null;
        }

        const project = await ctx.db.get(args.projectId);
        if (!project || project.userId !== user._id) {
            return null;
        }

        const connection = await ctx.db
            .query("social_connections")
            .withIndex("by_project_platform", (q) =>
                q.eq("projectId", args.projectId).eq("platform", "instagram")
            )
            .first();

        return connection ? publicConnection(connection) : null;
    },
});

export const attachToProject = mutation({
    args: {
        connectionId: v.id("social_connections"),
        projectId: v.id("projects"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Não autenticado");
        }

        const user = await getUserByClerkId(ctx, identity.subject);
        if (!user) {
            throw new Error("Usuário não encontrado");
        }

        const [connection, project] = await Promise.all([
            ctx.db.get(args.connectionId),
            ctx.db.get(args.projectId),
        ]);
        if (!connection || connection.userId !== user._id || connection.platform !== "instagram") {
            throw new Error("Conexão do Instagram não encontrada");
        }
        if (!project || project.userId !== user._id) {
            throw new Error("Projeto não encontrado");
        }

        await detachOtherProjectInstagramConnections(ctx, args.projectId, args.connectionId);
        await ctx.db.patch(args.connectionId, {
            projectId: args.projectId,
            updatedAt: Date.now(),
        });
        await patchProjectFromConnection(ctx, args.projectId, connection);

        const updated = await ctx.db.get(args.connectionId);
        return updated ? publicConnection(updated) : null;
    },
});

async function detachOtherProjectInstagramConnections(
    ctx: MutationCtx,
    projectId: Id<"projects">,
    keepConnectionId: Id<"social_connections">
) {
    const existingForProject = await ctx.db
        .query("social_connections")
        .withIndex("by_project_platform", (q) =>
            q.eq("projectId", projectId).eq("platform", "instagram")
        )
        .collect();

    for (const doc of existingForProject) {
        if (doc._id !== keepConnectionId) {
            await ctx.db.patch(doc._id, {
                projectId: undefined,
                updatedAt: Date.now(),
            });
        }
    }
}

async function patchProjectFromConnection(
    ctx: MutationCtx,
    projectId: Id<"projects">,
    connection: {
        handle?: string | undefined;
        postsCount?: number | undefined;
    }
) {
    const patch: Partial<Doc<"projects">> = {
        platform: "instagram",
    };
    if (connection.handle) {
        patch.instagramHandle = connection.handle;
        patch.instagramUrl = `https://www.instagram.com/${connection.handle}/`;
    }
    if (connection.postsCount !== undefined) {
        patch.postsCount = connection.postsCount;
    }

    await ctx.db.patch(projectId, patch);
}

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
        projectId: v.optional(v.id("projects")),
        postsCount: v.optional(v.number()),
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
            ...(args.projectId ? { projectId: args.projectId } : {}),
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
            if (args.projectId) {
                const project = await ctx.db.get(args.projectId);
                if (!project || project.userId !== user._id) {
                    throw new Error("Projeto não encontrado");
                }
                await detachOtherProjectInstagramConnections(ctx, args.projectId, existing._id);
            }
            await ctx.db.patch(existing._id, patch);
            if (args.projectId) {
                await patchProjectFromConnection(ctx, args.projectId, {
                    handle: args.handle,
                    postsCount: args.postsCount,
                });
            }
            return {
                _id: existing._id,
                externalAccountId: args.externalAccountId,
                ...(args.handle ? { handle: args.handle } : {}),
                ...(args.pageName ? { pageName: args.pageName } : {}),
            };
        }

        if (args.projectId) {
            const project = await ctx.db.get(args.projectId);
            if (!project || project.userId !== user._id) {
                throw new Error("Projeto não encontrado");
            }
        }

        const id = await ctx.db.insert("social_connections", {
            ...patch,
            createdAt: now,
        });

        if (args.projectId) {
            await detachOtherProjectInstagramConnections(ctx, args.projectId, id);
            await patchProjectFromConnection(ctx, args.projectId, {
                handle: args.handle,
                postsCount: args.postsCount,
            });
        }

        return {
            _id: id,
            externalAccountId: args.externalAccountId,
            ...(args.handle ? { handle: args.handle } : {}),
            ...(args.pageName ? { pageName: args.pageName } : {}),
        };
    },
});
