import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";
import {
  fetchBrandCorpus,
  InstagramReader,
  InstagramReadFailed,
  type InstagramReaderShape,
} from "./liveBrand";

const mediaPage = {
  media: [
    {
      id: "media-1",
      caption: "Café novo no balcão",
      mediaType: "IMAGE",
      mediaUrl: "https://cdn.example/1.jpg",
      permalink: "https://instagram.com/p/one",
      timestamp: "2026-01-01T12:00:00Z",
      thumbnailUrl: null,
    },
    {
      id: "media-2",
      caption: "Nosso golden voltou",
      mediaType: "VIDEO",
      mediaUrl: "https://cdn.example/2.mp4",
      permalink: "https://instagram.com/reel/two",
      timestamp: "2026-01-02T12:00:00Z",
      thumbnailUrl: "https://cdn.example/2.jpg",
    },
  ],
  pagination: { limit: 25, nextCursor: null, hasMore: false },
} as const;

const unavailable = (operation: string) =>
  Effect.fail(new InstagramReadFailed({ operation, message: "permission denied" }));

const readerLayer = (overrides: Partial<InstagramReaderShape> = {}) =>
  Layer.succeed(InstagramReader, {
    getProfile: () =>
      Effect.succeed({
        username: "account-1",
        socialAccounts: {
          instagram: { username: "cafelumiar", display_name: "Café Lumiar" },
        },
      }),
    getMedia: () => Effect.succeed(mediaPage),
    getComments: (_username, postId) =>
      Effect.succeed({
        comments: [
          {
            id: `comment-${postId}`,
            text: postId === "media-1" ? "Quero conhecer" : "O cachorro é lindo",
            timestamp: null,
            username: "cliente",
          },
        ],
        pagination: { nextCursor: null, hasNext: false },
      }),
    getAnalytics: () =>
      Effect.succeed({
        followers: 420,
        reach: 2_400,
        views: 3_200,
        profileViews: 80,
        likes: 120,
        comments: 14,
        shares: 8,
        saves: 22,
      }),
    ...overrides,
  });

describe("fetchBrandCorpus", () => {
  it("assembles connected profile, media, comments, and analytics", async () => {
    const result = await Effect.runPromise(
      fetchBrandCorpus("account-1", "cafelumiar").pipe(Effect.provide(readerLayer())),
    );

    expect(result).toEqual({
      corpus: {
        profile: {
          name: "Café Lumiar",
          username: "cafelumiar",
          mediaCount: 2,
          followers: 420,
          reach: 2_400,
          views: 3_200,
        },
        captions: ["Café novo no balcão", "Nosso golden voltou"],
        comments: ["Quero conhecer", "O cachorro é lindo"],
      },
      stats: { posts: 2, comments: 2, mentions: 0 },
    });
  });

  it("keeps onboarding usable when optional reads are unavailable", async () => {
    const result = await Effect.runPromise(
      fetchBrandCorpus("account-1", "cafelumiar").pipe(
        Effect.provide(
          readerLayer({
            getProfile: () => unavailable("profile"),
            getComments: () => unavailable("comments"),
            getAnalytics: () => unavailable("analytics"),
          }),
        ),
      ),
    );

    expect(result.corpus.profile).toEqual({
      name: "cafelumiar",
      username: "cafelumiar",
      mediaCount: 2,
    });
    expect(result.corpus.comments).toEqual([]);
    expect(result.stats).toEqual({ posts: 2, comments: 0, mentions: 0 });
  });
});
