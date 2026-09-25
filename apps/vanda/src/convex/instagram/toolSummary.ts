import type { ContextHandler } from "@convex-dev/agent";
import { z } from "zod";

type ModelMessage = Parameters<ContextHandler>[1]["allMessages"][number];

import type { InstagramOperation } from "./cache";

/** Budget for the JSON data preview, not a provider fetch or workspace limit. */
export const INSTAGRAM_PREVIEW_MAX_CHARS = 8_000;

const MAX_ITEMS = 20;

const MAX_STRING_CHARS = 512;

type Scalar = string | number | boolean | null;

type JsonValue =
  | Scalar
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue | undefined };

type PreviewItem = Record<string, Scalar | Record<string, Scalar>>;

const jsonRecordSchema = z.record(z.string(), z.json());

const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

const record = (value: JsonValue | undefined) => jsonRecordSchema.catch({}).parse(value);

const select = (value: JsonValue | undefined, fields: readonly string[]) => {
  const input = record(value);
  const output: Record<string, Scalar> = {};

  for (const key of fields) {
    const parsed = scalarSchema.safeParse(input[key]);

    if (!parsed.success) continue;
    const stringValue = z.string().safeParse(parsed.data);

    if (stringValue.success) {
      output[key] =
        stringValue.data.length > MAX_STRING_CHARS
          ? `${stringValue.data.slice(0, MAX_STRING_CHARS)}…`
          : stringValue.data;
    } else {
      output[key] = parsed.data;
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

const projectItem = (operation: InstagramOperation, value: JsonValue | undefined): PreviewItem => {
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
export const summarizeInstagramResult = <Input>(operation: InstagramOperation, value: Input) => {
  const observation = record(z.json().parse(value));
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

  const summary = {
    ...select(observation, ["source", "observedAt", "completeness", "costUsd", "cached"]),
    data: isList ? items : (items[0] ?? null),
    preview: {
      totalItems,
      shownItems: items.length,
      omittedItems: totalItems - items.length,
      notice:
        "Resumo limitado: textos podem estar cortados; posts aninhados, mídia, respostas e demografia foram omitidos. Dados completos em savedTo. Use read com offset/limit para consultar os trechos relevantes.",
    },
  };

  // These are durable locators/cursors, not prose: preserve them exactly.
  const savedTo = z.string().safeParse(observation.savedTo);
  const nextCursor = z.string().safeParse(observation.nextCursor);

  return {
    ...summary,
    ...optionalString("savedTo", savedTo.success ? savedTo.data : undefined),
    ...optionalString("nextCursor", nextCursor.success ? nextCursor.data : undefined),
  };
};

const optionalString = <K extends string>(key: K, value: string | undefined) => {
  const result: Partial<Record<K, string>> = {};

  if (value !== undefined) result[key] = value;

  return result;
};

const TOOL_OPERATIONS = new Map<string, InstagramOperation>([
  ["search_instagram_profiles", "search_profiles"],
  ["read_instagram_profile", "profile"],
  ["read_instagram_posts", "posts"],
  ["read_instagram_post", "post"],
  ["read_instagram_comments", "comments"],
  ["read_instagram_metrics", "insights"],
]);

/** Compact legacy tool history on read, without modifying stored messages. */
export const compactInstagramHistory = (messages: ModelMessage[]): ModelMessage[] =>
  messages.map((message) => {
    if (message.role !== "tool") return message;

    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result") return part;
        const operation = TOOL_OPERATIONS.get(part.toolName);

        if (!operation || part.output.type !== "json") return part;
        const output = record(part.output.value);
        const wrapped = Array.isArray(output.resources) && Array.isArray(output.presented);
        const observation = wrapped ? record(output.data) : output;

        if (!z.string().safeParse(observation.savedTo).success) return part;

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
