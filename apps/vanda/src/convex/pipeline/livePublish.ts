import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { PublishJobNotFound, PublishStore } from "./publish";
import {
  type ContainerSpec,
  type ContainerStatus,
  Publisher,
  PublisherRequestFailed,
  type Quota,
} from "./publisher";

const GRAPH_BASE = "https://graph.instagram.com/v23.0";

interface GraphJson {
  readonly id?: string;
  readonly status_code?: string;
  readonly error?: { readonly message?: string };
  readonly data?: ReadonlyArray<{
    readonly quota_usage?: number;
    readonly config?: { readonly quota_total?: number };
  }>;
}

interface IgConfig {
  readonly igUserId: string;
  readonly token: string;
}

const graphRequest = (
  config: IgConfig,
  operation: string,
  method: "GET" | "POST",
  path: string,
  params: Readonly<Record<string, string>>,
): Effect.Effect<GraphJson, PublisherRequestFailed> =>
  Effect.tryPromise({
    try: async () => {
      const query = new URLSearchParams({ ...params, access_token: config.token });
      const response =
        method === "GET"
          ? await fetch(`${GRAPH_BASE}${path}?${query.toString()}`)
          : await fetch(`${GRAPH_BASE}${path}`, { method: "POST", body: query });
      const json = (await response.json()) as GraphJson;
      if (!response.ok || json.error) {
        throw new Error(json.error?.message ?? `HTTP ${response.status}`);
      }
      return json;
    },
    catch: (error) =>
      new PublisherRequestFailed({
        operation,
        message: error instanceof Error ? error.message : String(error),
      }),
  });

const containerParams = (spec: ContainerSpec): Record<string, string> => {
  if (spec.kind === "carousel") {
    return { media_type: "CAROUSEL", children: spec.childIds.join(","), caption: spec.caption };
  }
  return {
    image_url: spec.imageUrl,
    ...(spec.caption !== undefined ? { caption: spec.caption } : {}),
    ...(spec.isCarouselItem ? { is_carousel_item: "true" } : {}),
  };
};

const requireId =
  (operation: string) =>
  (json: GraphJson): Effect.Effect<string, PublisherRequestFailed> =>
    json.id !== undefined && json.id !== ""
      ? Effect.succeed(json.id)
      : Effect.fail(
          new PublisherRequestFailed({ operation, message: "Graph response missing id" }),
        );

/** Live `Publisher` adapter for Instagram content publishing over the Graph API. */
export const publisherLive = (config: IgConfig): Layer.Layer<Publisher> =>
  Layer.succeed(Publisher, {
    getQuota: () =>
      graphRequest(config, "getQuota", "GET", `/${config.igUserId}/content_publishing_limit`, {
        fields: "config,quota_usage",
      }).pipe(
        Effect.map((json): Quota => {
          const entry = json.data?.[0];
          return { used: entry?.quota_usage ?? 0, total: entry?.config?.quota_total ?? 25 };
        }),
      ),
    createContainer: (spec) =>
      graphRequest(
        config,
        "createContainer",
        "POST",
        `/${config.igUserId}/media`,
        containerParams(spec),
      ).pipe(Effect.flatMap(requireId("createContainer"))),
    getContainerStatus: (containerId) =>
      graphRequest(config, "getContainerStatus", "GET", `/${containerId}`, {
        fields: "status_code",
      }).pipe(Effect.map((json) => (json.status_code ?? "ERROR") as ContainerStatus)),
    publishContainer: (containerId) =>
      graphRequest(config, "publishContainer", "POST", `/${config.igUserId}/media_publish`, {
        creation_id: containerId,
      }).pipe(Effect.flatMap(requireId("publishContainer"))),
  });

const scheduledId = (id: string) => id as Id<"scheduledPosts">;

const resolveImageUrl = (
  ctx: ActionCtx,
  image: {
    readonly storageId?: Id<"_storage"> | undefined;
    readonly externalUrl?: string | undefined;
  },
): Effect.Effect<string, Cause.UnknownError> =>
  image.externalUrl !== undefined
    ? Effect.succeed(image.externalUrl)
    : Effect.tryPromise(async () => {
        const url = image.storageId ? await ctx.storage.getUrl(image.storageId) : null;
        if (url === null) throw new Error("image has no resolvable url");
        return url;
      });

const setStatus = (
  ctx: ActionCtx,
  scheduledPostId: string,
  status: "publishing" | "published" | "failed",
  extra: { readonly externalPostId?: string; readonly lastError?: string } = {},
): Effect.Effect<void, Cause.UnknownError> =>
  Effect.tryPromise(() =>
    ctx.runMutation(internal.publishScheduled.setScheduledStatus, {
      scheduledPostId: scheduledId(scheduledPostId),
      status,
      ...extra,
    }),
  ).pipe(Effect.asVoid);

/** `PublishStore` backed by the Convex action `ctx`: joins the scheduled post to its media and records lifecycle transitions. */
export const publishStoreLive = (ctx: ActionCtx): Layer.Layer<PublishStore> =>
  Layer.succeed(PublishStore, {
    loadJob: (scheduledPostId) =>
      Effect.gen(function* () {
        const data = yield* Effect.tryPromise(() =>
          ctx.runQuery(internal.publishScheduled.loadScheduledPostData, {
            scheduledPostId: scheduledId(scheduledPostId),
          }),
        );
        if (data === null) return yield* new PublishJobNotFound({ scheduledPostId });
        const imageUrls = yield* Effect.forEach(data.images, (image) =>
          resolveImageUrl(ctx, image),
        );
        return { type: data.type, caption: data.caption, imageUrls };
      }),
    markPublishing: (id) => setStatus(ctx, id, "publishing"),
    markPublished: (id, externalPostId) => setStatus(ctx, id, "published", { externalPostId }),
    markFailed: (id, reason) => setStatus(ctx, id, "failed", { lastError: reason }),
  });
