"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
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
import { InstagramService, type InstagramServiceShape } from "./instagram/service";
import type { InstagramObservation, InstagramTarget } from "./instagram/types";
import { USAGE_LIMIT_MESSAGE } from "./usage";

const MAX_SEARCH = 20;
const MAX_POSTS = 100;
const MAX_COMMENTS = 50;
const MAX_PUBLIC_ITEMS_PER_ACCOUNT_PER_DAY = 1_000;

interface ActionObservation<T> extends InstagramObservation<T> {
  readonly savedTo: string;
  readonly cached: boolean;
}

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

const cachedRead = async <A>(
  ctx: ActionCtx,
  input: {
    readonly accountId: Id<"accounts">;
    readonly operation: InstagramOperation;
    readonly request: unknown;
    readonly target: string;
    readonly workspacePath: string;
    readonly requirePublicProvider: boolean;
    readonly maxPublicItems?: number | undefined;
    readonly run: (service: InstagramServiceShape) => Effect.Effect<A, unknown>;
  },
): Promise<ActionObservation<A extends InstagramObservation<infer Data> ? Data : never>> => {
  const requestKey = instagramRequestKey(input.operation, input.request);
  const cached = await ctx.runQuery(internal.instagramData.readCachedObservation, {
    accountId: input.accountId,
    requestKey,
    now: Date.now(),
  });
  if (cached) {
    return {
      data: cached.payload,
      source: cached.source,
      observedAt: cached.observedAt,
      completeness: cached.completeness,
      ...(cached.costUsd !== undefined ? { costUsd: cached.costUsd } : {}),
      ...(cached.nextCursor ? { nextCursor: cached.nextCursor } : {}),
      savedTo: cached.workspacePath,
      cached: true,
    } as ActionObservation<A extends InstagramObservation<infer Data> ? Data : never>;
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
      throw new Error(USAGE_LIMIT_MESSAGE);
    }
  }
  const observation = (await Effect.runPromise(
    Effect.flatMap(InstagramService, input.run).pipe(
      Effect.provide(liveInstagramLayer(apifyToken)),
    ),
  )) as A;
  const typed = observation as InstagramObservation<unknown>;
  const itemCount = Array.isArray(typed.data) ? typed.data.length : 1;
  const costUsd = input.requirePublicProvider ? apifyInstagramCostUsd(itemCount) : undefined;
  await ctx.runMutation(internal.instagramData.saveObservation, {
    accountId: input.accountId,
    requestKey,
    operation: input.operation,
    target: input.target,
    workspacePath: input.workspacePath,
    source: typed.source,
    completeness: typed.completeness,
    payload: typed.data,
    itemCount,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(typed.nextCursor ? { nextCursor: typed.nextCursor } : {}),
    observedAt: typed.observedAt,
    expiresAt: instagramExpiresAt(input.operation, typed.observedAt),
  });
  return {
    ...typed,
    ...(costUsd !== undefined ? { costUsd } : {}),
    savedTo: input.workspacePath,
    cached: false,
  } as ActionObservation<A extends InstagramObservation<infer Data> ? Data : never>;
};

export const searchProfiles = internalAction({
  args: { accountId: v.id("accounts"), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { accountId, query, limit }) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("empty Instagram search query");
    const boundedLimit = Math.max(1, Math.min(MAX_SEARCH, Math.floor(limit ?? 10)));
    return cachedRead(ctx, {
      accountId,
      operation: "search_profiles",
      request: { query: normalizedQuery, limit: boundedLimit },
      target: `search:${normalizedQuery}`,
      workspacePath: instagramWorkspacePath({
        operation: "search_profiles",
        query: normalizedQuery,
      }),
      requirePublicProvider: true,
      maxPublicItems: boundedLimit,
      run: (service) => service.searchProfiles(normalizedQuery, boundedLimit),
    });
  },
});

export const readProfile = internalAction({
  args: {
    accountId: v.id("accounts"),
    scope: v.union(v.literal("connected"), v.literal("public")),
    handle: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, scope, handle }) => {
    const target: InstagramTarget =
      scope === "connected"
        ? await connectedTarget(ctx, accountId)
        : { scope: "public", handle: publicHandle(handle) };
    return cachedRead(ctx, {
      accountId,
      operation: "profile",
      request: target,
      target: target.scope === "connected" ? "self" : `public:${target.handle}`,
      workspacePath: instagramWorkspacePath({
        operation: "profile",
        scope: target.scope,
        handle: target.handle,
      }),
      requirePublicProvider: target.scope === "public",
      maxPublicItems: 1,
      run: (service) => service.readProfile(target),
    });
  },
});

export const listPosts = internalAction({
  args: {
    accountId: v.id("accounts"),
    scope: v.union(v.literal("connected"), v.literal("public")),
    handle: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, scope, handle, limit, cursor }) => {
    const target: InstagramTarget =
      scope === "connected"
        ? await connectedTarget(ctx, accountId)
        : { scope: "public", handle: publicHandle(handle) };
    const boundedLimit = Math.max(1, Math.min(MAX_POSTS, Math.floor(limit ?? 25)));
    const request = { target, limit: boundedLimit, ...(cursor ? { cursor } : {}) };
    return cachedRead(ctx, {
      accountId,
      operation: "posts",
      request,
      target: target.scope === "connected" ? "self" : `public:${target.handle}`,
      workspacePath: instagramWorkspacePath({
        operation: "posts",
        scope: target.scope,
        handle: target.handle,
      }),
      requirePublicProvider: target.scope === "public",
      maxPublicItems: boundedLimit,
      run: (service) => service.listPosts(target, request),
    });
  },
});

export const readPost = internalAction({
  args: {
    accountId: v.id("accounts"),
    postUrl: v.string(),
    includeTranscript: v.optional(v.boolean()),
  },
  handler: async (ctx, { accountId, postUrl: rawPostUrl, includeTranscript }) => {
    const url = postUrl(rawPostUrl);
    const transcript = includeTranscript ?? false;
    return cachedRead(ctx, {
      accountId,
      operation: "post",
      request: { postUrl: url, includeTranscript: transcript },
      target: `post:${url}`,
      workspacePath: instagramWorkspacePath({ operation: "post", postUrl: url }),
      requirePublicProvider: true,
      maxPublicItems: 1,
      run: (service) => service.readPost(url, transcript),
    });
  },
});

export const listComments = internalAction({
  args: {
    accountId: v.id("accounts"),
    scope: v.union(v.literal("connected"), v.literal("public")),
    postId: v.optional(v.string()),
    postUrl: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, scope, postId, postUrl: rawPostUrl, limit, cursor }) => {
    const target: InstagramTarget =
      scope === "connected"
        ? await connectedTarget(ctx, accountId)
        : { scope: "public", handle: "public" };
    const url = rawPostUrl ? postUrl(rawPostUrl) : undefined;
    if (scope === "connected" && !postId)
      throw new Error("postId is required for connected comments");
    if (scope === "public" && !url) throw new Error("postUrl is required for public comments");
    const boundedLimit = Math.max(1, Math.min(MAX_COMMENTS, Math.floor(limit ?? 25)));
    const request = {
      target,
      ...(postId ? { postId } : {}),
      ...(url ? { postUrl: url } : {}),
      limit: boundedLimit,
      ...(cursor ? { cursor } : {}),
    };
    return cachedRead(ctx, {
      accountId,
      operation: "comments",
      request,
      target: scope === "connected" ? `self:${postId}` : `post:${url}`,
      workspacePath: instagramWorkspacePath({
        operation: "comments",
        postId,
        postUrl: url,
      }),
      requirePublicProvider: scope === "public",
      maxPublicItems: boundedLimit,
      run: (service) => service.listComments(request),
    });
  },
});

export const readMetrics = internalAction({
  args: { accountId: v.id("accounts"), postId: v.optional(v.string()) },
  handler: async (ctx, { accountId, postId }) => {
    const target = await connectedTarget(ctx, accountId);
    return cachedRead(ctx, {
      accountId,
      operation: "insights",
      request: { target, ...(postId ? { postId } : {}) },
      target: postId ? `self:${postId}` : "self",
      workspacePath: instagramWorkspacePath({
        operation: "insights",
        scope: "connected",
        postId,
      }),
      requirePublicProvider: false,
      run: (service) => service.readInsights(target, postId),
    });
  },
});
