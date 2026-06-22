import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { postTypes } from "./constants";
import {
  ContainerProcessingFailed,
  ContainerTimedOut,
  InvalidPost,
  Publisher,
  type PublishError,
  QuotaExceeded,
  UnsupportedFormat,
} from "./publisher";

export type PostType = (typeof postTypes)[number];

/** How long to wait between container status polls, and the polling budget. */
export const POLL_INTERVAL = "5 seconds";
export const MAX_POLL_ATTEMPTS = 20;
const MAX_CAROUSEL_ITEMS = 10;

/** A scheduled post resolved to everything needed to publish it. */
export interface PublishJob {
  readonly type: PostType;
  readonly caption: string;
  readonly imageUrls: ReadonlyArray<string>;
}

/** Poll a container until it is `FINISHED`, failing on terminal/timeout states. */
const awaitFinished = (
  containerId: string,
  attemptsLeft: number,
): Effect.Effect<void, PublishError, Publisher> =>
  Effect.gen(function* () {
    const publisher = yield* Publisher;
    const status = yield* publisher.getContainerStatus(containerId);
    if (status === "FINISHED") return;
    if (status !== "IN_PROGRESS") {
      return yield* new ContainerProcessingFailed({ containerId, status });
    }
    if (attemptsLeft <= 0) return yield* new ContainerTimedOut({ containerId });
    yield* Effect.sleep(POLL_INTERVAL);
    return yield* awaitFinished(containerId, attemptsLeft - 1);
  });

/**
 * Build the container to publish: the image itself for a single, or a carousel
 * parent whose children have all reached `FINISHED`.
 */
const buildContainer = (
  imageUrls: ReadonlyArray<string>,
  caption: string,
): Effect.Effect<string, PublishError, Publisher> =>
  Effect.gen(function* () {
    const publisher = yield* Publisher;
    if (imageUrls.length === 1) {
      return yield* publisher.createContainer({ kind: "image", imageUrl: imageUrls[0]!, caption });
    }
    const childIds = yield* Effect.forEach(
      imageUrls,
      (imageUrl) =>
        Effect.tap(
          publisher.createContainer({ kind: "image", imageUrl, isCarouselItem: true }),
          (childId) => awaitFinished(childId, MAX_POLL_ATTEMPTS),
        ),
      { concurrency: 4 },
    );
    return yield* publisher.createContainer({ kind: "carousel", childIds, caption });
  });

/**
 * Publish a feed post (single image or 2–10 image carousel) to Instagram: gate
 * on quota, create the container(s), poll until ready, then publish.
 * Deterministic given the Publisher's responses — no LLM, no hidden state.
 */
export const publishPost = Effect.fn("pipeline.publishPost")(function* (job: PublishJob) {
  if (job.type !== "feed" && job.type !== "image") {
    return yield* new UnsupportedFormat({ type: job.type });
  }
  const count = job.imageUrls.length;
  if (count < 1 || count > MAX_CAROUSEL_ITEMS) {
    return yield* new InvalidPost({
      reason: `a feed post needs 1-${MAX_CAROUSEL_ITEMS} images, got ${count}`,
    });
  }
  const publisher = yield* Publisher;
  const quota = yield* publisher.getQuota();
  if (quota.used >= quota.total) return yield* new QuotaExceeded(quota);

  const containerId = yield* buildContainer(job.imageUrls, job.caption);
  yield* awaitFinished(containerId, MAX_POLL_ATTEMPTS);
  return yield* publisher.publishContainer(containerId);
});

// --- Scheduled orchestration ---------------------------------------------

/** A scheduled post could not be loaded (e.g. it no longer exists). */
export class PublishJobNotFound extends Data.TaggedError("PublishJobNotFound")<{
  readonly scheduledPostId: string;
}> {}

/**
 * Persistence boundary for the scheduled-publish flow. Writes are typed fallible
 * (`UnknownError`) rather than infallible, matching the rest of the pipeline.
 */
export interface PublishStoreShape {
  readonly loadJob: (
    scheduledPostId: string,
  ) => Effect.Effect<PublishJob, PublishJobNotFound | Cause.UnknownError>;
  readonly markPublishing: (scheduledPostId: string) => Effect.Effect<void, Cause.UnknownError>;
  readonly markPublished: (
    scheduledPostId: string,
    externalPostId: string,
  ) => Effect.Effect<void, Cause.UnknownError>;
  readonly markFailed: (
    scheduledPostId: string,
    reason: string,
  ) => Effect.Effect<void, Cause.UnknownError>;
}

export class PublishStore extends Context.Service<PublishStore, PublishStoreShape>()(
  "@vanda/pipeline/PublishStore",
) {}

/**
 * Publish one due scheduled post end-to-end: load it, mark it publishing,
 * publish, then record the external id (or the failure tag). The status row is
 * the calendar's source of truth.
 */
export const publishDue = Effect.fn("pipeline.publishDue")(function* (scheduledPostId: string) {
  const store = yield* PublishStore;
  const job = yield* store.loadJob(scheduledPostId);
  yield* store.markPublishing(scheduledPostId);
  const externalPostId = yield* publishPost(job).pipe(
    Effect.tapError((error) => store.markFailed(scheduledPostId, error._tag)),
  );
  yield* store.markPublished(scheduledPostId, externalPostId);
  return externalPostId;
});
