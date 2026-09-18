import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  InstagramComment,
  InstagramInsights,
  InstagramObservation,
  InstagramPost,
  InstagramProfile,
  InstagramTarget,
  ProviderResult,
} from "./types";

export class InstagramProviderFailed extends Data.TaggedError("InstagramProviderFailed")<{
  readonly provider: "upload_post" | "apify";
  readonly operation: string;
  readonly message: string;
}> {}

export class InstagramRequestInvalid extends Data.TaggedError("InstagramRequestInvalid")<{
  readonly message: string;
}> {}

export type InstagramReadError = InstagramProviderFailed | InstagramRequestInvalid;

type ConnectedTarget = Extract<InstagramTarget, { scope: "connected" }>;

export interface ConnectedInstagramProviderService {
  readonly readProfile: (
    target: ConnectedTarget,
  ) => Effect.Effect<ProviderResult<InstagramProfile>, InstagramProviderFailed>;
  readonly listPosts: (
    target: ConnectedTarget,
    options: { readonly limit: number; readonly cursor?: string | undefined },
  ) => Effect.Effect<ProviderResult<ReadonlyArray<InstagramPost>>, InstagramProviderFailed>;
  readonly listComments: (
    target: ConnectedTarget,
    input: {
      readonly postId: string;
      readonly limit: number;
      readonly cursor?: string | undefined;
    },
  ) => Effect.Effect<ProviderResult<ReadonlyArray<InstagramComment>>, InstagramProviderFailed>;
  readonly readInsights: (
    target: ConnectedTarget,
    postId?: string | undefined,
  ) => Effect.Effect<ProviderResult<InstagramInsights>, InstagramProviderFailed>;
}

export class ConnectedInstagramProvider extends Context.Service<
  ConnectedInstagramProvider,
  ConnectedInstagramProviderService
>()("@vanda/instagram/ConnectedInstagramProvider") {}

export interface PublicInstagramProviderService {
  readonly searchProfiles: (
    query: string,
    limit: number,
  ) => Effect.Effect<ProviderResult<ReadonlyArray<InstagramProfile>>, InstagramProviderFailed>;
  readonly readProfile: (
    handle: string,
  ) => Effect.Effect<ProviderResult<InstagramProfile>, InstagramProviderFailed>;
  readonly listPosts: (
    handle: string,
    limit: number,
  ) => Effect.Effect<ProviderResult<ReadonlyArray<InstagramPost>>, InstagramProviderFailed>;
  readonly readPost: (
    postUrl: string,
    includeTranscript: boolean,
  ) => Effect.Effect<ProviderResult<InstagramPost>, InstagramProviderFailed>;
  readonly listComments: (
    postUrl: string,
    limit: number,
  ) => Effect.Effect<ProviderResult<ReadonlyArray<InstagramComment>>, InstagramProviderFailed>;
}

export class PublicInstagramProvider extends Context.Service<
  PublicInstagramProvider,
  PublicInstagramProviderService
>()("@vanda/instagram/PublicInstagramProvider") {}

export interface InstagramServiceApi {
  readonly searchProfiles: (
    query: string,
    limit: number,
  ) => Effect.Effect<InstagramObservation<ReadonlyArray<InstagramProfile>>, InstagramReadError>;
  readonly readProfile: (
    target: InstagramTarget,
  ) => Effect.Effect<InstagramObservation<InstagramProfile>, InstagramReadError>;
  readonly listPosts: (
    target: InstagramTarget,
    options: { readonly limit: number; readonly cursor?: string | undefined },
  ) => Effect.Effect<InstagramObservation<ReadonlyArray<InstagramPost>>, InstagramReadError>;
  readonly readPost: (
    postUrl: string,
    includeTranscript: boolean,
  ) => Effect.Effect<InstagramObservation<InstagramPost>, InstagramReadError>;
  readonly listComments: (input: {
    readonly target: InstagramTarget;
    readonly postId?: string | undefined;
    readonly postUrl?: string | undefined;
    readonly limit: number;
    readonly cursor?: string | undefined;
  }) => Effect.Effect<InstagramObservation<ReadonlyArray<InstagramComment>>, InstagramReadError>;
  readonly readInsights: (
    target: ConnectedTarget,
    postId?: string | undefined,
  ) => Effect.Effect<InstagramObservation<InstagramInsights>, InstagramReadError>;
}

export class InstagramService extends Context.Service<InstagramService, InstagramServiceApi>()(
  "@vanda/instagram/InstagramService",
) {}

interface MutableObservation<A> {
  data: A;
  source: InstagramObservation<A>["source"];
  observedAt: number;
  completeness: InstagramObservation<A>["completeness"];
  nextCursor?: string;
}

interface ConnectedCommentsRequest {
  postId: string;
  limit: number;
  cursor?: string;
}

const observation = <A>(
  source: InstagramObservation<A>["source"],
  result: ProviderResult<A>,
): InstagramObservation<A> => {
  const value: MutableObservation<A> = {
    data: result.data,
    source,
    observedAt: Date.now(),
    completeness: result.completeness,
  };

  if (result.nextCursor) value.nextCursor = result.nextCursor;

  return value;
};

export const instagramServiceLayer: Layer.Layer<
  InstagramService,
  never,
  ConnectedInstagramProvider | PublicInstagramProvider
> = Layer.effect(
  InstagramService,
  Effect.gen(function* () {
    const connected = yield* ConnectedInstagramProvider;
    const publicProvider = yield* PublicInstagramProvider;

    return InstagramService.of({
      searchProfiles: (query, limit) =>
        publicProvider
          .searchProfiles(query, limit)
          .pipe(Effect.map((result) => observation("apify", result))),
      readProfile: (target) =>
        target.scope === "connected"
          ? connected
              .readProfile(target)
              .pipe(Effect.map((result) => observation("upload_post", result)))
          : publicProvider
              .readProfile(target.handle)
              .pipe(Effect.map((result) => observation("apify", result))),
      listPosts: (target, options) =>
        target.scope === "connected"
          ? connected
              .listPosts(target, options)
              .pipe(Effect.map((result) => observation("upload_post", result)))
          : publicProvider
              .listPosts(target.handle, options.limit)
              .pipe(Effect.map((result) => observation("apify", result))),
      readPost: (postUrl, includeTranscript) =>
        publicProvider
          .readPost(postUrl, includeTranscript)
          .pipe(Effect.map((result) => observation("apify", result))),
      listComments: (input) => {
        if (input.target.scope === "connected") {
          if (!input.postId) {
            return new InstagramRequestInvalid({
              message: "postId is required for connected comments",
            });
          }

          const request: ConnectedCommentsRequest = {
            postId: input.postId,
            limit: input.limit,
          };

          if (input.cursor) request.cursor = input.cursor;

          return connected
            .listComments(input.target, request)
            .pipe(Effect.map((result) => observation("upload_post", result)));
        }

        if (!input.postUrl) {
          return new InstagramRequestInvalid({
            message: "postUrl is required for public comments",
          });
        }

        return publicProvider
          .listComments(input.postUrl, input.limit)
          .pipe(Effect.map((result) => observation("apify", result)));
      },
      readInsights: (target, postId) =>
        connected
          .readInsights(target, postId)
          .pipe(Effect.map((result) => observation("upload_post", result))),
    });
  }),
);
