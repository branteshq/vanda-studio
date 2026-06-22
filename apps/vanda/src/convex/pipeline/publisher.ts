import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

/** Instagram media-container processing states (`GET /{id}?fields=status_code`). */
export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "EXPIRED" | "ERROR";

/** What to create with `POST /{ig-user-id}/media`. */
export type ContainerSpec =
  | {
      readonly kind: "image";
      readonly imageUrl: string;
      readonly caption?: string;
      readonly isCarouselItem?: boolean;
    }
  | {
      readonly kind: "carousel";
      readonly childIds: ReadonlyArray<string>;
      readonly caption: string;
    };

export interface Quota {
  readonly used: number;
  readonly total: number;
}

// --- Typed failures -------------------------------------------------------

/** A Graph API request itself failed (network, non-2xx, malformed body). */
export class PublisherRequestFailed extends Data.TaggedError("PublisherRequestFailed")<{
  readonly operation: string;
  readonly message: string;
}> {}

/** The account's rolling 24h publish quota is exhausted. */
export class QuotaExceeded extends Data.TaggedError("QuotaExceeded")<{
  readonly used: number;
  readonly total: number;
}> {}

/** The post's media set is unpublishable (wrong count for a feed/carousel). */
export class InvalidPost extends Data.TaggedError("InvalidPost")<{ readonly reason: string }> {}

/** The post type is not yet publishable (reels/stories/tweets arrive later). */
export class UnsupportedFormat extends Data.TaggedError("UnsupportedFormat")<{
  readonly type: string;
}> {}

/** A container reached a terminal non-publishable state (`ERROR`/`EXPIRED`). */
export class ContainerProcessingFailed extends Data.TaggedError("ContainerProcessingFailed")<{
  readonly containerId: string;
  readonly status: ContainerStatus;
}> {}

/** A container never reached `FINISHED` within the polling budget. */
export class ContainerTimedOut extends Data.TaggedError("ContainerTimedOut")<{
  readonly containerId: string;
}> {}

/** Everything `publishPost` can fail with. */
export type PublishError =
  | PublisherRequestFailed
  | QuotaExceeded
  | InvalidPost
  | UnsupportedFormat
  | ContainerProcessingFailed
  | ContainerTimedOut;

/**
 * The low-level Instagram publishing port — one method per Graph API call. The
 * orchestration (quota gate, container polling, carousel assembly) lives in the
 * pure `publishPost` program, so this stays a thin, swappable adapter.
 */
export interface PublisherShape {
  readonly getQuota: () => Effect.Effect<Quota, PublisherRequestFailed>;
  readonly createContainer: (spec: ContainerSpec) => Effect.Effect<string, PublisherRequestFailed>;
  readonly getContainerStatus: (
    containerId: string,
  ) => Effect.Effect<ContainerStatus, PublisherRequestFailed>;
  readonly publishContainer: (containerId: string) => Effect.Effect<string, PublisherRequestFailed>;
}

export class Publisher extends Context.Service<Publisher, PublisherShape>()(
  "@vanda/pipeline/Publisher",
) {}
