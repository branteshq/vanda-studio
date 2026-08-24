import { slugify } from "../workspace/types";

export type InstagramOperation =
  | "search_profiles"
  | "profile"
  | "posts"
  | "post"
  | "comments"
  | "insights";

const TTL_MS: Record<InstagramOperation, number> = {
  search_profiles: 6 * 60 * 60_000,
  profile: 24 * 60 * 60_000,
  posts: 4 * 60 * 60_000,
  post: 60 * 60_000,
  comments: 20 * 60_000,
  insights: 45 * 60_000,
};

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
};

/** Stable cache identity without putting provider credentials into the key. */
export const instagramRequestKey = (operation: InstagramOperation, input: unknown): string =>
  `${operation}:${JSON.stringify(stable(input))}`;

export const instagramExpiresAt = (operation: InstagramOperation, observedAt: number): number =>
  observedAt + TTL_MS[operation];

export const instagramWorkspacePath = (input: {
  readonly operation: InstagramOperation;
  readonly scope?: "connected" | "public" | undefined;
  readonly handle?: string | undefined;
  readonly query?: string | undefined;
  readonly postId?: string | undefined;
  readonly postUrl?: string | undefined;
}): string => {
  if (input.operation === "search_profiles") {
    return `/instagram/searches/${slugify(input.query ?? "search")}.json`;
  }
  if (
    input.operation === "post" ||
    input.operation === "comments" ||
    (input.operation === "insights" && input.postId)
  ) {
    const shortcode = input.postUrl?.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/i)?.[1];
    const postName = slugify(shortcode ?? input.postId ?? "post");
    const filename = input.operation === "post" ? "post" : input.operation;
    return `/instagram/posts/${postName}/${filename}.json`;
  }
  if (input.scope === "connected") {
    return `/instagram/self/${input.operation}.json`;
  }
  return `/instagram/public/${slugify(input.handle ?? "profile")}/${input.operation}.json`;
};
