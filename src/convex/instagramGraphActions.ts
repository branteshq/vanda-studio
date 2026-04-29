'use node';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const GRAPH_VERSION = "v23.0";
const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;
const MEDIA_INSIGHT_METRICS = ["reach", "impressions", "saved", "shares", "total_interactions"] as const;
const ACCOUNT_INSIGHT_METRICS = ["reach", "profile_views"] as const;

type MetaError = {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
};

type MetaTokenResponse = {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    user_id?: number;
    error?: MetaError;
};

type MetaInstagramProfileResponse = {
    id: string;
    username?: string;
    name?: string;
    account_type?: string;
    media_count?: number;
    followers_count?: number;
    follows_count?: number;
    profile_picture_url?: string;
    error?: MetaError;
};

type MetaPagingResponse<T> = {
    data?: T[];
    paging?: {
        next?: string;
    };
    error?: MetaError;
};

type MetaMediaChild = {
    id: string;
    media_type?: string;
    media_url?: string;
    thumbnail_url?: string;
    permalink?: string;
    timestamp?: string;
};

type MetaMedia = MetaMediaChild & {
    caption?: string;
    media_product_type?: string;
    like_count?: number;
    comments_count?: number;
    children?: {
        data?: MetaMediaChild[];
    };
};

type MetaCreateMediaResponse = {
    id: string;
    error?: MetaError;
};

type MetaPublishMediaResponse = {
    id: string;
    error?: MetaError;
};

type MetaInsightValue = {
    value?: number;
};

type MetaInsight = {
    name?: string;
    values?: MetaInsightValue[];
};

type ImportedSocialPost = {
    externalPostId: string;
    caption?: string;
    mediaType: string;
    mediaProductType?: string;
    mediaUrl?: string;
    thumbnailUrl?: string;
    permalink: string;
    publishedAt: number;
    likeCount?: number;
    commentsCount?: number;
    reach?: number;
    impressions?: number;
    saved?: number;
    shares?: number;
    totalInteractions?: number;
    engagementScore?: number;
    children?: {
        externalPostId: string;
        mediaType: string;
        mediaUrl?: string;
        thumbnailUrl?: string;
        permalink?: string;
    }[];
};

type InstagramPublishJob = {
    postId: Id<"generated_posts">;
    userId: Id<"users">;
    projectId: Id<"projects">;
    connectionId: Id<"social_connections">;
    externalAccountId: string;
    caption: string;
    imageUrl: string | null;
    tokenCiphertext: string;
    tokenIv: string;
    tokenAuthTag: string;
};

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing ${name}`);
    }
    return value;
}

function requireFirstEnv(names: string[]): string {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) {
            return value;
        }
    }
    throw new Error(`Missing ${names.join(" or ")}`);
}

function encodeBase64Url(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
    return Buffer.from(value, "base64url").toString("utf8");
}

function buildStatePayload(clerkId: string, projectId?: Id<"projects">): string {
    const nonce = randomBytes(18).toString("base64url");
    return encodeBase64Url(JSON.stringify({
        clerkId,
        ...(projectId ? { projectId } : {}),
        nonce,
        createdAt: Date.now(),
    }));
}

function parseStatePayload(state: string): {
    clerkId: string;
    createdAt: number;
    projectId?: Id<"projects">;
} {
    try {
        const parsed = JSON.parse(decodeBase64Url(state)) as {
            clerkId?: unknown;
            createdAt?: unknown;
            projectId?: unknown;
        };
        if (typeof parsed.clerkId !== "string" || typeof parsed.createdAt !== "number") {
            throw new Error("Invalid Instagram state");
        }
        return {
            clerkId: parsed.clerkId,
            createdAt: parsed.createdAt,
            ...(typeof parsed.projectId === "string"
                ? { projectId: parsed.projectId as Id<"projects"> }
                : {}),
        };
    } catch {
        throw new Error("Invalid Instagram state");
    }
}

function encryptToken(token: string): {
    tokenCiphertext: string;
    tokenIv: string;
    tokenAuthTag: string;
} {
    const keyMaterial = requireEnv("INSTAGRAM_TOKEN_ENCRYPTION_KEY");
    const key = createHash("sha256").update(keyMaterial).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);

    return {
        tokenCiphertext: encrypted.toString("base64"),
        tokenIv: iv.toString("base64"),
        tokenAuthTag: cipher.getAuthTag().toString("base64"),
    };
}

function decryptToken(args: {
    tokenCiphertext: string;
    tokenIv: string;
    tokenAuthTag: string;
}): string {
    const keyMaterial = requireEnv("INSTAGRAM_TOKEN_ENCRYPTION_KEY");
    const key = createHash("sha256").update(keyMaterial).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(args.tokenIv, "base64"));
    decipher.setAuthTag(Buffer.from(args.tokenAuthTag, "base64"));
    return Buffer.concat([
        decipher.update(Buffer.from(args.tokenCiphertext, "base64")),
        decipher.final(),
    ]).toString("utf8");
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const data = await response.json() as T;

    if (!response.ok || (data as { error?: MetaError }).error) {
        const error = (data as { error?: MetaError }).error;
        const message = error?.message ?? `Meta API request failed with ${response.status}`;
        const details = error
            ? ` (${JSON.stringify({
                type: error.type,
                code: error.code,
                error_subcode: error.error_subcode,
            })})`
            : "";
        throw new Error(`${message}${details}`);
    }

    return data;
}

export const getConnectUrl = action({
    args: {
        redirectUri: v.string(),
        projectId: v.optional(v.id("projects")),
    },
    handler: async (ctx, args): Promise<{ url: string }> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Não autenticado");
        }

        const clientId = requireFirstEnv(["INSTAGRAM_APP_ID", "META_APP_ID"]);
        const state = buildStatePayload(identity.subject, args.projectId);
        const scope = [
            "instagram_business_basic",
            "instagram_business_content_publish",
            "instagram_business_manage_comments",
            "instagram_business_manage_insights",
        ].join(",");

        const url = new URL("https://www.instagram.com/oauth/authorize");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", args.redirectUri);
        url.searchParams.set("state", state);
        url.searchParams.set("scope", scope);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("enable_fb_login", "0");
        url.searchParams.set("force_authentication", "1");

        return { url: url.toString() };
    },
});

export const completeOAuth = action({
    args: {
        code: v.string(),
        state: v.string(),
        redirectUri: v.string(),
    },
    handler: async (ctx, args): Promise<{
        connected: boolean;
        handle?: string;
        pageName?: string;
        externalAccountId: string;
        projectId?: Id<"projects">;
    }> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Não autenticado");
        }

        const parsedState = parseStatePayload(args.state);
        if (parsedState.clerkId !== identity.subject) {
            throw new Error("Sessão de conexão do Instagram inválida");
        }
        if (Date.now() - parsedState.createdAt > 15 * 60 * 1000) {
            throw new Error("Sessão de conexão do Instagram expirada");
        }

        const clientId = requireFirstEnv(["INSTAGRAM_APP_ID", "META_APP_ID"]);
        const clientSecret = requireFirstEnv(["INSTAGRAM_APP_SECRET", "META_APP_SECRET"]);

        const shortToken = await fetchJson<MetaTokenResponse>(
            "https://api.instagram.com/oauth/access_token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: "authorization_code",
                    redirect_uri: args.redirectUri,
                    code: args.code,
                }),
            }
        );
        if (!shortToken.access_token || !shortToken.user_id) {
            throw new Error("Instagram não retornou token de acesso");
        }

        const longToken = await fetchJson<MetaTokenResponse>(
            "https://graph.instagram.com/access_token?" + new URLSearchParams({
                grant_type: "ig_exchange_token",
                client_id: clientId,
                client_secret: clientSecret,
                access_token: shortToken.access_token,
            })
        );
        const userAccessToken = longToken.access_token ?? shortToken.access_token;
        const tokenExpiresAt = longToken.expires_in
            ? Date.now() + longToken.expires_in * 1000
            : undefined;

        const profile = await fetchJson<MetaInstagramProfileResponse>(
            `${INSTAGRAM_GRAPH_BASE}/me?` + new URLSearchParams({
                fields: "id,username,name,account_type,media_count",
                access_token: userAccessToken,
            })
        );

        const externalAccountId = profile.id || String(shortToken.user_id);
        const encrypted = encryptToken(userAccessToken);
        const connectionArgs = {
            clerkId: identity.subject,
            platform: "instagram",
            provider: "instagram_graph",
            status: "connected",
            externalAccountId,
            scopes: [
                "instagram_business_basic",
                "instagram_business_content_publish",
            ],
            ...encrypted,
            ...(profile.name
                ? { externalAccountName: profile.name }
                : {}),
            ...(profile.username
                ? { handle: profile.username }
                : {}),
            ...(parsedState.projectId ? { projectId: parsedState.projectId } : {}),
            ...(profile.media_count !== undefined ? { postsCount: profile.media_count } : {}),
            ...(tokenExpiresAt ? { tokenExpiresAt } : {}),
        };
        const user = await ctx.runMutation(internal.instagramGraph.upsertConnectionInternal, connectionArgs);

        return {
            connected: true,
            externalAccountId: user.externalAccountId,
            ...(parsedState.projectId ? { projectId: parsedState.projectId } : {}),
            ...(user.handle ? { handle: user.handle } : {}),
            ...(user.pageName ? { pageName: user.pageName } : {}),
        };
    },
});

async function fetchInstagramProfile(accessToken: string): Promise<MetaInstagramProfileResponse> {
    const baseParams = {
        access_token: accessToken,
    };

    try {
        return await fetchJson<MetaInstagramProfileResponse>(
            `${INSTAGRAM_GRAPH_BASE}/me?` + new URLSearchParams({
                fields: "id,username,name,account_type,media_count,followers_count,follows_count,profile_picture_url",
                ...baseParams,
            })
        );
    } catch (error) {
        console.warn("[instagramGraph] profile extended fields failed; retrying basic profile", error);
        return await fetchJson<MetaInstagramProfileResponse>(
            `${INSTAGRAM_GRAPH_BASE}/me?` + new URLSearchParams({
                fields: "id,username,name,account_type,media_count",
                ...baseParams,
            })
        );
    }
}

async function fetchInstagramMedia(accessToken: string, limit: number): Promise<MetaMedia[]> {
    const params = new URLSearchParams({
        fields: [
            "id",
            "caption",
            "media_type",
            "media_product_type",
            "media_url",
            "thumbnail_url",
            "permalink",
            "timestamp",
            "like_count",
            "comments_count",
            "children{id,media_type,media_url,thumbnail_url,permalink,timestamp}",
        ].join(","),
        limit: String(limit),
        access_token: accessToken,
    });

    try {
        const response = await fetchJson<MetaPagingResponse<MetaMedia>>(
            `${INSTAGRAM_GRAPH_BASE}/me/media?${params}`
        );
        return response.data ?? [];
    } catch (error) {
        console.warn("[instagramGraph] media child fields failed; retrying without children", error);
        params.set("fields", [
            "id",
            "caption",
            "media_type",
            "media_product_type",
            "media_url",
            "thumbnail_url",
            "permalink",
            "timestamp",
            "like_count",
            "comments_count",
        ].join(","));
        const response = await fetchJson<MetaPagingResponse<MetaMedia>>(
            `${INSTAGRAM_GRAPH_BASE}/me/media?${params}`
        );
        return response.data ?? [];
    }
}

async function fetchAccountInsights(accessToken: string): Promise<{ reach?: number; profileViews?: number }> {
    const params = new URLSearchParams({
        metric: ACCOUNT_INSIGHT_METRICS.join(","),
        period: "day",
        access_token: accessToken,
    });

    try {
        const response = await fetchJson<MetaPagingResponse<MetaInsight>>(
            `${INSTAGRAM_GRAPH_BASE}/me/insights?${params}`
        );
        const values = new Map<string, number>();
        for (const insight of response.data ?? []) {
            const latest = insight.values?.at(-1)?.value;
            if (insight.name && typeof latest === "number" && Number.isFinite(latest)) {
                values.set(insight.name, latest);
            }
        }
        const insights: { reach?: number; profileViews?: number } = {};
        const reach = values.get("reach");
        const profileViews = values.get("profile_views");
        if (reach !== undefined) insights.reach = reach;
        if (profileViews !== undefined) insights.profileViews = profileViews;
        return insights;
    } catch (error) {
        console.warn("[instagramGraph] account insights failed", error);
        return {};
    }
}

async function fetchMediaInsights(accessToken: string, mediaId: string): Promise<Partial<ImportedSocialPost>> {
    const params = new URLSearchParams({
        metric: MEDIA_INSIGHT_METRICS.join(","),
        access_token: accessToken,
    });

    try {
        const response = await fetchJson<MetaPagingResponse<MetaInsight>>(
            `${INSTAGRAM_GRAPH_BASE}/${mediaId}/insights?${params}`
        );
        const values = new Map<string, number>();
        for (const insight of response.data ?? []) {
            const value = insight.values?.[0]?.value;
            if (insight.name && typeof value === "number" && Number.isFinite(value)) {
                values.set(insight.name, value);
            }
        }
        const insights: Partial<ImportedSocialPost> = {};
        const reach = values.get("reach");
        const impressions = values.get("impressions");
        const saved = values.get("saved");
        const shares = values.get("shares");
        const totalInteractions = values.get("total_interactions");
        if (reach !== undefined) insights.reach = reach;
        if (impressions !== undefined) insights.impressions = impressions;
        if (saved !== undefined) insights.saved = saved;
        if (shares !== undefined) insights.shares = shares;
        if (totalInteractions !== undefined) insights.totalInteractions = totalInteractions;
        return insights;
    } catch (error) {
        console.warn(`[instagramGraph] media insights failed for ${mediaId}`, error);
        return {};
    }
}

function parsePublishedAt(timestamp: string | undefined): number {
    if (!timestamp) return Date.now();
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? Date.now() : parsed;
}

function sanitizeCount(value: number | undefined): number | undefined {
    if (value === undefined || value === null || value < 0) return undefined;
    return value;
}

function normalizeMediaPost(media: MetaMedia, followersCount?: number): ImportedSocialPost | null {
    if (!media.id || !media.permalink) return null;

    const likeCount = sanitizeCount(media.like_count);
    const commentsCount = sanitizeCount(media.comments_count);
    const engagementScore = followersCount && followersCount > 0
        ? ((likeCount ?? 0) + (commentsCount ?? 0)) / followersCount
        : undefined;
    const children = media.children?.data
        ?.filter((child) => child.id)
        .map((child) => ({
            externalPostId: child.id,
            mediaType: child.media_type ?? "UNKNOWN",
            ...(child.media_url ? { mediaUrl: child.media_url } : {}),
            ...(child.thumbnail_url ? { thumbnailUrl: child.thumbnail_url } : {}),
            ...(child.permalink ? { permalink: child.permalink } : {}),
        }));

    return {
        externalPostId: media.id,
        mediaType: media.media_type ?? "UNKNOWN",
        permalink: media.permalink,
        publishedAt: parsePublishedAt(media.timestamp),
        ...(media.caption ? { caption: media.caption } : {}),
        ...(media.media_product_type ? { mediaProductType: media.media_product_type } : {}),
        ...(media.media_url ? { mediaUrl: media.media_url } : {}),
        ...(media.thumbnail_url ? { thumbnailUrl: media.thumbnail_url } : {}),
        ...(likeCount !== undefined ? { likeCount } : {}),
        ...(commentsCount !== undefined ? { commentsCount } : {}),
        ...(engagementScore !== undefined ? { engagementScore } : {}),
        ...(children?.length ? { children } : {}),
    };
}

export const importProjectPosts = action({
    args: {
        projectId: v.id("projects"),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<{
        importedCount: number;
        accountSnapshotCreated: boolean;
        postSnapshotsCreated: number;
    }> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Não autenticado");
        }

        const importContext = await ctx.runQuery(
            internal.instagramGraph.getProjectConnectionForImportInternal,
            {
                clerkId: identity.subject,
                projectId: args.projectId,
            }
        );

        await ctx.runMutation(api.projects.updateProfileData, {
            projectId: args.projectId,
            isFetching: true,
        });

        try {
            const accessToken = decryptToken(importContext);
            const limit = Math.min(50, Math.max(1, args.limit ?? 30));
            const [profile, media, accountInsights] = await Promise.all([
                fetchInstagramProfile(accessToken),
                fetchInstagramMedia(accessToken, limit),
                fetchAccountInsights(accessToken),
            ]);

            const followersCount = sanitizeCount(profile.followers_count);
            const followingCount = sanitizeCount(profile.follows_count);
            const basePosts = media
                .map((item) => normalizeMediaPost(item, followersCount))
                .filter((post): post is ImportedSocialPost => Boolean(post));
            const posts = await Promise.all(basePosts.map(async (post) => {
                const insights = await fetchMediaInsights(accessToken, post.externalPostId);
                const totalInteractions = insights.totalInteractions ??
                    ((post.likeCount ?? 0) + (post.commentsCount ?? 0) + (insights.saved ?? 0) + (insights.shares ?? 0));
                const engagementScore = insights.reach && insights.reach > 0
                    ? totalInteractions / insights.reach
                    : post.engagementScore;
                return {
                    ...post,
                    ...insights,
                    ...(totalInteractions > 0 ? { totalInteractions } : {}),
                    ...(engagementScore !== undefined ? { engagementScore } : {}),
                };
            }));
            const capturedAt = Date.now();

            const result = await ctx.runMutation(internal.socialPosts.importInstagramForProjectInternal, {
                userId: importContext.userId,
                projectId: args.projectId,
                connectionId: importContext.connectionId,
                externalAccountId: profile.id || importContext.externalAccountId,
                accountMetrics: {
                    ...(followersCount !== undefined ? { followersCount } : {}),
                    ...(followingCount !== undefined ? { followingCount } : {}),
                    ...(profile.media_count !== undefined ? { postsCount: profile.media_count } : {}),
                    ...(accountInsights.reach !== undefined ? { reach: accountInsights.reach } : {}),
                    ...(accountInsights.profileViews !== undefined ? { profileViews: accountInsights.profileViews } : {}),
                },
                posts,
                capturedAt,
                ...(profile.username ? { handle: profile.username } : importContext.handle ? { handle: importContext.handle } : {}),
                ...(profile.name ? { externalAccountName: profile.name } : {}),
                ...(profile.profile_picture_url ? { profilePictureUrl: profile.profile_picture_url } : {}),
            });

            if (profile.profile_picture_url) {
                const profilePicStorageId = await ctx.runAction(
                    api.files.downloadAndStoreFile,
                    { url: profile.profile_picture_url }
                );
                if (profilePicStorageId) {
                    await ctx.runMutation(api.projects.updateProfilePictureStorage, {
                        projectId: args.projectId,
                        storageId: profilePicStorageId,
                    });
                }
            }

            await ctx.runAction(internal.ai.instagramDigest.rebuildDigestInternal, {
                projectId: args.projectId,
            });

            return result;
        } catch (error) {
            await ctx.runMutation(internal.socialPosts.markInstagramImportErrorInternal, {
                projectId: args.projectId,
                connectionId: importContext.connectionId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    },
});

async function createImageContainer(args: {
    accessToken: string;
    imageUrl: string;
    caption: string;
}): Promise<string> {
    const response = await fetchJson<MetaCreateMediaResponse>(
        `${INSTAGRAM_GRAPH_BASE}/me/media`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                image_url: args.imageUrl,
                caption: args.caption,
                access_token: args.accessToken,
            }),
        }
    );
    if (!response.id) {
        throw new Error("Instagram não retornou o container de publicação");
    }
    return response.id;
}

async function publishContainer(args: {
    accessToken: string;
    creationId: string;
}): Promise<string> {
    const response = await fetchJson<MetaPublishMediaResponse>(
        `${INSTAGRAM_GRAPH_BASE}/me/media_publish`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                creation_id: args.creationId,
                access_token: args.accessToken,
            }),
        }
    );
    if (!response.id) {
        throw new Error("Instagram não retornou o ID da publicação");
    }
    return response.id;
}

export const publishDueScheduledPostsInternal = internalAction({
    args: {
        now: v.optional(v.number()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args): Promise<{
        scanned: number;
        published: number;
        failed: number;
    }> => {
        const now = args.now ?? Date.now();
        const jobs = await ctx.runQuery(internal.scheduledPosts.listDueInstagramPublishJobsInternal, {
            now,
            limit: Math.min(10, Math.max(1, args.limit ?? 5)),
        }) as InstagramPublishJob[];

        let published = 0;
        let failed = 0;

        for (const job of jobs) {
            await ctx.runMutation(internal.scheduledPosts.markPublishingInternal, {
                postId: job.postId,
            });

            try {
                if (!job.imageUrl) {
                    throw new Error("Post agendado não tem imagem para publicar no Instagram");
                }

                const accessToken = decryptToken(job);
                const containerId = await createImageContainer({
                    accessToken,
                    imageUrl: job.imageUrl,
                    caption: job.caption,
                });
                const mediaId = await publishContainer({
                    accessToken,
                    creationId: containerId,
                });
                const publishedAt = Date.now();
                const socialPostId = await ctx.runMutation(
                    internal.socialPosts.createPublishedInstagramPostInternal,
                    {
                        userId: job.userId,
                        projectId: job.projectId,
                        connectionId: job.connectionId,
                        externalAccountId: job.externalAccountId,
                        externalPostId: mediaId,
                        caption: job.caption,
                        mediaUrl: job.imageUrl,
                        permalink: `https://www.instagram.com/p/${mediaId}/`,
                        publishedAt,
                    }
                );
                await ctx.runMutation(internal.scheduledPosts.markPublishedInternal, {
                    postId: job.postId,
                    connectionId: job.connectionId,
                    socialPostId,
                    containerId,
                    mediaId,
                    publishedAt,
                });
                published += 1;
            } catch (error) {
                failed += 1;
                await ctx.runMutation(internal.scheduledPosts.markPublishFailedInternal, {
                    postId: job.postId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return { scanned: jobs.length, published, failed };
    },
});
