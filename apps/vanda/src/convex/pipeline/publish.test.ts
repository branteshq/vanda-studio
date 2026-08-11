import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { publishDue, publishPost } from "./publish";
import { makeFakePublisher, makeInMemoryPublishStore } from "./publish.testing";

describe("publishPost", () => {
  it.effect("publishes a single image and returns the receipt", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher();
      const receipt = yield* publishPost({
        type: "feed",
        caption: "hi",
        imageUrls: ["https://img/1.jpg"],
      }).pipe(Effect.provide(fake.layer));
      expect(fake.published).toHaveLength(1);
      expect(fake.published[0]).toMatchObject({
        caption: "hi",
        imageUrls: ["https://img/1.jpg"],
      });
      expect(receipt.externalPostId).toBe("media_1");
    }),
  );

  it.effect("ships a carousel as one publish call with all images", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher();
      yield* publishPost({
        type: "feed",
        caption: "cap",
        imageUrls: ["a", "b", "c"],
      }).pipe(Effect.provide(fake.layer));
      expect(fake.published).toHaveLength(1);
      expect(fake.published[0]).toMatchObject({ caption: "cap", imageUrls: ["a", "b", "c"] });
    }),
  );

  it.effect("rejects an empty image set without calling the publisher", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher();
      const error = yield* publishPost({ type: "feed", caption: "x", imageUrls: [] }).pipe(
        Effect.provide(fake.layer),
        Effect.flip,
      );
      expect(error._tag).toBe("InvalidPost");
      expect(fake.published).toHaveLength(0);
    }),
  );

  it.effect("rejects more than 10 images", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher();
      const error = yield* publishPost({
        type: "feed",
        caption: "x",
        imageUrls: Array.from({ length: 11 }, (_, i) => `u${i}`),
      }).pipe(Effect.provide(fake.layer), Effect.flip);
      expect(error._tag).toBe("InvalidPost");
    }),
  );

  it.effect("rejects an unsupported post type", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher();
      const error = yield* publishPost({ type: "reel", caption: "x", imageUrls: ["u"] }).pipe(
        Effect.provide(fake.layer),
        Effect.flip,
      );
      expect(error._tag).toBe("UnsupportedFormat");
    }),
  );
});

describe("publishDue", () => {
  const job = { type: "feed", caption: "hi", imageUrls: ["u"] } as const;

  it.effect("records the external id and marks the row published on success", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher();
      const store = makeInMemoryPublishStore({ sp1: job });
      const receipt = yield* publishDue("sp1").pipe(
        Effect.provide(Layer.mergeAll(fake.layer, store.layer)),
      );
      expect(receipt.externalPostId).toBe("media_1");
      expect(store.state.get("sp1")).toMatchObject({
        status: "published",
        externalPostId: "media_1",
      });
    }),
  );

  it.effect("marks the row failed with the transport error tag when the publisher fails", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher({ fail: true });
      const store = makeInMemoryPublishStore({ sp1: job });
      const error = yield* publishDue("sp1").pipe(
        Effect.provide(Layer.mergeAll(fake.layer, store.layer)),
        Effect.flip,
      );
      expect(error._tag).toBe("PublisherRequestFailed");
      expect(store.state.get("sp1")).toMatchObject({
        status: "failed",
        lastError: "PublisherRequestFailed: fake transport failure",
      });
    }),
  );

  it.effect("fails PublishJobNotFound for an unknown scheduled post", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher();
      const store = makeInMemoryPublishStore({});
      const error = yield* publishDue("missing").pipe(
        Effect.provide(Layer.mergeAll(fake.layer, store.layer)),
        Effect.flip,
      );
      expect(error._tag).toBe("PublishJobNotFound");
    }),
  );
});
