/**
 * Upload-Post adapter — the publisher port's only implementation. One org
 * API key (UPLOADPOST_API_KEY); each Vanda account maps to one Upload-Post
 * "profile" (username = the Convex account id), and customers connect their
 * social accounts through a white-label OAuth page we mint per profile.
 * Their tokens live inside Upload-Post — nothing sensitive is stored here.
 */
import { z } from "zod";

const BASE_URL = "https://api.upload-post.com/api";

const apiKey = (): string => {
  const key = process.env.UPLOADPOST_API_KEY;

  if (!key) throw new Error("UPLOADPOST_API_KEY não configurada");

  return key;
};

const upFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Apikey ${apiKey()}`);

  return fetch(`${BASE_URL}${path}`, { ...init, headers });
};

const upJson = async <T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> => {
  const response = await upFetch(path, init);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `upload-post ${path} HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
    );
  }

  return schema.parse(await response.json());
};

type JsonPrimitive = string | number | boolean | null;

type JsonValue = JsonPrimitive | ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue };

const jsonInit = (body: JsonValue): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export interface PublisherProfile {
  username: string;
  /** Platform → connection info; a non-empty value means connected. */
  socialAccounts: Record<string, SocialAccount>;
}

const socialAccountFieldsSchema = z.object({
  handle: z.string().optional().catch(undefined),
  display_name: z.string().optional().catch(undefined),
  username: z.string().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
});

const socialAccountSchema = z.union([z.string(), socialAccountFieldsSchema]).nullable().catch(null);

type SocialAccount = z.infer<typeof socialAccountSchema>;

const socialAccountsSchema = z.record(z.string(), socialAccountSchema);

const profileFieldsSchema = z.object({
  username: z.string().optional(),
  social_accounts: socialAccountsSchema.optional(),
});

const profileResponseSchema = profileFieldsSchema.extend({
  profile: profileFieldsSchema.optional(),
});

type ProfileResponse = z.infer<typeof profileResponseSchema>;

const parseProfile = (raw: ProfileResponse): PublisherProfile => {
  const inner = raw.profile ?? raw;

  return {
    username: inner.username ?? "",
    socialAccounts: inner.social_accounts ?? {},
  };
};

export interface InstagramState {
  connected: boolean;
  /** The @username when the API exposes it; null otherwise. */
  username: string | null;
}

export interface InstagramProfileInfo extends InstagramState {
  /** Human-facing account name when Upload-Post includes it in the connection. */
  displayName: string | null;
}

/** A usable @username — non-empty and not a bare numeric platform id. */
const usernameOrNull = (value: string | undefined): string | null =>
  value !== undefined && value.trim() !== "" && !/^\d+$/.test(value.trim()) ? value.trim() : null;

/** Instagram connection state of a profile. The entry is a rich object on the
 * list/get endpoints but can be a flat string (sometimes the numeric account
 * id) right after connecting — a numeric id counts as connected, handle-less. */
export const instagramStateOf = (profile: PublisherProfile): InstagramState => {
  const entry = profile.socialAccounts["instagram"];
  const stringEntry = z.string().safeParse(entry);

  if (stringEntry.success) {
    return stringEntry.data.trim() === ""
      ? { connected: false, username: null }
      : { connected: true, username: usernameOrNull(stringEntry.data) };
  }

  const fields = socialAccountFieldsSchema.safeParse(entry);

  if (fields.success) {
    return {
      connected: true,
      username:
        usernameOrNull(fields.data.handle) ??
        usernameOrNull(fields.data.username) ??
        usernameOrNull(fields.data.display_name),
    };
  }

  return { connected: false, username: null };
};

/** Profile fields exposed alongside the Instagram OAuth connection. */
export const instagramProfileInfoOf = (profile: PublisherProfile): InstagramProfileInfo => {
  const state = instagramStateOf(profile);
  const entry = profile.socialAccounts["instagram"];

  const fields = socialAccountFieldsSchema.safeParse(entry);

  if (!fields.success) return { ...state, displayName: state.username };

  return {
    ...state,
    displayName:
      usernameOrNull(fields.data.display_name) ??
      usernameOrNull(fields.data.name) ??
      state.username,
  };
};

/** Create the profile if it doesn't exist yet (idempotent). */
export const ensureProfile = async (username: string): Promise<void> => {
  const response = await upFetch("/uploadposts/users", jsonInit({ username }));

  if (response.ok) return;
  // "Already exists" is success for our purposes — 409, or the message
  // wording ("Username already in use" / "already exists").
  const body = await response.text().catch(() => "");

  if (response.status === 409 || /already in use|exist/i.test(body)) return;
  throw new Error(
    `upload-post create profile HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
  );
};

export const getProfile = async (username: string): Promise<PublisherProfile | null> => {
  const response = await upFetch(`/uploadposts/users/${encodeURIComponent(username)}`);

  if (response.status === 404) return null;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `upload-post get profile HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
    );
  }

  return parseProfile(profileResponseSchema.parse(await response.json()));
};

/** Best-effort profile removal (used when a Vanda account is deleted). */
export const deleteProfile = async (username: string): Promise<void> => {
  await upFetch("/uploadposts/users", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username }),
  }).catch(() => undefined);
};

export interface InstagramMediaItem {
  readonly id: string;
  readonly caption: string | null;
  readonly mediaType: string | null;
  readonly mediaUrl: string | null;
  readonly permalink: string | null;
  readonly timestamp: string | null;
  readonly thumbnailUrl: string | null;
}

export interface InstagramMediaPage {
  readonly media: ReadonlyArray<InstagramMediaItem>;
  readonly pagination: {
    readonly limit: number;
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

export interface InstagramComment {
  readonly id: string;
  readonly text: string;
  readonly timestamp: string | null;
  readonly username: string | null;
}

export interface InstagramCommentsPage {
  readonly comments: ReadonlyArray<InstagramComment>;
  readonly pagination: {
    readonly nextCursor: string | null;
    readonly hasNext: boolean;
  };
}

export interface InstagramAnalytics {
  readonly followers: number | null;
  readonly reach: number | null;
  readonly views: number | null;
  readonly profileViews: number | null;
  readonly likes: number | null;
  readonly comments: number | null;
  readonly shares: number | null;
  readonly saves: number | null;
  readonly followerDemographics: unknown | null;
  readonly engagedAudienceDemographics: unknown | null;
}

export interface InstagramPostAnalytics {
  readonly postId: string;
  readonly likes: number | null;
  readonly comments: number | null;
  readonly views: number | null;
  readonly reach: number | null;
  readonly impressions: number | null;
  readonly saves: number | null;
  readonly shares: number | null;
}

const nullableStringSchema = z
  .string()
  .transform((value) => value.trim() || null)
  .catch(null);

const nullableNumberSchema = z.number().finite().nullable().catch(null);

const mediaResponseSchema = z.object({
  media: z
    .array(
      z.object({
        id: nullableStringSchema,
        caption: nullableStringSchema,
        media_type: nullableStringSchema,
        media_url: nullableStringSchema,
        permalink: nullableStringSchema,
        timestamp: nullableStringSchema,
        thumbnail_url: nullableStringSchema,
      }),
    )
    .default([]),
  pagination: z
    .object({
      limit: nullableNumberSchema,
      next_cursor: nullableStringSchema,
      has_more: z.boolean().catch(false),
    })
    .default({ limit: null, next_cursor: null, has_more: false }),
});

const commentsResponseSchema = z.object({
  comments: z
    .array(
      z.object({
        id: nullableStringSchema,
        text: nullableStringSchema,
        timestamp: nullableStringSchema,
        user: z.object({ username: nullableStringSchema }).default({ username: null }),
      }),
    )
    .default([]),
  pagination: z
    .object({
      next_cursor: nullableStringSchema,
      has_next: z.boolean().catch(false),
    })
    .default({ next_cursor: null, has_next: false }),
});

const analyticsMetricsSchema = z.object({
  followers: nullableNumberSchema,
  reach: nullableNumberSchema,
  views: nullableNumberSchema,
  impressions: nullableNumberSchema,
  profileViews: nullableNumberSchema,
  likes: nullableNumberSchema,
  comments: nullableNumberSchema,
  shares: nullableNumberSchema,
  saves: nullableNumberSchema,
  follower_demographics: z.json().nullable().catch(null),
  engaged_audience_demographics: z.json().nullable().catch(null),
});

const EMPTY_ANALYTICS = {
  followers: null,
  reach: null,
  views: null,
  impressions: null,
  profileViews: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  follower_demographics: null,
  engaged_audience_demographics: null,
};

const analyticsResponseSchema = z.object({
  instagram: analyticsMetricsSchema.default(EMPTY_ANALYTICS),
});

const postAnalyticsResponseSchema = z.object({
  platforms: z
    .object({
      instagram: z
        .object({
          platform_post_id: nullableStringSchema,
          post_metrics: analyticsMetricsSchema.default(EMPTY_ANALYTICS),
        })
        .default({ platform_post_id: null, post_metrics: EMPTY_ANALYTICS }),
    })
    .default({
      instagram: { platform_post_id: null, post_metrics: EMPTY_ANALYTICS },
    }),
});

const queryPath = (path: string, values: Record<string, string | number | undefined>): string => {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value));
  }

  return `${path}?${query.toString()}`;
};

/** Read recent media owned by the connected Instagram account. */
export const getInstagramMedia = async (
  username: string,
  options: { readonly limit?: number; readonly cursor?: string } = {},
): Promise<InstagramMediaPage> => {
  const raw = await upJson(
    queryPath("/uploadposts/media", {
      platform: "instagram",
      user: username,
      limit: options.limit,
      cursor: options.cursor,
    }),
    mediaResponseSchema,
  );

  const media = raw.media.flatMap((item) => {
    if (item.id === null) return [];

    return [
      {
        id: item.id,
        caption: item.caption,
        mediaType: item.media_type,
        mediaUrl: item.media_url,
        permalink: item.permalink,
        timestamp: item.timestamp,
        thumbnailUrl: item.thumbnail_url,
      },
    ];
  });

  return {
    media,
    pagination: {
      limit: raw.pagination.limit ?? options.limit ?? 25,
      nextCursor: raw.pagination.next_cursor,
      hasMore: raw.pagination.has_more,
    },
  };
};

/** Read one page of comments under a post owned by the connected account. */
export const getInstagramComments = async (
  username: string,
  postId: string,
  options: { readonly limit?: number; readonly after?: string } = {},
): Promise<InstagramCommentsPage> => {
  const raw = await upJson(
    queryPath("/uploadposts/comments", {
      platform: "instagram",
      user: username,
      post_id: postId,
      limit: options.limit,
      after: options.after,
    }),
    commentsResponseSchema,
  );

  const comments = raw.comments.flatMap((item) => {
    if (item.id === null || item.text === null) return [];

    return [
      {
        id: item.id,
        text: item.text,
        timestamp: item.timestamp,
        username: item.user.username,
      },
    ];
  });

  return {
    comments,
    pagination: {
      nextCursor: raw.pagination.next_cursor,
      hasNext: raw.pagination.has_next,
    },
  };
};

/** Read current account-level Instagram analytics. */
export const getInstagramAnalytics = async (username: string): Promise<InstagramAnalytics> => {
  const raw = await upJson(
    queryPath(`/analytics/${encodeURIComponent(username)}`, { platforms: "instagram" }),
    analyticsResponseSchema,
  );

  const instagram = raw.instagram;

  return {
    followers: instagram.followers,
    reach: instagram.reach,
    views: instagram.views ?? instagram.impressions,
    profileViews: instagram.profileViews,
    likes: instagram.likes,
    comments: instagram.comments,
    shares: instagram.shares,
    saves: instagram.saves,
    followerDemographics: instagram.follower_demographics,
    engagedAudienceDemographics: instagram.engaged_audience_demographics,
  };
};

/** Read live private insights for an owned post, including organic posts. */
export const getInstagramPostAnalytics = async (
  username: string,
  postId: string,
): Promise<InstagramPostAnalytics> => {
  const raw = await upJson(
    queryPath("/uploadposts/post-analytics", {
      platform_post_id: postId,
      platform: "instagram",
      user: username,
    }),
    postAnalyticsResponseSchema,
  );

  const instagram = raw.platforms.instagram;
  const metrics = instagram.post_metrics;

  return {
    postId: instagram.platform_post_id ?? postId,
    likes: metrics.likes,
    comments: metrics.comments,
    views: metrics.views,
    reach: metrics.reach,
    impressions: metrics.impressions,
    saves: metrics.saves,
    shares: metrics.shares,
  };
};

/** Mint the white-label connect page URL the customer opens to link Instagram. */
export const generateConnectUrl = async (args: {
  username: string;
  redirectUrl: string;
}): Promise<string> => {
  const body = await upJson(
    "/uploadposts/users/generate-jwt",
    z.object({ access_url: z.string().optional() }),
    jsonInit({
      username: args.username,
      platforms: ["instagram"],
      redirect_url: args.redirectUrl,
      redirect_button_text: "Voltar para a Vanda",
      connect_title: "Conecte seu Instagram",
      connect_description: "A Vanda publica no seu Instagram somente com a sua aprovação.",
      language: "pt",
      show_calendar: false,
    }),
  );

  if (!body.access_url) throw new Error("upload-post generate-jwt sem access_url");

  return body.access_url;
};

export interface PublishPhotosResult {
  /** Instagram media id (used later for analytics); null when absent. */
  externalPostId: string | null;
  /** Public permalink when the API returns one. */
  url: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Recover the receipt of a just-completed async upload from the history feed. */
const receiptFromHistory = async (username: string): Promise<PublishPhotosResult> => {
  const response = await upFetch("/uploadposts/history");

  if (!response.ok) return { externalPostId: null, url: null };

  const body = z
    .object({
      history: z
        .array(
          z.object({
            profile_username: z.string().optional(),
            platform: z.string().optional(),
            success: z.boolean().optional(),
            platform_post_id: z.string().nullable().optional(),
            post_url: z.string().nullable().optional(),
          }),
        )
        .default([]),
    })
    .nullable()
    .catch(null)
    .parse(await response.json().catch(() => null));

  const item = (body?.history ?? []).find(
    (entry) =>
      entry.profile_username === username && entry.platform === "instagram" && entry.success,
  );

  return { externalPostId: item?.platform_post_id ?? null, url: item?.post_url ?? null };
};

/** Poll an async upload until it settles; returns the receipt or throws. */
const awaitAsyncUpload = async (
  username: string,
  requestId: string,
): Promise<PublishPhotosResult> => {
  const deadline = Date.now() + 4 * 60_000;

  for (;;) {
    await sleep(5_000);

    const response = await upFetch(
      `/uploadposts/status?request_id=${encodeURIComponent(requestId)}`,
    );

    const body = z
      .object({
        status: z.string().optional(),
        results: z
          .array(
            z.object({
              platform: z.string().optional(),
              success: z.boolean().optional(),
              message: z.string().optional(),
            }),
          )
          .optional(),
      })
      .nullable()
      .catch(null)
      .parse(await response.json().catch(() => null));

    // Result rows exist as placeholders while the job runs — only judge
    // success/failure once the aggregated status settles.
    if (body?.status === "completed") {
      const result = body.results?.find((entry) => entry.platform === "instagram");

      if (result !== undefined && result.success !== true) {
        throw new Error(result.message ?? "upload-post: publicação assíncrona falhou");
      }

      return receiptFromHistory(username);
    }

    if (Date.now() > deadline) {
      throw new Error("upload-post: publicação assíncrona não concluiu a tempo");
    }
  }
};

/**
 * Publish a photo post (single image or carousel) to Instagram. Media is
 * fetched from our storage URLs and re-sent as multipart binary — the
 * endpoint takes files, not URLs. Large payloads (multi-slide carousels)
 * flip the API into async mode; we poll status until the post settles.
 */
export const publishPhotos = async (args: {
  username: string;
  caption: string;
  imageUrls: readonly string[];
}): Promise<PublishPhotosResult> => {
  const form = new FormData();
  form.append("user", args.username);
  form.append("platform[]", "instagram");
  form.append("title", args.caption);

  for (const [index, url] of args.imageUrls.entries()) {
    const media = await fetch(url);

    if (!media.ok) throw new Error(`mídia inacessível (HTTP ${media.status})`);
    const blob = await media.blob();
    form.append("photos[]", blob, `slide-${index + 1}.jpg`);
  }

  const body = await upJson(
    "/upload_photos",
    z.object({
      success: z.boolean().optional(),
      request_id: z.string().optional(),
      results: z
        .record(
          z.string(),
          z.object({
            success: z.boolean().optional(),
            post_id: z.string().optional(),
            url: z.string().optional(),
            error: z.string().optional(),
          }),
        )
        .optional(),
    }),
    { method: "POST", body: form },
  );

  const result = body.results?.["instagram"];

  if (result !== undefined) {
    if (!result.success) {
      throw new Error(result.error ?? "upload-post: publicação no Instagram falhou");
    }

    return { externalPostId: result.post_id ?? null, url: result.url ?? null };
  }

  if (body.request_id !== undefined) {
    return awaitAsyncUpload(args.username, body.request_id);
  }

  throw new Error("upload-post: resposta sem resultado nem request_id");
};

export interface PostMetrics {
  views: number;
  likes: number;
  comments: number;
}

/**
 * Cached per-post analytics for a profile, keyed by external post id.
 * Returns an empty map when the endpoint has nothing (fresh connection,
 * plan limits) — metrics are best-effort by design.
 */
export const getPostAnalytics = async (username: string): Promise<Map<string, PostMetrics>> => {
  const response = await upFetch(
    `/uploadposts/post-analytics/cached?user=${encodeURIComponent(username)}&platform=instagram`,
  );

  if (!response.ok) return new Map();

  const body = z
    .object({
      posts: z
        .array(
          z.object({
            post_id: z.string().optional(),
            metrics: z
              .object({
                views: z.number().catch(0),
                plays: z.number().catch(0),
                impressions: z.number().catch(0),
                likes: z.number().catch(0),
                like_count: z.number().catch(0),
                comments: z.number().catch(0),
                comments_count: z.number().catch(0),
              })
              .default({
                views: 0,
                plays: 0,
                impressions: 0,
                likes: 0,
                like_count: 0,
                comments: 0,
                comments_count: 0,
              }),
          }),
        )
        .default([]),
    })
    .nullable()
    .catch(null)
    .parse(await response.json().catch(() => null));

  const map = new Map<string, PostMetrics>();

  for (const post of body?.posts ?? []) {
    if (!post.post_id) continue;
    const metrics = post.metrics;
    map.set(post.post_id, {
      views: metrics.views || metrics.plays || metrics.impressions,
      likes: metrics.likes || metrics.like_count,
      comments: metrics.comments || metrics.comments_count,
    });
  }

  return map;
};
