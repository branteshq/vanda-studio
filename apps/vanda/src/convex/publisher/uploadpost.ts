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
    throw new Error(`upload-post ${path} HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
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

/** Create the profile if it doesn't exist yet (idempotent). */
export const ensureProfile = async (username: string): Promise<void> => {
  const response = await upFetch("/uploadposts/users", jsonInit({ username }));
  if (response.ok) return;
  // "Already exists" is success for our purposes — 409, or the message
  // wording ("Username already in use" / "already exists").
  const body = await response.text().catch(() => "");
  if (response.status === 409 || /already in use|exist/i.test(body)) return;
  throw new Error(`upload-post create profile HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
};

export const getProfile = async (username: string): Promise<PublisherProfile | null> => {
  const response = await upFetch(`/uploadposts/users/${encodeURIComponent(username)}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`upload-post get profile HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
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

/**
 * Publish a photo post (single image or carousel) to Instagram. Media is
 * fetched from our storage URLs and re-sent as multipart binary — the
 * endpoint takes files, not URLs. Synchronous: resolves when published.
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
    results?: Record<string, { success?: boolean; post_id?: string; url?: string; error?: string }>;
  }>("/upload_photos", { method: "POST", body: form });
  const result = body.results?.["instagram"];
  if (!result?.success) {
    throw new Error(result?.error ?? "upload-post: publicação no Instagram falhou");
  }
  return { externalPostId: result.post_id ?? null, url: result.url ?? null };
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
export const getPostAnalytics = async (
  username: string,
): Promise<Map<string, PostMetrics>> => {
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
