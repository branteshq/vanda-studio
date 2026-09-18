import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { z } from "zod";
import {
  InstagramProviderFailed,
  PublicInstagramProvider,
  type PublicInstagramProviderService,
} from "../service";
import type { InstagramComment, InstagramPost, InstagramProfile } from "../types";

const APIFY_BASE = "https://api.apify.com/v2/acts";

const INSTAGRAM_ACTOR = "apify~instagram-scraper";

const REEL_ACTOR = "apify~instagram-reel-scraper";

const optionalStringSchema = z
  .string()
  .transform((value) => value.trim() || undefined)
  .optional()
  .catch(undefined);

const optionalNumberSchema = z.number().finite().optional().catch(undefined);

const optionalBooleanSchema = z.boolean().optional().catch(undefined);

const optionalStringsSchema = z
  .array(optionalStringSchema)
  .transform((values) => values.filter((value) => value !== undefined))
  .transform((values) => (values.length > 0 ? values : undefined))
  .optional()
  .catch(undefined);

const timestampSchema = z
  .union([z.number().finite(), z.string()])
  .transform((value) => {
    if (z.number().safeParse(value).success) {
      const timestamp = z.number().parse(value);

      return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
    }

    const parsed = Date.parse(z.string().parse(value));

    return Number.isFinite(parsed) ? parsed : undefined;
  })
  .optional()
  .catch(undefined);

const apifyItemSchema = z.object({
  id: optionalStringSchema,
  pk: optionalStringSchema,
  shortCode: optionalStringSchema,
  shortcode: optionalStringSchema,
  code: optionalStringSchema,
  url: optionalStringSchema,
  postUrl: optionalStringSchema,
  inputUrl: optionalStringSchema,
  type: optionalStringSchema,
  productType: optionalStringSchema,
  likesCount: optionalNumberSchema,
  like_count: optionalNumberSchema,
  commentsCount: optionalNumberSchema,
  comment_count: optionalNumberSchema,
  videoViewCount: optionalNumberSchema,
  view_count: optionalNumberSchema,
  videoPlayCount: optionalNumberSchema,
  play_count: optionalNumberSchema,
  sharesCount: optionalNumberSchema,
  reshare_count: optionalNumberSchema,
  ownerUsername: optionalStringSchema,
  username: optionalStringSchema,
  handle: optionalStringSchema,
  caption: optionalStringSchema,
  description: optionalStringSchema,
  timestamp: timestampSchema,
  taken_at: timestampSchema,
  videoUrl: optionalStringSchema,
  displayUrl: optionalStringSchema,
  transcript: optionalStringSchema,
  hashtags: optionalStringsSchema,
  mentions: optionalStringsSchema,
  videoDuration: optionalNumberSchema,
  fullName: optionalStringSchema,
  full_name: optionalStringSchema,
  biography: optionalStringSchema,
  bio: optionalStringSchema,
  externalUrl: optionalStringSchema,
  externalUrls: z.array(z.object({ url: optionalStringSchema })).catch([]),
  businessCategoryName: optionalStringSchema,
  category: optionalStringSchema,
  profilePicUrlHD: optionalStringSchema,
  profilePicUrl: optionalStringSchema,
  profile_pic_url: optionalStringSchema,
  followersCount: optionalNumberSchema,
  follower_count: optionalNumberSchema,
  followsCount: optionalNumberSchema,
  following_count: optionalNumberSchema,
  postsCount: optionalNumberSchema,
  media_count: optionalNumberSchema,
  private: optionalBooleanSchema,
  is_private: optionalBooleanSchema,
  verified: optionalBooleanSchema,
  is_verified: optionalBooleanSchema,
  latestPosts: z.array(z.json()).catch([]),
  text: optionalStringSchema,
  owner: z.object({ username: optionalStringSchema }).catch({}),
  replies: z.array(z.json()).catch([]),
});

type JsonPrimitive = string | number | boolean | null;

type JsonValue =
  | JsonPrimitive
  | undefined
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

const optional = <K extends string, V>(key: K, value: V | undefined) => {
  const result: Partial<Record<K, V>> = {};

  if (value !== undefined) result[key] = value;

  return result;
};

const mediaTypeOf = (value: string | undefined): InstagramPost["mediaType"] => {
  switch (value?.toLocaleLowerCase()) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "sidecar":
    case "carousel":
    case "carousel_album":
    case "carousel_container":
      return "carousel";
    default:
      return "unknown";
  }
};

export const normalizeApifyPost = (raw: JsonValue): InstagramPost | undefined => {
  const parsedItem = apifyItemSchema.safeParse(raw);

  if (!parsedItem.success) return undefined;
  const item = parsedItem.data;
  const id = item.id ?? item.pk;
  const shortcode = item.shortCode ?? item.shortcode ?? item.code;

  const url =
    item.url ??
    item.postUrl ??
    item.inputUrl ??
    (shortcode ? `https://www.instagram.com/p/${shortcode}/` : undefined);

  if (!id || !url) return undefined;

  return {
    id,
    url,
    mediaType: mediaTypeOf(item.type ?? item.productType),
    publicEngagement: {
      ...optional("likes", item.likesCount ?? item.like_count),
      ...optional("comments", item.commentsCount ?? item.comment_count),
      ...optional("views", item.videoViewCount ?? item.view_count),
      ...optional("plays", item.videoPlayCount ?? item.play_count),
      ...optional("shares", item.sharesCount ?? item.reshare_count),
    },
    ...optional("shortcode", shortcode),
    ...optional("ownerHandle", item.ownerUsername ?? item.username),
    ...optional("caption", item.caption ?? item.description),
    ...optional("publishedAt", item.timestamp ?? item.taken_at),
    ...optional("mediaUrl", item.videoUrl ?? item.displayUrl),
    ...optional("thumbnailUrl", item.displayUrl),
    ...optional("transcript", item.transcript),
    ...optional("hashtags", item.hashtags),
    ...optional("mentions", item.mentions),
    ...optional("durationSeconds", item.videoDuration),
  };
};

export const normalizeApifyProfile = (raw: JsonValue): InstagramProfile | undefined => {
  const parsedItem = apifyItemSchema.safeParse(raw);

  if (!parsedItem.success) return undefined;
  const item = parsedItem.data;
  const handle = item.username ?? item.handle;

  if (!handle) return undefined;

  const externalUrls = item.externalUrls.flatMap((entry) => (entry.url ? [entry.url] : []));

  const latestPosts = item.latestPosts.flatMap((post) => {
    const normalized = normalizeApifyPost(post);

    return normalized ? [normalized] : [];
  });

  return {
    handle,
    ...optional("id", item.id),
    ...optional("name", item.fullName ?? item.full_name),
    ...optional("biography", item.biography ?? item.bio),
    ...optional("website", item.externalUrl ?? externalUrls[0]),
    ...optional("category", item.businessCategoryName ?? item.category),
    ...optional(
      "profileImageUrl",
      item.profilePicUrlHD ?? item.profilePicUrl ?? item.profile_pic_url,
    ),
    ...optional("followers", item.followersCount ?? item.follower_count),
    ...optional("following", item.followsCount ?? item.following_count),
    ...optional("postsCount", item.postsCount ?? item.media_count),
    ...optional("private", item.private ?? item.is_private),
    ...optional("verified", item.verified ?? item.is_verified),
    ...optional("latestPosts", latestPosts.length > 0 ? latestPosts : undefined),
  };
};

const normalizeComment = (raw: JsonValue): InstagramComment | undefined => {
  const parsedItem = apifyItemSchema.safeParse(raw);

  if (!parsedItem.success) return undefined;
  const item = parsedItem.data;
  const id = item.id;
  const text = item.text;

  if (!id || !text) return undefined;

  const replies = item.replies.flatMap((reply) => {
    const normalized = normalizeComment(reply);

    return normalized ? [normalized] : [];
  });

  return {
    id,
    text,
    ...optional("username", item.ownerUsername ?? item.owner.username),
    ...optional("timestamp", item.timestamp),
    ...optional("likes", item.likesCount),
    ...optional("replies", replies.length > 0 ? replies : undefined),
  };
};

const actorRun = (
  token: string,
  actor: string,
  operation: string,
  input: JsonValue,
): Effect.Effect<ReadonlyArray<JsonValue>, InstagramProviderFailed> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(
        `${APIFY_BASE}/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(240_000),
        },
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

      // Each normalizer decodes its item once; schema transforms (notably
      // seconds-to-milliseconds timestamps) must not run on their own output.
      return z.array(z.json()).parse(await response.json());
    },
    catch: (error) =>
      new InstagramProviderFailed({
        provider: "apify",
        operation,
        message: error instanceof Error ? error.message : String(error),
      }),
  });

const profileUrl = (handle: string): string =>
  `https://www.instagram.com/${handle.trim().replace(/^@/, "")}/`;

export const makeApifyPublicInstagramProvider = (
  token: string,
): PublicInstagramProviderService => ({
  searchProfiles: (query, limit) =>
    actorRun(token, INSTAGRAM_ACTOR, "search_profiles", {
      directUrls: [],
      search: query,
      searchType: "user",
      searchLimit: limit,
      resultsType: "details",
      resultsLimit: limit,
      addParentData: false,
      addProfileStatistics: true,
    }).pipe(
      Effect.map((items) => {
        const profiles = items.flatMap((item) => {
          const normalized = normalizeApifyProfile(item);

          return normalized ? [normalized] : [];
        });

        return {
          data: profiles,
          completeness: profiles.length >= limit ? ("partial" as const) : ("complete" as const),
        };
      }),
    ),
  readProfile: (handle) =>
    actorRun(token, INSTAGRAM_ACTOR, "profile", {
      directUrls: [profileUrl(handle)],
      resultsType: "details",
      resultsLimit: 1,
      addParentData: false,
      addProfileStatistics: true,
    }).pipe(
      Effect.flatMap((items) => {
        const profile = normalizeApifyProfile(items[0]);

        return profile
          ? Effect.succeed({ data: profile, completeness: "complete" as const })
          : new InstagramProviderFailed({
              provider: "apify",
              operation: "profile",
              message: `profile @${handle} not found`,
            });
      }),
    ),
  listPosts: (handle, limit) =>
    actorRun(token, INSTAGRAM_ACTOR, "posts", {
      directUrls: [profileUrl(handle)],
      resultsType: "posts",
      resultsLimit: limit,
      addParentData: false,
    }).pipe(
      Effect.map((items) => {
        const posts = items.flatMap((item) => {
          const normalized = normalizeApifyPost(item);

          return normalized ? [normalized] : [];
        });

        return {
          data: posts,
          completeness: posts.length >= limit ? ("partial" as const) : ("complete" as const),
        };
      }),
    ),
  readPost: (postUrl, includeTranscript) =>
    actorRun(
      token,
      includeTranscript ? REEL_ACTOR : INSTAGRAM_ACTOR,
      "post",
      includeTranscript
        ? {
            username: [postUrl],
            resultsLimit: 1,
            includeTranscript: true,
            downloadVideos: false,
          }
        : { directUrls: [postUrl], resultsType: "posts", resultsLimit: 1 },
    ).pipe(
      Effect.flatMap((items) => {
        const post = normalizeApifyPost(items[0]);

        return post
          ? Effect.succeed({ data: post, completeness: "complete" as const })
          : new InstagramProviderFailed({
              provider: "apify",
              operation: "post",
              message: "post not found",
            });
      }),
    ),
  listComments: (postUrl, limit) =>
    actorRun(token, INSTAGRAM_ACTOR, "comments", {
      directUrls: [postUrl],
      resultsType: "comments",
      resultsLimit: limit,
    }).pipe(
      Effect.map((items) => {
        const comments = items.flatMap((item) => {
          const normalized = normalizeComment(item);

          return normalized ? [normalized] : [];
        });

        return {
          data: comments,
          completeness: comments.length >= limit ? ("partial" as const) : ("complete" as const),
        };
      }),
    ),
});

export const apifyPublicInstagramProviderLayer = (
  token: string,
): Layer.Layer<PublicInstagramProvider> =>
  Layer.succeed(PublicInstagramProvider, makeApifyPublicInstagramProvider(token));
