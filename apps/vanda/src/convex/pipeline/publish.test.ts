import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { POLL_INTERVAL, publishDue, publishPost } from "./publish";
import { makeFakePublisher, makeInMemoryPublishStore } from "./publish.testing";

describe("publishPost", () => {
  it.effect("publishes a single image and returns the media id", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher();
      const media = yield* publishPost({
        type: "feed",
        caption: "hi",
        imageUrls: ["https://img/1.jpg"],
      }).pipe(Effect.provide(fake.layer));
      expect(fake.created).toHaveLength(1);
      expect(fake.created[0]).toMatchObject({
        kind: "image",
        imageUrl: "https://img/1.jpg",
        caption: "hi",
      });
      expect(fake.published).toEqual(["c1"]);
      expect(media).toBe("media_c1");
    }),
  );

  it.effect("assembles a carousel from children and publishes only the parent", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher();
      const media = yield* publishPost({
        type: "feed",
        caption: "cap",
        imageUrls: ["a", "b", "c"],
      }).pipe(Effect.provide(fake.layer));
      const images = fake.created.filter((s) => s.kind === "image");
      const carousels = fake.created.filter((s) => s.kind === "carousel");
      expect(images).toHaveLength(3);
      expect(images.every((s) => s.kind === "image" && s.isCarouselItem === true)).toBe(true);
      expect(carousels).toHaveLength(1);
      // children are c1..c3, the carousel parent is c4 — only the parent is published
      expect(fake.published).toEqual(["c4"]);
      expect(media).toBe("media_c4");
    }),
  );

  it.effect("polls until the container is FINISHED, then publishes", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher({ readyAfter: 2 });
      const fiber = yield* Effect.forkScoped(
        publishPost({ type: "image", caption: "c", imageUrls: ["u"] }).pipe(
          Effect.provide(fake.layer),
        ),
      );
      yield* TestClock.adjust(POLL_INTERVAL);
      yield* TestClock.adjust(POLL_INTERVAL);
      const media = yield* Fiber.join(fiber);
      expect(media).toBe("media_c1");
      expect(fake.published).toEqual(["c1"]);
    }),
  );

  it.effect("fails QuotaExceeded without creating a container when the quota is spent", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher({ quota: { used: 25, total: 25 } });
      const error = yield* publishPost({ type: "feed", caption: "x", imageUrls: ["u"] }).pipe(
        Effect.provide(fake.layer),
        Effect.flip,
      );
      expect(error._tag).toBe("QuotaExceeded");
      expect(fake.created).toHaveLength(0);
    }),
  );

  it.effect("fails ContainerProcessingFailed when a container errors", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher({ terminalStatus: "ERROR" });
      const error = yield* publishPost({ type: "feed", caption: "x", imageUrls: ["u"] }).pipe(
        Effect.provide(fake.layer),
        Effect.flip,
      );
      expect(error._tag).toBe("ContainerProcessingFailed");
      expect(fake.published).toHaveLength(0);
    }),
  );

  it.effect("rejects an empty image set", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher();
      const error = yield* publishPost({ type: "feed", caption: "x", imageUrls: [] }).pipe(
        Effect.provide(fake.layer),
        Effect.flip,
      );
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
      const media = yield* publishDue("sp1").pipe(
        Effect.provide(Layer.mergeAll(fake.layer, store.layer)),
      );
      expect(media).toBe("media_c1");
      expect(store.state.get("sp1")).toMatchObject({
        status: "published",
        externalPostId: "media_c1",
      });
    }),
  );

  it.effect("marks the row failed (with the error tag) on a publish error", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher({ terminalStatus: "ERROR" });
      const store = makeInMemoryPublishStore({ sp1: job });
      const error = yield* publishDue("sp1").pipe(
        Effect.provide(Layer.mergeAll(fake.layer, store.layer)),
        Effect.flip,
      );
      expect(error._tag).toBe("ContainerProcessingFailed");
      expect(store.state.get("sp1")).toMatchObject({
        status: "failed",
        lastError: "ContainerProcessingFailed",
      });
    }),
  );

  it.effect("marks the row failed with the transport error tag when the publisher fails", () =>
    Effect.gen(function* () {
      const fake = makeFakePublisher({ failOn: "createContainer" });
      const store = makeInMemoryPublishStore({ sp1: job });
      const error = yield* publishDue("sp1").pipe(
        Effect.provide(Layer.mergeAll(fake.layer, store.layer)),
        Effect.flip,
      );
      expect(error._tag).toBe("PublisherRequestFailed");
      expect(store.state.get("sp1")).toMatchObject({
        status: "failed",
        lastError: "PublisherRequestFailed",
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
