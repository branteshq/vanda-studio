import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

/**
 * The publishing port. The live adapter is Upload-Post (publisher/uploadpost),
 * which publishes synchronously — no container/poll model — so the port is a
 * single `publish` verb. Validation (post type, media count) stays in the pure
 * `publishPost` program.
 */

/** What one publish call ships: a single image or a 2–10 image carousel. */
export interface PublishRequest {
  readonly caption: string;
  readonly imageUrls: ReadonlyArray<string>;
}

/** What the platform reports back after publishing. */
export interface PublishReceipt {
  /** The post's native id on the platform (used later for metrics); null when withheld. */
  readonly externalPostId: string | null;
  readonly url: string | null;
}

// --- Typed failures -------------------------------------------------------

/** The publisher request failed (network, non-2xx, platform-side rejection). */
export class PublisherRequestFailed extends Data.TaggedError("PublisherRequestFailed")<{
  readonly operation: string;
  readonly message: string;
}> {}

/** The post's media set is unpublishable (wrong count for a feed/carousel). */
export class InvalidPost extends Data.TaggedError("InvalidPost")<{ readonly reason: string }> {}

/** The post type is not yet publishable (reels/stories arrive later). */
export class UnsupportedFormat extends Data.TaggedError("UnsupportedFormat")<{
  readonly type: string;
}> {}

/** Everything `publishPost` can fail with. */
export type PublishError = PublisherRequestFailed | InvalidPost | UnsupportedFormat;

export interface PublisherShape {
  readonly publish: (
    request: PublishRequest,
  ) => Effect.Effect<PublishReceipt, PublisherRequestFailed>;
}

export class Publisher extends Context.Service<Publisher, PublisherShape>()(
  "@vanda/pipeline/Publisher",
) {}
