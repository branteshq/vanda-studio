import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  getInstagramAnalytics,
  getInstagramComments,
  getInstagramMedia,
  getInstagramPostAnalytics,
  getProfile,
  instagramProfileInfoOf,
} from "../../publisher/uploadpost";
import { ConnectedInstagramProvider, InstagramProviderFailed } from "../service";
import type {
  InstagramComment,
  InstagramPost,
  InstagramPrivateInsights,
  InstagramPublicEngagement,
} from "../types";

const optional = <K extends string, V>(
  key: K,
  value: V | null | undefined,
): Partial<Record<K, V>> =>
  value === null || value === undefined ? {} : ({ [key]: value } as Record<K, V>);

const mediaTypeOf = (value: string | null): InstagramPost["mediaType"] => {
  switch (value?.toUpperCase()) {
    case "IMAGE":
      return "image";
    case "VIDEO":
      return "video";
    case "CAROUSEL_ALBUM":
      return "carousel";
    default:
      return "unknown";
  }
};

const timestampOf = (value: string | null): number | undefined => {
  const parsed = value === null ? Number.NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const providerCall = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) =>
      new InstagramProviderFailed({
        provider: "upload_post",
        operation,
        message: error instanceof Error ? error.message : String(error),
      }),
  });

export const uploadPostInstagramProviderLayer: Layer.Layer<ConnectedInstagramProvider> =
  Layer.succeed(ConnectedInstagramProvider, {
    readProfile: (target) =>
      Effect.all(
        [
          providerCall("profile", () => getProfile(target.publisherUsername)),
          providerCall("analytics", () => getInstagramAnalytics(target.publisherUsername)).pipe(
            Effect.orElseSucceed(() => null),
          ),
        ] as const,
        { concurrency: 2 },
      ).pipe(
        Effect.flatMap(([profile, analytics]) => {
          if (profile === null) {
            return new InstagramProviderFailed({
              provider: "upload_post",
              operation: "profile",
              message: "publisher profile not found",
            });
          }
          const info = instagramProfileInfoOf(profile);
          return Effect.succeed({
            data: {
              handle: info.username ?? target.handle,
              ...optional("name", info.displayName),
              ...optional("followers", analytics?.followers),
            },
            completeness: "partial" as const,
          });
        }),
      ),
    listPosts: (target, options) =>
      providerCall("media", () =>
        getInstagramMedia(target.publisherUsername, {
          limit: options.limit,
          ...(options.cursor ? { cursor: options.cursor } : {}),
        }),
      ).pipe(
        Effect.map((page) => ({
          data: page.media.flatMap((media): ReadonlyArray<InstagramPost> => {
            if (media.permalink === null) return [];
            return [
              {
                id: media.id,
                url: media.permalink,
                mediaType: mediaTypeOf(media.mediaType),
                publicEngagement: {},
                ...optional("caption", media.caption),
                ...optional("publishedAt", timestampOf(media.timestamp)),
                ...optional("mediaUrl", media.mediaUrl),
                ...optional("thumbnailUrl", media.thumbnailUrl),
                ownerHandle: target.handle,
              },
            ];
          }),
          completeness: page.pagination.hasMore ? ("partial" as const) : ("complete" as const),
          ...(page.pagination.nextCursor ? { nextCursor: page.pagination.nextCursor } : {}),
        })),
      ),
    listComments: (target, input) =>
      providerCall("comments", () =>
        getInstagramComments(target.publisherUsername, input.postId, {
          limit: input.limit,
          ...(input.cursor ? { after: input.cursor } : {}),
        }),
      ).pipe(
        Effect.map((page) => ({
          data: page.comments.map(
            (comment): InstagramComment => ({
              id: comment.id,
              text: comment.text,
              ...optional("username", comment.username),
              ...optional("timestamp", timestampOf(comment.timestamp)),
            }),
          ),
          completeness: page.pagination.hasNext ? ("partial" as const) : ("complete" as const),
          ...(page.pagination.nextCursor ? { nextCursor: page.pagination.nextCursor } : {}),
        })),
      ),
    readInsights: (target, postId) =>
      postId === undefined
        ? providerCall("analytics", () => getInstagramAnalytics(target.publisherUsername)).pipe(
            Effect.map((analytics) => {
              const publicEngagement: InstagramPublicEngagement = {
                ...optional("likes", analytics.likes),
                ...optional("comments", analytics.comments),
                ...optional("views", analytics.views),
                ...optional("shares", analytics.shares),
              };
              const privateInsights: InstagramPrivateInsights = {
                ...optional("reach", analytics.reach),
                ...optional("impressions", analytics.views),
                ...optional("saves", analytics.saves),
                ...optional("accountsEngaged", analytics.profileViews),
              };
              return {
                data: {
                  kind: "account" as const,
                  ...optional("followers", analytics.followers),
                  publicEngagement,
                  privateInsights,
                  demographics: {
                    followers: analytics.followerDemographics,
                    engagedAudience: analytics.engagedAudienceDemographics,
                  },
                },
                completeness: "complete" as const,
              };
            }),
          )
        : providerCall("post_analytics", () =>
            getInstagramPostAnalytics(target.publisherUsername, postId),
          ).pipe(
            Effect.map((analytics) => ({
              data: {
                kind: "post" as const,
                postId: analytics.postId,
                publicEngagement: {
                  ...optional("likes", analytics.likes),
                  ...optional("comments", analytics.comments),
                  ...optional("views", analytics.views),
                  ...optional("shares", analytics.shares),
                },
                privateInsights: {
                  ...optional("reach", analytics.reach),
                  ...optional("impressions", analytics.impressions),
                  ...optional("saves", analytics.saves),
                },
              },
              completeness: "complete" as const,
            })),
          ),
  });
