import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  type PublishJob,
  PublishJobNotFound,
  PublishStore,
  type PublishStoreShape,
} from "./publish";
import {
  Publisher,
  PublisherRequestFailed,
  type PublishReceipt,
  type PublishRequest,
} from "./publisher";

export interface FakePublisher {
  readonly layer: Layer.Layer<Publisher>;
  readonly published: ReadonlyArray<PublishRequest>;
}

/**
 * In-memory publisher: records publish requests and returns sequential media
 * ids, or fails every call when `fail` is set.
 */
export const makeFakePublisher = (
  options: { readonly fail?: boolean } = {},
): FakePublisher => {
  const published: Array<PublishRequest> = [];
  let seq = 0;

  return {
    layer: Layer.succeed(Publisher, {
      publish: (request) =>
        options.fail
          ? Effect.fail(
              new PublisherRequestFailed({ operation: "publish", message: "fake transport failure" }),
            )
          : Effect.sync((): PublishReceipt => {
              published.push(request);
              seq += 1;
              return { externalPostId: `media_${seq}`, url: `https://instagram.com/p/fake_${seq}` };
            }),
    }),
    published,
  };
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
    markPublished: (id, receipt) =>
      Effect.sync(
        () =>
          void state.set(id, {
            status: "published",
            ...(receipt.externalPostId !== null ? { externalPostId: receipt.externalPostId } : {}),
          }),
      ),
    markFailed: (id, reason) =>
      Effect.sync(() => void state.set(id, { status: "failed", lastError: reason })),
  };

  return { layer: Layer.succeed(PublishStore, shape), state };
};
