export type InstagramSource = "upload_post" | "apify";
export type InstagramCompleteness = "complete" | "partial";

export interface InstagramObservation<T> {
  readonly data: T;
  readonly source: InstagramSource;
  readonly observedAt: number;
  readonly completeness: InstagramCompleteness;
  readonly nextCursor?: string | undefined;
}

export type InstagramTarget =
  | {
      readonly scope: "connected";
      /** Upload-Post profile username. Always the owning Vanda account id. */
      readonly publisherUsername: string;
      readonly handle: string;
    }
  | { readonly scope: "public"; readonly handle: string };

export interface InstagramPublicEngagement {
  readonly likes?: number | undefined;
  readonly comments?: number | undefined;
  readonly views?: number | undefined;
  readonly plays?: number | undefined;
  readonly shares?: number | undefined;
}

export interface InstagramPrivateInsights {
  readonly reach?: number | undefined;
  readonly impressions?: number | undefined;
  readonly saves?: number | undefined;
  readonly accountsEngaged?: number | undefined;
}

export interface InstagramProfile {
  readonly id?: string | undefined;
  readonly handle: string;
  readonly name?: string | undefined;
  readonly biography?: string | undefined;
  readonly website?: string | undefined;
  readonly category?: string | undefined;
  readonly profileImageUrl?: string | undefined;
  readonly followers?: number | undefined;
  readonly following?: number | undefined;
  readonly postsCount?: number | undefined;
  readonly private?: boolean | undefined;
  readonly verified?: boolean | undefined;
  readonly latestPosts?: ReadonlyArray<InstagramPost> | undefined;
}

export interface InstagramPost {
  readonly id: string;
  readonly url: string;
  readonly shortcode?: string | undefined;
  readonly ownerHandle?: string | undefined;
  readonly caption?: string | undefined;
  readonly publishedAt?: number | undefined;
  readonly mediaType: "image" | "video" | "carousel" | "unknown";
  readonly mediaUrl?: string | undefined;
  readonly thumbnailUrl?: string | undefined;
  readonly transcript?: string | undefined;
  readonly hashtags?: ReadonlyArray<string> | undefined;
  readonly mentions?: ReadonlyArray<string> | undefined;
  readonly durationSeconds?: number | undefined;
  readonly publicEngagement: InstagramPublicEngagement;
  readonly privateInsights?: InstagramPrivateInsights | undefined;
}

export interface InstagramComment {
  readonly id: string;
  readonly text: string;
  readonly username?: string | undefined;
  readonly timestamp?: number | undefined;
  readonly likes?: number | undefined;
  readonly replies?: ReadonlyArray<InstagramComment> | undefined;
}

export interface InstagramAccountInsights {
  readonly kind: "account";
  readonly followers?: number | undefined;
  readonly publicEngagement: InstagramPublicEngagement;
  readonly privateInsights: InstagramPrivateInsights;
  readonly demographics?: unknown;
}

export interface InstagramPostInsights {
  readonly kind: "post";
  readonly postId: string;
  readonly publicEngagement: InstagramPublicEngagement;
  readonly privateInsights: InstagramPrivateInsights;
}

export type InstagramInsights = InstagramAccountInsights | InstagramPostInsights;

export interface InstagramPage<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor?: string | undefined;
  readonly completeness: InstagramCompleteness;
}

export interface ProviderResult<T> {
  readonly data: T;
  readonly completeness: InstagramCompleteness;
  readonly nextCursor?: string | undefined;
}
