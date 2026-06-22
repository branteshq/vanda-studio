import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publisherLive } from "./livePublish";
import { Publisher, type PublisherShape } from "./publisher";

const config = { igUserId: "ig1", token: "tok" };

const runOnLive = <A, E>(use: (p: PublisherShape) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const publisher = yield* Publisher;
      return yield* use(publisher);
    }).pipe(Effect.provide(publisherLive(config))),
  );

describe("publisherLive (fetch-mocked Graph adapter)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a carousel container with media_type and joined children", async () => {
    const bodies: Array<string> = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toContain("/ig1/media");
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ id: "container_1" }), { status: 200 });
    });

    const id = await runOnLive((p) =>
      p.createContainer({ kind: "carousel", childIds: ["a", "b"], caption: "hi" }),
    );
    expect(id).toBe("container_1");
    expect(bodies[0]).toContain("media_type=CAROUSEL");
    expect(bodies[0]).toContain("children=a%2Cb");
  });

  it("parses the content_publishing_limit quota", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ data: [{ quota_usage: 7, config: { quota_total: 25 } }] }), {
          status: 200,
        }),
    );
    const quota = await runOnLive((p) => p.getQuota());
    expect(quota).toEqual({ used: 7, total: 25 });
  });

  it("fails PublisherRequestFailed on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }),
    );
    const error = await runOnLive((p) => p.publishContainer("c1").pipe(Effect.flip));
    expect(error._tag).toBe("PublisherRequestFailed");
  });

  it("fails PublisherRequestFailed when a 200 response is missing the id", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({}), { status: 200 }));
    const error = await runOnLive((p) =>
      p.createContainer({ kind: "image", imageUrl: "u" }).pipe(Effect.flip),
    );
    expect(error._tag).toBe("PublisherRequestFailed");
  });
});
