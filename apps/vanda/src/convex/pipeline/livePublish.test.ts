import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publisherLive } from "./livePublish";
import { Publisher } from "./publisher";

const runPublish = (request: { caption: string; imageUrls: ReadonlyArray<string> }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const publisher = yield* Publisher;
      return yield* publisher.publish(request);
    }).pipe(Effect.provide(publisherLive({ username: "acc1" }))),
  );

const flipPublish = (request: { caption: string; imageUrls: ReadonlyArray<string> }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const publisher = yield* Publisher;
      return yield* publisher.publish(request).pipe(Effect.flip);
    }).pipe(Effect.provide(publisherLive({ username: "acc1" }))),
  );

describe("publisherLive (fetch-mocked Upload-Post adapter)", () => {
  beforeEach(() => {
    vi.stubEnv("UPLOADPOST_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const stubFetch = (uploadResponse: () => Response) => {
    const uploads: Array<FormData> = [];
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url instanceof Request ? url.url : url);
      if (href.includes("/upload_photos")) {
        uploads.push(init?.body as FormData);
        return uploadResponse();
      }
      // Image fetches resolve to bytes.
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    });
    return uploads;
  };

  it("publishes photos as one multipart call and returns the receipt", async () => {
    const uploads = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            success: true,
            results: { instagram: { success: true, post_id: "18001", url: "https://ig/p/x" } },
          }),
          { status: 200 },
        ),
    );

    const receipt = await runPublish({ caption: "hi", imageUrls: ["https://img/1", "https://img/2"] });
    expect(receipt).toEqual({ externalPostId: "18001", url: "https://ig/p/x" });
    expect(uploads).toHaveLength(1);
    const form = uploads[0]!;
    expect(form.get("user")).toBe("acc1");
    expect(form.get("title")).toBe("hi");
    expect(form.getAll("photos[]")).toHaveLength(2);
    expect(form.getAll("platform[]")).toEqual(["instagram"]);
  });

  it("fails PublisherRequestFailed on a non-2xx response", async () => {
    stubFetch(() => new Response("nope", { status: 500 }));
    const error = await flipPublish({ caption: "x", imageUrls: ["https://img/1"] });
    expect(error._tag).toBe("PublisherRequestFailed");
  });

  it("fails PublisherRequestFailed when Instagram reports a per-platform error", async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            success: true,
            results: { instagram: { success: false, error: "account not connected" } },
          }),
          { status: 200 },
        ),
    );
    const error = await flipPublish({ caption: "x", imageUrls: ["https://img/1"] });
    expect(error._tag).toBe("PublisherRequestFailed");
    expect(error).toMatchObject({ message: "account not connected" });
  });
});
