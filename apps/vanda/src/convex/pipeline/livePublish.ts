import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { publishPhotos } from "../publisher/uploadpost";
import { PublishJobNotFound, PublishStore } from "./publish";
import { Publisher, PublisherRequestFailed, type PublishReceipt } from "./publisher";

/**
 * Live `Publisher` adapter over the Upload-Post API: one synchronous call
 * publishes a single image or carousel to the profile's connected Instagram.
 */
export const publisherLive = (config: { readonly username: string }): Layer.Layer<Publisher> =>
  Layer.succeed(Publisher, {
    publish: (request) =>
      Effect.tryPromise({
        try: async (): Promise<PublishReceipt> =>
          publishPhotos({
            username: config.username,
            caption: request.caption,
            imageUrls: request.imageUrls,
          }),
        catch: (error) =>
          new PublisherRequestFailed({
            operation: "publish",
            message: error instanceof Error ? error.message : String(error),
          }),
      }),
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
  extra: {
    readonly externalPostId?: string;
    readonly permalink?: string;
    readonly lastError?: string;
  } = {},
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
    markPublished: (id, receipt) =>
      setStatus(ctx, id, "published", {
        ...(receipt.externalPostId !== null ? { externalPostId: receipt.externalPostId } : {}),
        ...(receipt.url !== null ? { permalink: receipt.url } : {}),
      }),
    markFailed: (id, reason) => setStatus(ctx, id, "failed", { lastError: reason }),
  });
