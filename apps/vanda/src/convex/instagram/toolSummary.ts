import type { ContextHandler } from "@convex-dev/agent";

type ModelMessage = Parameters<ContextHandler>[1]["allMessages"][number];
import type { InstagramOperation } from "./cache";

/** Budget for the JSON data preview, not a provider fetch or workspace limit. */
export const INSTAGRAM_PREVIEW_MAX_CHARS = 8_000;
const MAX_ITEMS = 20;
const MAX_STRING_CHARS = 512;

type Scalar = string | number | boolean | null;
type PreviewItem = Record<string, Scalar | Record<string, Scalar>>;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const select = (value: unknown, fields: readonly string[]): Record<string, Scalar> => {
  const input = record(value);
  const output: Record<string, Scalar> = {};
  for (const key of fields) {
    const item = input[key];
    if (typeof item === "string") {
      output[key] = item.length > MAX_STRING_CHARS ? `${item.slice(0, MAX_STRING_CHARS)}…` : item;
    } else if (typeof item === "boolean" || item === null) {
      output[key] = item;
    } else if (typeof item === "number" && Number.isFinite(item)) {
      output[key] = item;
    }
  }
  return output;
};

const FIELDS: Record<InstagramOperation, readonly string[]> = {
  search_profiles: [
    "id",
    "handle",
    "name",
    "biography",
    "followers",
    "following",
    "postsCount",
    "private",
    "verified",
    "category",
    "website",
  ],
  profile: [
    "id",
    "handle",
    "name",
    "biography",
    "followers",
    "following",
    "postsCount",
    "private",
    "verified",
    "category",
    "website",
  ],
  posts: [
    "id",
    "url",
    "shortcode",
    "ownerHandle",
    "caption",
    "publishedAt",
    "mediaType",
    "durationSeconds",
  ],
  post: [
    "id",
    "url",
    "shortcode",
    "ownerHandle",
    "caption",
    "publishedAt",
    "mediaType",
    "durationSeconds",
    "transcript",
  ],
  comments: ["id", "text", "username", "timestamp", "likes"],
  insights: ["kind", "postId", "followers"],
};

const projectItem = (operation: InstagramOperation, value: unknown): PreviewItem => {
  const input = record(value);
  const item: PreviewItem = select(input, FIELDS[operation]);
  if (operation === "posts" || operation === "post" || operation === "insights") {
    item.publicEngagement = select(input.publicEngagement, [
      "likes",
      "comments",
      "views",
      "plays",
      "shares",
    ]);
    item.privateInsights = select(input.privateInsights, [
      "reach",
      "impressions",
      "saves",
      "accountsEngaged",
    ]);
  }
  if (Array.isArray(input.latestPosts)) item.latestPostsCount = input.latestPosts.length;
  if (Array.isArray(input.replies)) item.repliesCount = input.replies.length;
  if (input.demographics !== undefined) item.demographicsAvailable = true;
  return item;
};

/**
 * Called AFTER the action saves the full observation. Only this projection
 * enters tool history; cached responses follow the same path. Never spread
 * provider data here: nested posts and media URLs caused a 400k-token prompt.
 */
export const summarizeInstagramResult = (operation: InstagramOperation, value: unknown) => {
  const observation = record(value);
  const input = observation.data;
  const isList = Array.isArray(input);
  const totalItems = isList ? input.length : 1;
  const items = (isList ? input.slice(0, MAX_ITEMS) : [input]).map((item) =>
    projectItem(operation, item),
  );
  // Count serialized characters so escaped strings cannot bypass the budget.
  while (
    items.length &&
    JSON.stringify(isList ? items : items[0]).length > INSTAGRAM_PREVIEW_MAX_CHARS
  ) {
    items.pop();
  }
  return {
    ...select(observation, ["source", "observedAt", "completeness", "costUsd", "cached"]),
    // These are durable locators/cursors, not prose: preserve them exactly.
    ...(typeof observation.savedTo === "string" ? { savedTo: observation.savedTo } : {}),
    ...(typeof observation.nextCursor === "string" ? { nextCursor: observation.nextCursor } : {}),
    data: isList ? items : (items[0] ?? null),
    preview: {
      totalItems,
      shownItems: items.length,
      omittedItems: totalItems - items.length,
      notice:
        "Resumo limitado: textos podem estar cortados; posts aninhados, mídia, respostas e demografia foram omitidos. Dados completos em savedTo. Use run_code com inputPaths para analisar o arquivo completo sem copiá-lo para a conversa.",
    },
  };
};

const TOOL_OPERATIONS: Record<string, InstagramOperation> = {
  search_instagram_profiles: "search_profiles",
  read_instagram_profile: "profile",
  read_instagram_posts: "posts",
  read_instagram_post: "post",
  read_instagram_comments: "comments",
  read_instagram_metrics: "insights",
};

/** Compact legacy tool history on read, without modifying stored messages. */
export const compactInstagramHistory = (messages: ModelMessage[]): ModelMessage[] =>
  messages.map((message) => {
    if (message.role !== "tool") return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result") return part;
        const operation = TOOL_OPERATIONS[part.toolName];
        if (!operation || part.output.type !== "json") return part;
        const output = record(part.output.value);
        const wrapped = Array.isArray(output.resources) && Array.isArray(output.presented);
        const observation = wrapped ? record(output.data) : output;
        if (typeof observation.savedTo !== "string") return part;
        // New tool results are already bounded. Re-projecting would lose counts.
        if (observation.preview !== undefined) return part;
        const summary = summarizeInstagramResult(operation, observation);
        return {
          ...part,
          output: {
            type: "json" as const,
            value: wrapped ? { ...output, data: summary } : summary,
          },
        };
      }),
    };
  });
