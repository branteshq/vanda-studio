import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  InstagramProviderFailed,
  PublicInstagramProvider,
  type PublicInstagramProviderShape,
} from "../service";
import type { InstagramComment, InstagramPost, InstagramProfile } from "../types";

const APIFY_BASE = "https://api.apify.com/v2/acts";
const INSTAGRAM_ACTOR = "apify~instagram-scraper";
const REEL_ACTOR = "apify~instagram-reel-scraper";

const stringOf = (value: unknown): string | undefined => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
};

const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const booleanOf = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const stringsOf = (value: unknown): ReadonlyArray<string> | undefined => {
  if (!Array.isArray(value)) return undefined;
  const strings = value.flatMap((item) => {
    const parsed = stringOf(item);
    return parsed ? [parsed] : [];
  });
  return strings.length > 0 ? strings : undefined;
};

const timestampOf = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Record<K, V>);

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const mediaTypeOf = (value: unknown): InstagramPost["mediaType"] => {
  switch (stringOf(value)?.toLocaleLowerCase()) {
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

export const normalizeApifyPost = (raw: unknown): InstagramPost | undefined => {
  const item = recordOf(raw);
  if (!item) return undefined;
  const id = stringOf(item["id"] ?? item["pk"]);
  const shortcode = stringOf(item["shortCode"] ?? item["shortcode"] ?? item["code"]);
  const url =
    stringOf(item["url"] ?? item["postUrl"] ?? item["inputUrl"]) ??
    (shortcode ? `https://www.instagram.com/p/${shortcode}/` : undefined);
  if (!id || !url) return undefined;
  return {
    id,
    url,
    mediaType: mediaTypeOf(item["type"] ?? item["productType"]),
    publicEngagement: {
      ...optional("likes", numberOf(item["likesCount"] ?? item["like_count"])),
      ...optional("comments", numberOf(item["commentsCount"] ?? item["comment_count"])),
      ...optional("views", numberOf(item["videoViewCount"] ?? item["view_count"])),
      ...optional("plays", numberOf(item["videoPlayCount"] ?? item["play_count"])),
      ...optional("shares", numberOf(item["sharesCount"] ?? item["reshare_count"])),
    },
    ...optional("shortcode", shortcode),
    ...optional("ownerHandle", stringOf(item["ownerUsername"] ?? item["username"])),
    ...optional("caption", stringOf(item["caption"] ?? item["description"])),
    ...optional("publishedAt", timestampOf(item["timestamp"] ?? item["taken_at"])),
    ...optional("mediaUrl", stringOf(item["videoUrl"] ?? item["displayUrl"])),
    ...optional("thumbnailUrl", stringOf(item["displayUrl"])),
    ...optional("transcript", stringOf(item["transcript"])),
    ...optional("hashtags", stringsOf(item["hashtags"])),
    ...optional("mentions", stringsOf(item["mentions"])),
    ...optional("durationSeconds", numberOf(item["videoDuration"])),
  };
};

export const normalizeApifyProfile = (raw: unknown): InstagramProfile | undefined => {
  const item = recordOf(raw);
  if (!item) return undefined;
  const handle = stringOf(item["username"] ?? item["handle"]);
  if (!handle) return undefined;
  const externalUrls = Array.isArray(item["externalUrls"])
    ? item["externalUrls"].flatMap((entry) => {
        const url = stringOf(recordOf(entry)?.["url"]);
        return url ? [url] : [];
      })
    : [];
  const latestPosts = Array.isArray(item["latestPosts"])
    ? item["latestPosts"].flatMap((post) => {
        const normalized = normalizeApifyPost(post);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    handle,
    ...optional("id", stringOf(item["id"])),
    ...optional("name", stringOf(item["fullName"] ?? item["full_name"])),
    ...optional("biography", stringOf(item["biography"] ?? item["bio"])),
    ...optional("website", stringOf(item["externalUrl"]) ?? externalUrls[0]),
    ...optional("category", stringOf(item["businessCategoryName"] ?? item["category"])),
    ...optional(
      "profileImageUrl",
      stringOf(item["profilePicUrlHD"] ?? item["profilePicUrl"] ?? item["profile_pic_url"]),
    ),
    ...optional("followers", numberOf(item["followersCount"] ?? item["follower_count"])),
    ...optional("following", numberOf(item["followsCount"] ?? item["following_count"])),
    ...optional("postsCount", numberOf(item["postsCount"] ?? item["media_count"])),
    ...optional("private", booleanOf(item["private"] ?? item["is_private"])),
    ...optional("verified", booleanOf(item["verified"] ?? item["is_verified"])),
    ...(latestPosts.length > 0 ? { latestPosts } : {}),
  };
};

const normalizeComment = (raw: unknown): InstagramComment | undefined => {
  const item = recordOf(raw);
  if (!item) return undefined;
  const id = stringOf(item["id"]);
  const text = stringOf(item["text"]);
  if (!id || !text) return undefined;
  const replies = Array.isArray(item["replies"])
    ? item["replies"].flatMap((reply) => {
        const normalized = normalizeComment(reply);
        return normalized ? [normalized] : [];
      })
    : [];
  return {
    id,
    text,
    ...optional(
      "username",
      stringOf(item["ownerUsername"] ?? recordOf(item["owner"])?.["username"]),
    ),
    ...optional("timestamp", timestampOf(item["timestamp"])),
    ...optional("likes", numberOf(item["likesCount"])),
    ...(replies.length > 0 ? { replies } : {}),
  };
};

const actorRun = (
  token: string,
  actor: string,
  operation: string,
  input: unknown,
): Effect.Effect<ReadonlyArray<unknown>, InstagramProviderFailed> =>
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
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body)) throw new Error("dataset response is not an array");
      return body;
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

export const makeApifyPublicInstagramProvider = (token: string): PublicInstagramProviderShape => ({
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
