import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";
import {
  ConnectedInstagramProvider,
  InstagramService,
  PublicInstagramProvider,
  instagramServiceLayer,
  type ConnectedInstagramProviderShape,
  type PublicInstagramProviderShape,
} from "./service";

const connectedTarget = {
  scope: "connected" as const,
  publisherUsername: "account-1",
  handle: "cafelumiar",
};

const connected: ConnectedInstagramProviderShape = {
  readProfile: (target) =>
    Effect.succeed({
      data: { handle: target.handle, name: "Café Lumiar" },
      completeness: "partial",
    }),
  listPosts: () => Effect.succeed({ data: [], completeness: "complete" }),
  listComments: () => Effect.succeed({ data: [], completeness: "complete" }),
  readInsights: () =>
    Effect.succeed({
      data: {
        kind: "account",
        followers: 420,
        publicEngagement: {},
        privateInsights: { reach: 2_400 },
      },
      completeness: "complete",
    }),
};

const publicProvider: PublicInstagramProviderShape = {
  searchProfiles: (query) =>
    Effect.succeed({
      data: [{ handle: query.replaceAll(" ", "_") }],
      completeness: "partial",
    }),
  readProfile: (handle) =>
    Effect.succeed({ data: { handle, biography: "bio pública" }, completeness: "complete" }),
  listPosts: () => Effect.succeed({ data: [], completeness: "complete" }),
  readPost: (postUrl) =>
    Effect.succeed({
      data: { id: "post-1", url: postUrl, mediaType: "video", publicEngagement: {} },
      completeness: "complete",
    }),
  listComments: () => Effect.succeed({ data: [], completeness: "complete" }),
};

const testLayer = instagramServiceLayer.pipe(
  Layer.provide(
    Layer.merge(
      Layer.succeed(ConnectedInstagramProvider, connected),
      Layer.succeed(PublicInstagramProvider, publicProvider),
    ),
  ),
);

describe("InstagramService", () => {
  it("routes connected reads to Upload-Post", async () => {
    const result = await Effect.runPromise(
      Effect.flatMap(InstagramService, (instagram) => instagram.readProfile(connectedTarget)).pipe(
        Effect.provide(testLayer),
      ),
    );

    expect(result.source).toBe("upload_post");
    expect(result.data).toMatchObject({ handle: "cafelumiar", name: "Café Lumiar" });
  });

  it("routes arbitrary profiles and search to Apify", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const instagram = yield* InstagramService;
        const search = yield* instagram.searchProfiles("cafe sp", 10);
        const profile = yield* instagram.readProfile({ scope: "public", handle: "externo" });
        return { search, profile };
      }).pipe(Effect.provide(testLayer)),
    );

    expect(result.search.source).toBe("apify");
    expect(result.search.data[0]?.handle).toBe("cafe_sp");
    expect(result.profile.source).toBe("apify");
    expect(result.profile.data.biography).toBe("bio pública");
  });

  it("rejects connected comments without an owned post id", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.flatMap(InstagramService, (instagram) =>
        instagram.listComments({ target: connectedTarget, limit: 20 }),
      ).pipe(Effect.provide(testLayer)),
    );

    expect(exit._tag).toBe("Failure");
  });
});
