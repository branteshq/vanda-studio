/**
 * Upload-Post adapter — the publisher port's only implementation. One org
 * API key (UPLOADPOST_API_KEY); each Vanda account maps to one Upload-Post
 * "profile" (username = the Convex account id), and customers connect their
 * social accounts through a white-label OAuth page we mint per profile.
 * Their tokens live inside Upload-Post — nothing sensitive is stored here.
 */

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

const upJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await upFetch(path, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `upload-post ${path} HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`,
    );
  }
  return response.json() as Promise<T>;
};

const jsonInit = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export interface PublisherProfile {
  username: string;
  /** Platform → connection info; a non-empty value means connected. */
  socialAccounts: Record<string, unknown>;
}

interface RawProfileResponse {
  profile?: { username?: string; social_accounts?: Record<string, unknown> };
  // GET /users/{username} responses have been observed both wrapped and flat.
  username?: string;
  social_accounts?: Record<string, unknown>;
}

const parseProfile = (raw: RawProfileResponse): PublisherProfile => {
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
const usernameOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" && !/^\d+$/.test(value.trim())
    ? value.trim()
    : null;

/** Instagram connection state of a profile. The entry is a rich object on the
 * list/get endpoints but can be a flat string (sometimes the numeric account
 * id) right after connecting — a numeric id counts as connected, handle-less. */
export const instagramStateOf = (profile: PublisherProfile): InstagramState => {
  const entry = profile.socialAccounts["instagram"];
  if (typeof entry === "string") {
    return entry.trim() === ""
      ? { connected: false, username: null }
      : { connected: true, username: usernameOrNull(entry) };
  }
  if (entry && typeof entry === "object") {
    const fields = entry as { handle?: unknown; display_name?: unknown; username?: unknown };
    return {
      connected: true,
      username:
        usernameOrNull(fields.handle) ??
        usernameOrNull(fields.username) ??
        usernameOrNull(fields.display_name),
    };
  }
  return { connected: false, username: null };
};

/** Profile fields exposed alongside the Instagram OAuth connection. */
export const instagramProfileInfoOf = (profile: PublisherProfile): InstagramProfileInfo => {
  const state = instagramStateOf(profile);
  const entry = profile.socialAccounts["instagram"];
  if (!entry || typeof entry !== "object") return { ...state, displayName: state.username };
  const fields = entry as { display_name?: unknown; name?: unknown };
  return {
    ...state,
    displayName:
      usernameOrNull(fields.display_name) ?? usernameOrNull(fields.name) ?? state.username,
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
  return parseProfile((await response.json()) as RawProfileResponse);
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
}

const stringOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const finiteNumberOf = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

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
  const raw = await upJson<{
    media?: ReadonlyArray<Record<string, unknown>>;
    pagination?: Record<string, unknown>;
  }>(
    queryPath("/uploadposts/media", {
      platform: "instagram",
      user: username,
      limit: options.limit,
      cursor: options.cursor,
    }),
  );
  const media = (Array.isArray(raw.media) ? raw.media : []).flatMap((item) => {
    const id = stringOf(item["id"]);
    if (id === null) return [];
    return [
      {
        id,
        caption: stringOf(item["caption"]),
        mediaType: stringOf(item["media_type"]),
        mediaUrl: stringOf(item["media_url"]),
        permalink: stringOf(item["permalink"]),
        timestamp: stringOf(item["timestamp"]),
        thumbnailUrl: stringOf(item["thumbnail_url"]),
      },
    ];
  });
  const pagination = raw.pagination ?? {};
  return {
    media,
    pagination: {
      limit: finiteNumberOf(pagination["limit"]) ?? options.limit ?? 25,
      nextCursor: stringOf(pagination["next_cursor"]),
      hasMore: pagination["has_more"] === true,
    },
  };
};

/** Read one page of comments under a post owned by the connected account. */
export const getInstagramComments = async (
  username: string,
  postId: string,
  options: { readonly limit?: number; readonly after?: string } = {},
): Promise<InstagramCommentsPage> => {
  const raw = await upJson<{
    comments?: ReadonlyArray<Record<string, unknown>>;
    pagination?: Record<string, unknown>;
  }>(
    queryPath("/uploadposts/comments", {
      platform: "instagram",
      user: username,
      post_id: postId,
      limit: options.limit,
      after: options.after,
    }),
  );
  const comments = (Array.isArray(raw.comments) ? raw.comments : []).flatMap((item) => {
    const id = stringOf(item["id"]);
    const text = stringOf(item["text"]);
    if (id === null || text === null) return [];
    const user = item["user"];
    return [
      {
        id,
        text,
        timestamp: stringOf(item["timestamp"]),
        username:
          user && typeof user === "object"
            ? stringOf((user as Record<string, unknown>)["username"])
            : null,
      },
    ];
  });
  const pagination = raw.pagination ?? {};
  return {
    comments,
    pagination: {
      nextCursor: stringOf(pagination["next_cursor"]),
      hasNext: pagination["has_next"] === true,
    },
  };
};

/** Read current account-level Instagram analytics. */
export const getInstagramAnalytics = async (username: string): Promise<InstagramAnalytics> => {
  const raw = await upJson<Record<string, unknown>>(
    queryPath(`/analytics/${encodeURIComponent(username)}`, { platforms: "instagram" }),
  );
  const instagram =
    raw["instagram"] && typeof raw["instagram"] === "object"
      ? (raw["instagram"] as Record<string, unknown>)
      : {};
  return {
    followers: finiteNumberOf(instagram["followers"]),
    reach: finiteNumberOf(instagram["reach"]),
    views: finiteNumberOf(instagram["views"] ?? instagram["impressions"]),
    profileViews: finiteNumberOf(instagram["profileViews"]),
    likes: finiteNumberOf(instagram["likes"]),
    comments: finiteNumberOf(instagram["comments"]),
    shares: finiteNumberOf(instagram["shares"]),
    saves: finiteNumberOf(instagram["saves"]),
  };
};

/** Mint the white-label connect page URL the customer opens to link Instagram. */
export const generateConnectUrl = async (args: {
  username: string;
  redirectUrl: string;
}): Promise<string> => {
  const body = await upJson<{ access_url?: string }>(
    "/uploadposts/users/generate-jwt",
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
  const body = (await response.json().catch(() => null)) as {
    history?: Array<{
      profile_username?: string;
      platform?: string;
      success?: boolean;
      platform_post_id?: string | null;
      post_url?: string | null;
    }>;
  } | null;
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
    const body = (await response.json().catch(() => null)) as {
      status?: string;
      results?: Array<{ platform?: string; success?: boolean; message?: string }>;
    } | null;
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
  const body = await upJson<{
    success?: boolean;
    request_id?: string;
    results?: Record<string, { success?: boolean; post_id?: string; url?: string; error?: string }>;
  }>("/upload_photos", { method: "POST", body: form });
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

const numberOf = (value: unknown): number => (typeof value === "number" ? value : 0);

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
  const body = (await response.json().catch(() => null)) as {
    posts?: Array<{ post_id?: string; metrics?: Record<string, unknown> }>;
  } | null;
  const map = new Map<string, PostMetrics>();
  for (const post of body?.posts ?? []) {
    if (!post.post_id) continue;
    const metrics = post.metrics ?? {};
    map.set(post.post_id, {
      views: numberOf(metrics["views"] ?? metrics["plays"] ?? metrics["impressions"]),
      likes: numberOf(metrics["likes"] ?? metrics["like_count"]),
      comments: numberOf(metrics["comments"] ?? metrics["comments_count"]),
    });
  }
  return map;
};
