import { type Infer, v } from "convex/values";
import { z } from "zod";

export const operationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const threadResourceValidator = v.union(
  v.object({
    kind: v.literal("image"),
    accountId: v.id("accounts"),
    imageId: v.id("images"),
  }),
  v.object({
    kind: v.literal("post"),
    accountId: v.id("accounts"),
    postId: v.id("posts"),
  }),
  v.object({
    kind: v.literal("document"),
    accountId: v.id("accounts"),
    path: v.string(),
    title: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("link"),
    url: v.string(),
    title: v.string(),
  }),
  v.object({
    kind: v.literal("operation"),
    operation: v.string(),
    status: operationStatusValidator,
    label: v.string(),
    operationId: v.optional(v.string()),
    accountId: v.optional(v.id("accounts")),
  }),
);

export type ThreadResource = Infer<typeof threadResourceValidator>;

const operationStatusSchema = z.enum(["pending", "running", "succeeded", "failed", "cancelled"]);

export const threadResourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), accountId: z.string(), imageId: z.string() }),
  z.object({ kind: z.literal("post"), accountId: z.string(), postId: z.string() }),
  z.object({
    kind: z.literal("document"),
    accountId: z.string(),
    path: z.string(),
    title: z.string().optional(),
  }),
  z.object({ kind: z.literal("link"), url: z.string().url(), title: z.string() }),
  z.object({
    kind: z.literal("operation"),
    operation: z.string(),
    status: operationStatusSchema,
    label: z.string(),
    operationId: z.string().optional(),
    accountId: z.string().optional(),
  }),
]);

export const presentableResourceInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), imageId: z.string() }),
  z.object({ kind: z.literal("post"), postId: z.string() }),
  z.object({ kind: z.literal("document"), path: z.string(), title: z.string().optional() }),
  z.object({ kind: z.literal("link"), url: z.string().url(), title: z.string() }),
]);

export type PresentableResourceInput = z.infer<typeof presentableResourceInputSchema>;

export interface CapabilityResult<Data = unknown> {
  readonly data: Data;
  /** Resources read or produced by the capability. */
  readonly resources: readonly ThreadResource[];
  /** The subset that the thread should render for the user. */
  readonly presented: readonly ThreadResource[];
  readonly summary?: string | undefined;
}

export const capabilityResultSchema = z.object({
  data: z.unknown(),
  resources: z.array(threadResourceSchema),
  presented: z.array(threadResourceSchema),
  summary: z.string().optional(),
});

export const capabilityResult = <Data>(
  data: Data,
  options: {
    readonly resources?: readonly ThreadResource[];
    readonly presented?: readonly ThreadResource[];
    readonly summary?: string | undefined;
  } = {},
): CapabilityResult<Data> => ({
  data,
  resources: options.resources ?? [],
  presented: options.presented ?? [],
  ...(options.summary ? { summary: options.summary } : {}),
});

export const resourceKey = (resource: ThreadResource): string => {
  switch (resource.kind) {
    case "image":
      return `image:${resource.accountId}:${resource.imageId}`;
    case "post":
      return `post:${resource.accountId}:${resource.postId}`;
    case "document":
      return `document:${resource.accountId}:${resource.path}`;
    case "link":
      return `link:${resource.url}`;
    case "operation":
      return `operation:${resource.operationId ?? resource.operation}:${resource.status}`;
  }
};

export const dedupeResources = (resources: readonly ThreadResource[]): ThreadResource[] => {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = resourceKey(resource);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
