'use node';

import { ApifyClient } from "apify-client";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const DEFAULT_ACTOR_ID = "shu8hvrXbJbY3Eb9W";

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type RawInstagramItem = Record<string, any>;

type InstagramPostRecord = {
    instagramId: string;
    caption?: string;
    mediaUrl: string;
    thumbnailUrl?: string;
    mediaType: string;
    permalink: string;
    timestamp: string;
    likeCount?: number;
    commentsCount?: number;
    carouselImages?: { url: string }[];
};

export const fetchProfile = action({
    args: {
        projectId: v.id("projects"),
        instagramUrl: v.string(),
        /**
         * `intel_only`: captions + URLs only; skips mirroring post media to Convex (cheaper storage; digest + ideas).
         * `full`: mirror thumbnails/media into storage for gallery/composer (default when omitted — backward compatible).
         */
        syncMode: v.optional(v.union(v.literal("intel_only"), v.literal("full"))),
        /**
         * Cap Apify posts fetched.
         * Default: 30 when syncMode is intel_only, 200 when full.
         */
        resultsLimit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Must be signed in to fetch Instagram data");
        }

        const token = process.env.APIFY_API_TOKEN ?? process.env.APIFY_TOKEN;
        if (!token) {
            throw new Error("Missing Apify token (set APIFY_TOKEN or APIFY_API_TOKEN)");
        }

        const client = new ApifyClient({ token });
        const normalizedUrl = normalizeInstagramUrl(args.instagramUrl);
        const actorId = process.env.APIFY_INSTAGRAM_ACTOR_ID ?? DEFAULT_ACTOR_ID;
        const syncMode = args.syncMode ?? "full";
        const defaultLimit = syncMode === "intel_only" ? 30 : 200;
        const resultsLimit = Math.min(200, Math.max(1, args.resultsLimit ?? defaultLimit));

        await ctx.runMutation(api.projects.updateProfileData, {
            projectId: args.projectId,
            isFetching: true,
        });

        try {
            const run = await client.actor(actorId).call({
                directUrls: [normalizedUrl],
                resultsType: "posts",
                resultsLimit,
                addParentData: true,
                searchType: "user",
            });

            if (!run.defaultDatasetId) {
                throw new Error("Apify run did not return a dataset");
            }

            const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true });
            const datasetItems = (items as RawInstagramItem[]) ?? [];

            if (datasetItems.length === 0) {
                throw new Error("Apify did not return any Instagram data");
            }

            const profile = buildProfileFromItems(datasetItems, normalizedUrl);
            const posts = buildPostsFromItems(datasetItems, normalizedUrl);

            const now = Date.now();
            await ctx.runMutation(api.projects.updateProfileData, {
                projectId: args.projectId,
                ...(profile.instagramHandle && { instagramHandle: profile.instagramHandle }),
                ...(profile.profilePictureUrl && { profilePictureUrl: profile.profilePictureUrl }),
                ...(profile.bio && { bio: profile.bio }),
                ...(profile.followersCount !== undefined && { followersCount: profile.followersCount }),
                ...(profile.followingCount !== undefined && { followingCount: profile.followingCount }),
                postsCount: profile.postsCount,
                ...(profile.website && { website: profile.website }),
                isFetching: false,
                lastInstagramSyncAt: now,
                lastInstagramSyncMode: syncMode,
            });

            if (posts.length > 0) {
                const insertedPostIds = await ctx.runMutation(api.instagramPosts.replaceForProject, {
                    projectId: args.projectId,
                    posts,
                });

                if (syncMode === "full") {
                    // Download and store media files to Convex storage for reliability
                    const BATCH_SIZE = 5;
                    for (let i = 0; i < posts.length; i += BATCH_SIZE) {
                        const batch = posts.slice(i, i + BATCH_SIZE);
                        const batchIds = insertedPostIds.slice(i, i + BATCH_SIZE);

                        await Promise.all(
                            batch.map(async (post, batchIndex) => {
                                const postId = batchIds[batchIndex];
                                if (!postId) return;

                                try {
                                    const mediaType = post.mediaType.toUpperCase();
                                    const isVideo = mediaType === "VIDEO" || mediaType.includes("VIDEO");
                                    const isCarousel = mediaType === "CAROUSEL_ALBUM";

                                    if (isVideo) {
                                        if (post.thumbnailUrl) {
                                            const thumbnailStorageId = await ctx.runAction(
                                                api.files.downloadAndStoreFile,
                                                { url: post.thumbnailUrl }
                                            );
                                            if (thumbnailStorageId) {
                                                await ctx.runMutation(api.instagramPosts.updateMediaStorage, {
                                                    postId,
                                                    thumbnailStorageId,
                                                });
                                            }
                                        }
                                    } else if (isCarousel && post.carouselImages && post.carouselImages.length > 0) {
                                        const mediaStorageId = await ctx.runAction(
                                            api.files.downloadAndStoreFile,
                                            { url: post.mediaUrl }
                                        );

                                        const carouselImagesToProcess = post.carouselImages.slice(0, 10);
                                        const carouselImagesWithStorage: { url: string; storageId?: Id<"_storage"> }[] = [];

                                        for (const img of carouselImagesToProcess) {
                                            try {
                                                const storageId = await ctx.runAction(
                                                    api.files.downloadAndStoreFile,
                                                    { url: img.url }
                                                );
                                                carouselImagesWithStorage.push(
                                                    storageId
                                                        ? { url: img.url, storageId }
                                                        : { url: img.url }
                                                );
                                            } catch {
                                                carouselImagesWithStorage.push({ url: img.url });
                                            }
                                        }

                                        await ctx.runMutation(api.instagramPosts.updateMediaStorage, {
                                            postId,
                                            ...(mediaStorageId ? { mediaStorageId } : {}),
                                            ...(carouselImagesWithStorage.length > 0 ? { carouselImages: carouselImagesWithStorage } : {}),
                                        });
                                    } else {
                                        const mediaStorageId = await ctx.runAction(
                                            api.files.downloadAndStoreFile,
                                            { url: post.mediaUrl }
                                        );
                                        if (mediaStorageId) {
                                            await ctx.runMutation(api.instagramPosts.updateMediaStorage, {
                                                postId,
                                                mediaStorageId,
                                            });
                                        }
                                    }
                                } catch (error) {
                                    console.error(`Failed to store media for post ${post.instagramId}:`, error);
                                }
                            })
                        );
                    }
                }
            }

            // Download profile picture to Convex storage for reliability
            if (profile.profilePictureUrl) {
                const profilePicStorageId = await ctx.runAction(
                    api.files.downloadAndStoreFile,
                    { url: profile.profilePictureUrl }
                );
                if (profilePicStorageId) {
                    await ctx.runMutation(api.projects.updateProfilePictureStorage, {
                        projectId: args.projectId,
                        storageId: profilePicStorageId,
                    });
                }
            }

            await ctx.scheduler.runAfter(0, internal.ai.instagramDigest.rebuildDigestInternal, {
                projectId: args.projectId,
            });

            return {
                profile,
                postsInserted: posts.length,
            };
        } catch (error) {
            await ctx.runMutation(api.projects.updateProfileData, {
                projectId: args.projectId,
                isFetching: false,
            });
            throw error;
        }
    },
});

function normalizeInstagramUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();

    const formatHandle = (value: string) => value.replace(/^@/, "").split(/[/?]/)[0] ?? "";

    if (!trimmed.startsWith("http")) {
        const handle = formatHandle(trimmed);
        return handle ? `https://www.instagram.com/${handle}/` : "https://www.instagram.com/";
    }

    try {
        const url = new URL(trimmed);
        const [handle] = url.pathname.split("/").filter(Boolean);
        return handle ? `https://www.instagram.com/${handle}/` : "https://www.instagram.com/";
    } catch {
        const handle = formatHandle(trimmed);
        return handle ? `https://www.instagram.com/${handle}/` : "https://www.instagram.com/";
    }
}

function buildProfileFromItems(items: RawInstagramItem[], fallbackUrl: string) {
    const first = items[0] ?? {};
    const owner = first.owner ?? first.ownerObject ?? {};
    const meta = first.metaData ?? first.metadata ?? {};

    // IMPORTANT: Prefer metaData.username or the username from the root level
    // over ownerUsername, because ownerUsername can be from a collaborator's post
    const instagramHandle =
        coalesce<string>(
            meta.username,
            first.username,
            owner.username,
            extractHandleFromUrl(fallbackUrl),
            first.ownerUsername, // Fallback only - this can be wrong for collab posts
        ) ?? undefined;

    const followers = coalesce<number>(
        owner.followersCount,
        owner.followedBy,
        owner.followedByCount,
        owner.followers,
        owner.followed_by,
        owner.followers_count,
        first.ownerFollowers,
        first.followersCount,
        first.ownerFollowerCount,
        first.owner_followers,
        meta.followersCount,
        meta.followers,
        meta.followedBy,
    );

    const following = coalesce<number>(
        owner.followingCount,
        owner.followsCount,
        owner.follows,
        owner.following,
        owner.follow,
        owner.followed,
        owner.followedCount,
        first.ownerFollowing,
        first.ownerFollowingCount,
        first.owner_following,
        first.followingCount,
        first.following,
        meta.followingCount,
        meta.followsCount,
        meta.follows,
    );

    const postsCount = coalesce<number>(
        owner.postsCount,
        first.ownerPostsCount,
        first.postsCount,
        first.posts_count,
        meta.postsCount,
        meta.posts_count,
    );

    return {
        instagramHandle,
        profilePictureUrl: coalesce<string>(
            owner.profilePicUrl,
            owner.profilePictureUrl,
            owner.profilePicUrlHd,
            owner.profilePicUrlHD,
            owner.profilePic,
            owner.profile_pic_url,
            owner.profile_pic_url_hd,
            first.ownerProfilePicUrl,
            first.ownerProfilePicUrlHd,
            first.ownerProfilePicUrlHD,
            first.owner_profile_pic_url,
            first.owner_profile_pic_url_hd,
            first.profilePicUrl,
            first.profile_pic_url,
            first.profile_picture_url,
            meta.profilePicUrl,
            meta.profilePicUrlHd,
            meta.profilePicUrlHD,
            meta.profile_pic_url,
            meta.profile_pic_url_hd,
        ),
        bio: coalesce<string>(owner.biography, first.ownerBiography, first.biography, meta.biography),
        followersCount: followers,
        followingCount: following,
        postsCount: postsCount ?? items.length,
        website: coalesce<string>(
            owner.externalUrl,
            owner.external_url,
            owner.website,
            first.ownerExternalUrl,
            first.owner_external_url,
            first.externalUrl,
            first.website,
            meta.externalUrl,
            meta.external_url,
        ),
    };
}

function buildPostsFromItems(items: RawInstagramItem[], fallbackUrl: string): InstagramPostRecord[] {
    const now = Date.now();
    const posts: InstagramPostRecord[] = [];

    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (!item) continue;
        const isVideo = isVideoItem(item);

        // For videos, prefer videoUrl; for images, prefer displayUrl
        const mediaUrl = isVideo
            ? coalesce<string>(item.videoUrl, item.video_url, item.displayUrl, item.imageUrl)
            : coalesce<string>(
                item.displayUrl,
                item.imageUrl,
                item.videoUrl,
                item.thumbnailUrl,
            );

        if (!mediaUrl) {
            continue;
        }

        const instagramId =
            coalesce<string>(
                item.id,
                item.postId,
                item.instagramId,
                item.shortCode,
            ) ?? `post_${now}_${index}`;

        const permalink =
            coalesce<string>(
                item.permalink,
                item.url,
                item.link,
                item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : undefined,
            ) ?? fallbackUrl;

        // Store thumbnail URL - for videos use displayUrl, for images use images array first item or displayUrl
        const thumbnailUrl = coalesce<string>(
            item.displayUrl,
            item.thumbnailUrl,
            item.thumbnail_url,
            item.imageUrl,
            Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : undefined,
        );

        // Extract carousel images from childPosts or sidecarChildren or images array
        const carouselImages = extractCarouselImages(item);

        const mediaType = normalizeMediaType(
            coalesce<string>(
                item.mediaType,
                item.type,
                isVideo ? "VIDEO" : undefined,
            ) ?? "IMAGE"
        );

        const caption = coalesce<string>(item.caption, item.description, item.title);
        const likeCount = sanitizeLikeCount(coalesce<number>(
            item.likesCount,
            item.likeCount,
            item.edge_liked_by?.count,
        ));
        const commentsCount = coalesce<number>(
            item.commentsCount,
            item.commentCount,
            item.edge_media_to_comment?.count,
        );

        posts.push({
            instagramId,
            ...(caption && { caption }),
            mediaUrl,
            ...(thumbnailUrl && { thumbnailUrl }),
            mediaType,
            permalink,
            timestamp: normalizeTimestamp(
                item.timestamp ?? item.takenAt ?? item.publishedAt ?? item.createdAt,
            ),
            ...(likeCount !== undefined && { likeCount }),
            ...(commentsCount !== undefined && { commentsCount }),
            // Only include carouselImages if it's a carousel type and has images
            ...(mediaType === "CAROUSEL_ALBUM" && carouselImages.length > 0 ? { carouselImages } : {}),
        });
    }

    return posts;
}

function extractCarouselImages(item: RawInstagramItem): { url: string }[] {
    const images: { url: string }[] = [];

    // Try childPosts array (Apify format)
    if (Array.isArray(item.childPosts) && item.childPosts.length > 0) {
        for (const child of item.childPosts) {
            const url = coalesce<string>(
                child.displayUrl,
                child.imageUrl,
                child.url,
                child.videoUrl,
            );
            if (url) {
                images.push({ url });
            }
        }
    }

    // Try sidecar_to_children (Instagram API format)
    if (images.length === 0 && item.edge_sidecar_to_children?.edges) {
        for (const edge of item.edge_sidecar_to_children.edges) {
            const node = edge.node;
            const url = coalesce<string>(
                node?.display_url,
                node?.display_resources?.[0]?.src,
                node?.video_url,
            );
            if (url) {
                images.push({ url });
            }
        }
    }

    // Try sidecarChildren array
    if (images.length === 0 && Array.isArray(item.sidecarChildren) && item.sidecarChildren.length > 0) {
        for (const child of item.sidecarChildren) {
            const url = coalesce<string>(
                child.displayUrl,
                child.display_url,
                child.imageUrl,
                child.url,
            );
            if (url) {
                images.push({ url });
            }
        }
    }

    // Try images array (some scrapers use this)
    if (images.length === 0 && Array.isArray(item.images) && item.images.length > 0) {
        for (const img of item.images) {
            if (typeof img === "string") {
                images.push({ url: img });
            } else if (img && typeof img === "object" && img.url) {
                images.push({ url: img.url });
            }
        }
    }

    return images;
}

function normalizeTimestamp(value: unknown): string {
    if (typeof value === "number") {
        return new Date(value > 1e12 ? value : value * 1000).toISOString();
    }

    if (typeof value === "string" && value.trim().length > 0) {
        const numericValue = Number(value);
        if (!Number.isNaN(numericValue)) {
            return new Date(numericValue > 1e12 ? numericValue : numericValue * 1000).toISOString();
        }

        const parsed = new Date(value);
        if (!Number.isNaN(parsed.valueOf())) {
            return parsed.toISOString();
        }
    }

    return new Date().toISOString();
}

function extractHandleFromUrl(url: string): string | undefined {
    try {
        const parsed = new URL(url);
        const [handle] = parsed.pathname.split("/").filter(Boolean);
        return handle;
    } catch {
        const cleaned = url.replace(/^https?:\/\//, "");
        return cleaned.split("/").filter(Boolean)[0];
    }
}

function coalesce<T>(...values: (T | null | undefined)[]): T | undefined {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return undefined;
}

function isVideoItem(item: RawInstagramItem): boolean {
    const type = String(item.type ?? item.mediaType ?? "").toUpperCase();
    if (type === "VIDEO" || type === "CLIP" || type === "REEL") {
        return true;
    }

    const productType = String(item.productType ?? "").toUpperCase();
    if (productType.includes("VIDEO") || productType.includes("CLIP")) {
        return true;
    }

    return Boolean(item.isVideo);
}

function normalizeMediaType(type: string): string {
    const upper = type.toUpperCase();
    // Normalize common variations
    if (upper === "VIDEO" || upper === "REEL" || upper === "CLIP" || upper.includes("VIDEO")) {
        return "VIDEO";
    }
    if (upper === "IMAGE" || upper === "PHOTO" || upper === "GRAPHIMAGE") {
        return "IMAGE";
    }
    if (upper === "CAROUSEL" || upper === "CAROUSEL_ALBUM" || upper === "SIDECAR") {
        return "CAROUSEL_ALBUM";
    }
    return upper;
}

function sanitizeLikeCount(count: number | undefined): number | undefined {
    // API sometimes returns -1 for hidden or unavailable like counts
    if (count === undefined || count === null || count < 0) {
        return undefined;
    }
    return count;
}

// ============================================================================
// Fetch Single Post
// ============================================================================

type FetchedInstagramPost = {
    instagramId: string;
    caption?: string;
    imageUrls: string[];
    permalink: string;
    ownerUsername?: string;
};

/**
 * Fetch a single Instagram post by URL
 * Used in chat to get post data as reference for generation
 */
export const fetchPost = action({
    args: {
        postUrl: v.string(),
    },
    handler: async (ctx, args): Promise<FetchedInstagramPost> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Você precisa estar autenticado");
        }

        const token = process.env.APIFY_API_TOKEN ?? process.env.APIFY_TOKEN;
        if (!token) {
            throw new Error("Token Apify não configurado");
        }

        const client = new ApifyClient({ token });
        const normalizedUrl = normalizePostUrl(args.postUrl);
        const actorId = process.env.APIFY_INSTAGRAM_ACTOR_ID ?? DEFAULT_ACTOR_ID;

        const run = await client.actor(actorId).call({
            directUrls: [normalizedUrl],
            resultsType: "posts",
            resultsLimit: 1,
        });

        if (!run.defaultDatasetId) {
            throw new Error("Apify não retornou dados");
        }

        const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true });
        const datasetItems = (items as RawInstagramItem[]) ?? [];

        if (datasetItems.length === 0) {
            throw new Error("Post não encontrado");
        }

        const item = datasetItems[0];
        if (!item) {
            throw new Error("Post não encontrado");
        }

        // Extract image URLs
        const imageUrls: string[] = [];

        // Main display image
        const mainImageUrl = coalesce<string>(
            item.displayUrl,
            item.imageUrl,
            item.thumbnailUrl,
        );
        if (mainImageUrl) {
            imageUrls.push(mainImageUrl);
        }

        // Carousel images
        const carouselImages = extractCarouselImages(item);
        for (const img of carouselImages) {
            if (!imageUrls.includes(img.url)) {
                imageUrls.push(img.url);
            }
        }

        const instagramId = coalesce<string>(
            item.id,
            item.postId,
            item.instagramId,
            item.shortCode,
        ) ?? `post_${Date.now()}`;

        const permalink = coalesce<string>(
            item.permalink,
            item.url,
            item.link,
            item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : undefined,
        ) ?? normalizedUrl;

        const caption = coalesce<string>(item.caption, item.description, item.title);
        const ownerUsername = coalesce<string>(
            item.ownerUsername,
            item.owner?.username,
            item.ownerObject?.username,
        );

        return {
            instagramId,
            ...(caption && { caption }),
            imageUrls,
            permalink,
            ...(ownerUsername && { ownerUsername }),
        };
    },
});

/**
 * Normalize an Instagram post URL to the canonical format
 */
function normalizePostUrl(rawUrl: string): string {
    const trimmed = rawUrl.trim();

    // If it's just a shortcode, build the URL
    if (!trimmed.startsWith("http")) {
        // Could be a shortcode like "CxYz123" or "p/CxYz123"
        const shortcode = trimmed.replace(/^p\//, "").split(/[/?]/)[0];
        return shortcode ? `https://www.instagram.com/p/${shortcode}/` : trimmed;
    }

    try {
        const url = new URL(trimmed);
        // Handle /p/, /reel/, /tv/ formats
        const pathParts = url.pathname.split("/").filter(Boolean);
        const typeIndex = pathParts.findIndex(p => ["p", "reel", "tv"].includes(p));

        if (typeIndex !== -1 && pathParts[typeIndex + 1]) {
            const type = pathParts[typeIndex];
            const shortcode = pathParts[typeIndex + 1];
            return `https://www.instagram.com/${type}/${shortcode}/`;
        }

        return trimmed;
    } catch {
        return trimmed;
    }
}
