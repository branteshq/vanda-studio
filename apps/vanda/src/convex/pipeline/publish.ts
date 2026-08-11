import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { postTypes } from "./constants";
import {
  InvalidPost,
  Publisher,
  type PublishReceipt,
  UnsupportedFormat,
} from "./publisher";

export type PostType = (typeof postTypes)[number];

const MAX_CAROUSEL_ITEMS = 10;

/** A scheduled post resolved to everything needed to publish it. */
export interface PublishJob {
  readonly type: PostType;
  readonly caption: string;
  readonly imageUrls: ReadonlyArray<string>;
}

/**
 * Publish a feed post (single image or 2–10 image carousel) to Instagram:
 * validate the shape, then hand it to the publisher port in one call.
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
  return yield* publisher.publish({ caption: job.caption, imageUrls: job.imageUrls });
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
    receipt: PublishReceipt,
  ) => Effect.Effect<void, Cause.UnknownError>;
  readonly markFailed: (
    scheduledPostId: string,
    reason: string,
  ) => Effect.Effect<void, Cause.UnknownError>;
}

export class PublishStore extends Context.Service<PublishStore, PublishStoreShape>()(
  "@vanda/pipeline/PublishStore",
) {}

/** Human-debuggable failure reason: the tag plus the variant's detail. */
const failureReason = (error: {
  readonly _tag: string;
  readonly message?: string;
  readonly reason?: string;
  readonly type?: string;
}): string => {
  const detail = error.message ?? error.reason ?? error.type;
  return detail !== undefined ? `${error._tag}: ${detail}`.slice(0, 300) : error._tag;
};

/**
 * Publish one due scheduled post end-to-end: load it, mark it publishing,
 * publish, then record the receipt (or the failure reason). The status row
 * is the calendar's source of truth.
 */
export const publishDue = Effect.fn("pipeline.publishDue")(function* (scheduledPostId: string) {
  const store = yield* PublishStore;
  const job = yield* store.loadJob(scheduledPostId);
  yield* store.markPublishing(scheduledPostId);
  const receipt = yield* publishPost(job).pipe(
    Effect.tapError((error) => store.markFailed(scheduledPostId, failureReason(error))),
  );
  yield* store.markPublished(scheduledPostId, receipt);
  return receipt;
});
