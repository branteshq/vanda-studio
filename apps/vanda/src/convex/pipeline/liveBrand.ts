import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { BrandCorpusResult } from "./brand";
import {
  getInstagramAnalytics,
  getInstagramComments,
  getInstagramMedia,
  getProfile,
  instagramProfileInfoOf,
  type InstagramAnalytics,
  type InstagramComment,
  type InstagramCommentsPage,
  type InstagramMediaPage,
  type PublisherProfile,
} from "../publisher/uploadpost";

const MEDIA_LIMIT = 25;
const COMMENT_POST_LIMIT = 10;
const COMMENTS_PER_POST = 10;

export class InstagramReadFailed extends Data.TaggedError("InstagramReadFailed")<{
  readonly operation: string;
  readonly message: string;
}> {}

export interface InstagramReaderShape {
  readonly getProfile: (
    publisherUsername: string,
  ) => Effect.Effect<PublisherProfile | null, InstagramReadFailed>;
  readonly getMedia: (
    publisherUsername: string,
    limit: number,
  ) => Effect.Effect<InstagramMediaPage, InstagramReadFailed>;
  readonly getComments: (
    publisherUsername: string,
    postId: string,
    limit: number,
  ) => Effect.Effect<InstagramCommentsPage, InstagramReadFailed>;
  readonly getAnalytics: (
    publisherUsername: string,
  ) => Effect.Effect<InstagramAnalytics, InstagramReadFailed>;
}

export class InstagramReader extends Context.Service<InstagramReader, InstagramReaderShape>()(
  "@vanda/publisher/InstagramReader",
) {}

const fromUploadPost = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new InstagramReadFailed({
        operation,
        message: error instanceof Error ? error.message : String(error),
      }),
  });

/** Production reader for first-party Instagram data held by Upload-Post. */
export const uploadPostInstagramReaderLayer: Layer.Layer<InstagramReader> = Layer.succeed(
  InstagramReader,
  {
    getProfile: (publisherUsername) =>
      fromUploadPost("profile", () => getProfile(publisherUsername)),
    getMedia: (publisherUsername, limit) =>
      fromUploadPost("media", () => getInstagramMedia(publisherUsername, { limit })),
    getComments: (publisherUsername, postId, limit) =>
      fromUploadPost(`comments:${postId}`, () =>
        getInstagramComments(publisherUsername, postId, { limit }),
      ),
    getAnalytics: (publisherUsername) =>
      fromUploadPost("analytics", () => getInstagramAnalytics(publisherUsername)),
  },
);

/**
 * Assemble onboarding's corpus from the account connected through Upload-Post.
 * Media is required. Profile metadata, analytics, and comments are best-effort:
 * missing Meta permissions must not prevent a customer from finishing onboarding.
 */
export const fetchBrandCorpus = (
  publisherUsername: string,
  connectedHandle: string,
): Effect.Effect<BrandCorpusResult, InstagramReadFailed, InstagramReader> =>
  Effect.gen(function* () {
    const reader = yield* InstagramReader;
    const mediaPage = yield* reader.getMedia(publisherUsername, MEDIA_LIMIT);
    const [profile, analytics] = yield* Effect.all(
      [
        reader.getProfile(publisherUsername).pipe(Effect.orElseSucceed(() => null)),
        reader.getAnalytics(publisherUsername).pipe(Effect.orElseSucceed(() => null)),
      ] as const,
      { concurrency: 2 },
    );

    const commentGroups = yield* Effect.forEach(
      mediaPage.media.slice(0, COMMENT_POST_LIMIT),
      (media) =>
        reader.getComments(publisherUsername, media.id, COMMENTS_PER_POST).pipe(
          Effect.map((page) => page.comments),
          Effect.orElseSucceed((): ReadonlyArray<InstagramComment> => []),
        ),
      { concurrency: 4 },
    );
    const comments = commentGroups.flat();
    const profileInfo = profile === null ? null : instagramProfileInfoOf(profile);
    const captions = mediaPage.media.flatMap((media) =>
      media.caption !== null && media.caption.trim() !== "" ? [media.caption] : [],
    );

    return {
      corpus: {
        profile: {
          name: profileInfo?.displayName ?? connectedHandle,
          username: profileInfo?.username ?? connectedHandle,
          ...(!mediaPage.pagination.hasMore ? { mediaCount: mediaPage.media.length } : {}),
          ...(analytics?.followers !== null && analytics?.followers !== undefined
            ? { followers: analytics.followers }
            : {}),
          ...(analytics?.reach !== null && analytics?.reach !== undefined
            ? { reach: analytics.reach }
            : {}),
          ...(analytics?.views !== null && analytics?.views !== undefined
            ? { views: analytics.views }
            : {}),
        },
        captions,
        comments: comments.map((comment) => comment.text),
      },
      stats: { posts: mediaPage.media.length, comments: comments.length, mentions: 0 },
    } satisfies BrandCorpusResult;
  });
