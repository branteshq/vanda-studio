import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  type PublishJob,
  PublishJobNotFound,
  PublishStore,
  type PublishStoreShape,
} from "./publish";
import {
  type ContainerSpec,
  type ContainerStatus,
  Publisher,
  PublisherRequestFailed,
  type PublisherShape,
  type Quota,
} from "./publisher";

const transportFailure = (operation: keyof PublisherShape) =>
  new PublisherRequestFailed({ operation, message: "fake transport failure" });

export interface FakePublisher {
  readonly layer: Layer.Layer<Publisher>;
  readonly created: ReadonlyArray<ContainerSpec>;
  readonly published: ReadonlyArray<string>;
}

/**
 * In-memory Instagram publisher. Containers become `FINISHED` after
 * `readyAfter` `IN_PROGRESS` polls (0 = immediately), or report a fixed
 * `terminalStatus` (`ERROR`/`EXPIRED`). Records created specs and published ids.
 */
export const makeFakePublisher = (
  options: {
    readonly quota?: Quota;
    readonly readyAfter?: number;
    readonly terminalStatus?: ContainerStatus;
    readonly failOn?: keyof PublisherShape;
  } = {},
): FakePublisher => {
  const created: Array<ContainerSpec> = [];
  const published: Array<string> = [];
  const polls = new Map<string, number>();
  const quota = options.quota ?? { used: 0, total: 100 };
  const readyAfter = options.readyAfter ?? 0;
  let seq = 0;

  const shape: PublisherShape = {
    getQuota: () =>
      options.failOn === "getQuota"
        ? Effect.fail(transportFailure("getQuota"))
        : Effect.succeed(quota),
    createContainer: (spec) =>
      options.failOn === "createContainer"
        ? Effect.fail(transportFailure("createContainer"))
        : Effect.sync(() => {
            created.push(spec);
            seq += 1;
            return `c${seq}`;
          }),
    getContainerStatus: (containerId) =>
      options.failOn === "getContainerStatus"
        ? Effect.fail(transportFailure("getContainerStatus"))
        : Effect.sync(() => {
            if (options.terminalStatus !== undefined) return options.terminalStatus;
            const seen = (polls.get(containerId) ?? 0) + 1;
            polls.set(containerId, seen);
            return seen > readyAfter ? "FINISHED" : "IN_PROGRESS";
          }),
    publishContainer: (containerId) =>
      options.failOn === "publishContainer"
        ? Effect.fail(transportFailure("publishContainer"))
        : Effect.sync(() => {
            published.push(containerId);
            return `media_${containerId}`;
          }),
  };

  return { layer: Layer.succeed(Publisher, shape), created, published };
};

export interface InMemoryPublishStore {
  readonly layer: Layer.Layer<PublishStore>;
  readonly state: Map<string, { status: string; externalPostId?: string; lastError?: string }>;
}

/** In-memory `PublishStore` seeded with jobs, recording status transitions. */
export const makeInMemoryPublishStore = (
  jobs: Readonly<Record<string, PublishJob>>,
): InMemoryPublishStore => {
  const state = new Map<string, { status: string; externalPostId?: string; lastError?: string }>(
    Object.keys(jobs).map((id) => [id, { status: "scheduled" }]),
  );

  const shape: PublishStoreShape = {
    loadJob: (scheduledPostId) => {
      const job = jobs[scheduledPostId];
      return job === undefined
        ? Effect.fail(new PublishJobNotFound({ scheduledPostId }))
        : Effect.succeed(job);
    },
    markPublishing: (id) => Effect.sync(() => void state.set(id, { status: "publishing" })),
    markPublished: (id, externalPostId) =>
      Effect.sync(() => void state.set(id, { status: "published", externalPostId })),
    markFailed: (id, reason) =>
      Effect.sync(() => void state.set(id, { status: "failed", lastError: reason })),
  };

  return { layer: Layer.succeed(PublishStore, shape), state };
};
