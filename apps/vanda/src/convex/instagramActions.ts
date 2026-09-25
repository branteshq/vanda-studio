"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import {
  instagramExpiresAt,
  instagramRequestKey,
  instagramWorkspacePath,
  type InstagramOperation,
} from "./instagram/cache";
import { apifyInstagramCostUsd } from "./instagram/costs";
import { liveInstagramLayer } from "./instagram/live";
import { InstagramService, type InstagramServiceApi } from "./instagram/service";
import type {
  InstagramComment,
  InstagramInsights,
  InstagramObservation,
  InstagramPost,
  InstagramProfile,
  InstagramTarget,
} from "./instagram/types";
import { publicError } from "../errors";
import { agentActivityIdValidator, type AgentActivityId } from "./agentActivity";

const MAX_SEARCH = 20;

const MAX_POSTS = 100;

const MAX_COMMENTS = 50;

const MAX_PUBLIC_ITEMS_PER_ACCOUNT_PER_DAY = 1_000;

interface ActionObservation<T> extends InstagramObservation<T> {
  readonly savedTo: string;
  readonly cached: boolean;
}

interface MutableActionObservation<T> {
  data: T;
  source: InstagramObservation<T>["source"];
  observedAt: number;
  completeness: InstagramObservation<T>["completeness"];
  savedTo: string;
  cached: boolean;
  costUsd?: number;
  nextCursor?: string;
}

interface ObservationSaveInput {
  accountId: Id<"accounts">;
  activityId?: AgentActivityId;
  activityIdentity?: { requestId: string; threadId: string };
  requestKey: string;
  operation: InstagramOperation;
  target: string;
  workspacePath: string;
  source: InstagramObservation<never>["source"];
  completeness: InstagramObservation<never>["completeness"];
  payload: unknown;
  itemCount: number;
  observedAt: number;
  expiresAt: number;
  costUsd?: number;
  nextCursor?: string;
}

interface PostsRequest extends InstagramRequestRecord {
  target: InstagramTarget;
  limit: number;
  cursor?: string;
}

interface CommentsRequest extends PostsRequest {
  postId?: string;
  postUrl?: string;
}

interface InsightsRequest extends InstagramRequestRecord {
  target: Extract<InstagramTarget, { scope: "connected" }>;
  postId?: string;
}

interface InstagramRequestRecord {
  readonly [key: string]: InstagramRequest;
}

type InstagramRequest =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<InstagramRequest>
  | InstagramRequestRecord;

const engagementSchema = z.object({
  likes: z.number().optional(),
  comments: z.number().optional(),
  views: z.number().optional(),
  plays: z.number().optional(),
  shares: z.number().optional(),
});

const privateInsightsSchema = z.object({
  reach: z.number().optional(),
  impressions: z.number().optional(),
  saves: z.number().optional(),
  accountsEngaged: z.number().optional(),
});

const postSchema: z.ZodType<InstagramPost> = z.object({
  id: z.string(),
  url: z.string(),
  shortcode: z.string().optional(),
  ownerHandle: z.string().optional(),
  caption: z.string().optional(),
  publishedAt: z.number().optional(),
  mediaType: z.enum(["image", "video", "carousel", "unknown"]),
  mediaUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  transcript: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  mentions: z.array(z.string()).optional(),
  durationSeconds: z.number().optional(),
  publicEngagement: engagementSchema,
  privateInsights: privateInsightsSchema.optional(),
});

const profileSchema: z.ZodType<InstagramProfile> = z.object({
  id: z.string().optional(),
  handle: z.string(),
  name: z.string().optional(),
  biography: z.string().optional(),
  website: z.string().optional(),
  category: z.string().optional(),
  profileImageUrl: z.string().optional(),
  followers: z.number().optional(),
  following: z.number().optional(),
  postsCount: z.number().optional(),
  private: z.boolean().optional(),
  verified: z.boolean().optional(),
  latestPosts: z.array(postSchema).optional(),
});

const profilesSchema: z.ZodType<ReadonlyArray<InstagramProfile>> = z.array(profileSchema);

const postsSchema: z.ZodType<ReadonlyArray<InstagramPost>> = z.array(postSchema);

const commentSchema: z.ZodType<InstagramComment> = z.lazy(() =>
  z.object({
    id: z.string(),
    text: z.string(),
    username: z.string().optional(),
    timestamp: z.number().optional(),
    likes: z.number().optional(),
    replies: z.array(commentSchema).optional(),
  }),
);

const commentsSchema: z.ZodType<ReadonlyArray<InstagramComment>> = z.array(commentSchema);

const insightsSchema: z.ZodType<InstagramInsights> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("account"),
    followers: z.number().optional(),
    publicEngagement: engagementSchema,
    privateInsights: privateInsightsSchema,
    demographics: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal("post"),
    postId: z.string(),
    publicEngagement: engagementSchema,
    privateInsights: privateInsightsSchema,
  }),
]);

const publicHandle = (value: string | undefined): string => {
  const handle = value?.trim().replace(/^@/, "");

  if (!handle || !/^[a-zA-Z0-9._]{1,30}$/.test(handle)) {
    throw new Error("invalid Instagram handle");
  }

  return handle;
};

const postUrl = (value: string | undefined): string => {
  if (!value) throw new Error("Instagram post URL is required");
  const parsed = new URL(value);

  if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) {
    throw new Error("postUrl must be an instagram.com URL");
  }

  return parsed.toString();
};

const connectedTarget = async (
  ctx: ActionCtx,
  accountId: Id<"accounts">,
): Promise<Extract<InstagramTarget, { scope: "connected" }>> => {
  const target: { publisherUsername: string; handle: string } = await ctx.runQuery(
    internal.instagramData.resolveConnectedTarget,
    { accountId },
  );

  return { scope: "connected", ...target };
};

const cachedRead = async <Data>(
  ctx: ActionCtx,
  input: {
    readonly accountId: Id<"accounts">;
    readonly activityId?: AgentActivityId | undefined;
    readonly operation: InstagramOperation;
    readonly request: InstagramRequest;
    readonly target: string;
    readonly workspacePath: string;
    readonly requirePublicProvider: boolean;
    readonly maxPublicItems?: number | undefined;
    readonly dataSchema: z.ZodType<Data>;
    readonly run: (
      service: InstagramServiceApi,
    ) => Effect.Effect<InstagramObservation<Data>, unknown>;
  },
): Promise<ActionObservation<Data>> => {
  const requestKey = instagramRequestKey(input.operation, input.request);

  const activityIdentity = input.activityId
    ? await ctx.runQuery(internal.instagramData.authorizeActivity, {
        accountId: input.accountId,
        activityId: input.activityId,
      })
    : undefined;

  const cached = await ctx.runQuery(internal.instagramData.readCachedObservation, {
    accountId: input.accountId,
    requestKey,
    now: Date.now(),
  });

  if (cached) {
    const result: MutableActionObservation<Data> = {
      data: input.dataSchema.parse(cached.payload),
      source: cached.source,
      observedAt: cached.observedAt,
      completeness: cached.completeness,
      savedTo: cached.workspacePath,
      cached: true,
    };

    if (cached.costUsd !== undefined) result.costUsd = cached.costUsd;

    if (cached.nextCursor) result.nextCursor = cached.nextCursor;

    return result;
  }

  const apifyToken = process.env.APIFY_API_TOKEN ?? "";

  if (input.requirePublicProvider && !apifyToken) {
    throw new Error("APIFY_API_TOKEN is not set on the Convex deployment");
  }

  if (input.requirePublicProvider) {
    const maxPublicItems = input.maxPublicItems ?? 1;

    const [used, budget] = await Promise.all([
      ctx.runQuery(internal.instagramData.publicReadItemsSince, {
        accountId: input.accountId,
        since: Date.now() - 24 * 60 * 60_000,
      }),
      ctx.runQuery(internal.usage.budget, { accountId: input.accountId }),
    ]);

    if (used + maxPublicItems > MAX_PUBLIC_ITEMS_PER_ACCOUNT_PER_DAY) {
      throw new Error("limite diário de leituras públicas do Instagram atingido");
    }

    const projectedMicroUsd = Math.round(apifyInstagramCostUsd(maxPublicItems) * 1_000_000);

    if (
      !budget.ok ||
      (budget.periodKey !== "none" &&
        budget.spentMicroUsd + projectedMicroUsd > budget.allowanceMicroUsd)
    ) {
      throw publicError("USAGE_LIMIT");
    }
  }

  const observation = await Effect.runPromise(
    Effect.flatMap(InstagramService, input.run).pipe(
      Effect.provide(liveInstagramLayer(apifyToken)),
    ),
  );

  const itemCount = Array.isArray(observation.data) ? observation.data.length : 1;
  const costUsd = input.requirePublicProvider ? apifyInstagramCostUsd(itemCount) : undefined;

  const saveInput: ObservationSaveInput = {
    accountId: input.accountId,
    requestKey,
    operation: input.operation,
    target: input.target,
    workspacePath: input.workspacePath,
    source: observation.source,
    completeness: observation.completeness,
    payload: observation.data,
    itemCount,
    observedAt: observation.observedAt,
    expiresAt: instagramExpiresAt(input.operation, observation.observedAt),
  };

  if (costUsd !== undefined) saveInput.costUsd = costUsd;

  if (input.activityId) {
    saveInput.activityId = input.activityId;
    saveInput.activityIdentity = activityIdentity!;
  }

  if (observation.nextCursor) saveInput.nextCursor = observation.nextCursor;

  const saved = await ctx.runMutation(internal.instagramData.saveObservation, saveInput);

  if (saved.cancelled) throw new Error("leitura do Instagram interrompida pelo dono");

  const result: MutableActionObservation<Data> = {
    data: observation.data,
    source: observation.source,
    observedAt: observation.observedAt,
    completeness: observation.completeness,
    savedTo: input.workspacePath,
    cached: false,
  };

  if (costUsd !== undefined) result.costUsd = costUsd;

  if (observation.nextCursor) result.nextCursor = observation.nextCursor;

  return result;
};

export const searchProfiles = internalAction({
  args: {
    accountId: v.id("accounts"),
    query: v.string(),
    limit: v.optional(v.number()),
    activityId: v.optional(agentActivityIdValidator),
  },
  handler: async (ctx, { accountId, query, limit, activityId }) => {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) throw new Error("empty Instagram search query");
    const boundedLimit = Math.max(1, Math.min(MAX_SEARCH, Math.floor(limit ?? 10)));

    return cachedRead(ctx, {
      accountId,
      operation: "search_profiles",
      activityId,
      request: { query: normalizedQuery, limit: boundedLimit },
      target: `search:${normalizedQuery}`,
      workspacePath: instagramWorkspacePath({
        operation: "search_profiles",
        query: normalizedQuery,
      }),
      requirePublicProvider: true,
      maxPublicItems: boundedLimit,
      dataSchema: profilesSchema,
      run: (service) => service.searchProfiles(normalizedQuery, boundedLimit),
    });
  },
});

export const readProfile = internalAction({
  args: {
    accountId: v.id("accounts"),
    activityId: v.optional(agentActivityIdValidator),
    scope: v.union(v.literal("connected"), v.literal("public")),
    handle: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, scope, handle, activityId }) => {
    const target: InstagramTarget =
      scope === "connected"
        ? await connectedTarget(ctx, accountId)
        : { scope: "public", handle: publicHandle(handle) };

    return cachedRead(ctx, {
      accountId,
      operation: "profile",
      activityId,
      request: target,
      target: target.scope === "connected" ? "self" : `public:${target.handle}`,
      workspacePath: instagramWorkspacePath({
        operation: "profile",
        scope: target.scope,
        handle: target.handle,
      }),
      requirePublicProvider: target.scope === "public",
      maxPublicItems: 1,
      dataSchema: profileSchema,
      run: (service) => service.readProfile(target),
    });
  },
});

export const listPosts = internalAction({
  args: {
    accountId: v.id("accounts"),
    activityId: v.optional(agentActivityIdValidator),
    scope: v.union(v.literal("connected"), v.literal("public")),
    handle: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, scope, handle, limit, cursor, activityId }) => {
    const target: InstagramTarget =
      scope === "connected"
        ? await connectedTarget(ctx, accountId)
        : { scope: "public", handle: publicHandle(handle) };

    const boundedLimit = Math.max(1, Math.min(MAX_POSTS, Math.floor(limit ?? 25)));

    const request: PostsRequest = {
      target,
      limit: boundedLimit,
    };

    if (cursor) request.cursor = cursor;

    return cachedRead(ctx, {
      accountId,
      operation: "posts",
      activityId,
      request,
      target: target.scope === "connected" ? "self" : `public:${target.handle}`,
      workspacePath: instagramWorkspacePath({
        operation: "posts",
        scope: target.scope,
        handle: target.handle,
      }),
      requirePublicProvider: target.scope === "public",
      maxPublicItems: boundedLimit,
      dataSchema: postsSchema,
      run: (service) => service.listPosts(target, request),
    });
  },
});

export const readPost = internalAction({
  args: {
    accountId: v.id("accounts"),
    activityId: v.optional(agentActivityIdValidator),
    postUrl: v.string(),
    includeTranscript: v.optional(v.boolean()),
  },
  handler: async (ctx, { accountId, postUrl: rawPostUrl, includeTranscript, activityId }) => {
    const url = postUrl(rawPostUrl);
    const transcript = includeTranscript ?? false;

    return cachedRead(ctx, {
      accountId,
      operation: "post",
      activityId,
      request: { postUrl: url, includeTranscript: transcript },
      target: `post:${url}`,
      workspacePath: instagramWorkspacePath({ operation: "post", postUrl: url }),
      requirePublicProvider: true,
      maxPublicItems: 1,
      dataSchema: postSchema,
      run: (service) => service.readPost(url, transcript),
    });
  },
});

export const listComments = internalAction({
  args: {
    accountId: v.id("accounts"),
    activityId: v.optional(agentActivityIdValidator),
    scope: v.union(v.literal("connected"), v.literal("public")),
    postId: v.optional(v.string()),
    postUrl: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { accountId, scope, postId, postUrl: rawPostUrl, limit, cursor, activityId },
  ) => {
    const target: InstagramTarget =
      scope === "connected"
        ? await connectedTarget(ctx, accountId)
        : { scope: "public", handle: "public" };

    const url = rawPostUrl ? postUrl(rawPostUrl) : undefined;

    if (scope === "connected" && !postId)
      throw new Error("postId is required for connected comments");

    if (scope === "public" && !url) throw new Error("postUrl is required for public comments");
    const boundedLimit = Math.max(1, Math.min(MAX_COMMENTS, Math.floor(limit ?? 25)));

    const request: CommentsRequest = {
      target,
      limit: boundedLimit,
    };

    if (postId) request.postId = postId;

    if (url) request.postUrl = url;

    if (cursor) request.cursor = cursor;

    return cachedRead(ctx, {
      accountId,
      operation: "comments",
      activityId,
      request,
      target: scope === "connected" ? `self:${postId}` : `post:${url}`,
      workspacePath: instagramWorkspacePath({
        operation: "comments",
        postId,
        postUrl: url,
      }),
      requirePublicProvider: scope === "public",
      maxPublicItems: boundedLimit,
      dataSchema: commentsSchema,
      run: (service) => service.listComments(request),
    });
  },
});

export const readMetrics = internalAction({
  args: { accountId: v.id("accounts"), postId: v.optional(v.string()) },
  handler: async (ctx, { accountId, postId }) => {
    const target = await connectedTarget(ctx, accountId);

    const request: InsightsRequest = { target };

    if (postId) request.postId = postId;

    return cachedRead(ctx, {
      accountId,
      operation: "insights",
      request,
      target: postId ? `self:${postId}` : "self",
      workspacePath: instagramWorkspacePath({
        operation: "insights",
        scope: "connected",
        postId,
      }),
      requirePublicProvider: false,
      dataSchema: insightsSchema,
      run: (service) => service.readInsights(target, postId),
    });
  },
});
