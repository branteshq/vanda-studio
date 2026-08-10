import * as Effect from "effect/Effect";
import type { BrandCorpusResult } from "./brand";
import { MarketDataProvider, MarketProviderFailed } from "./market";

/**
 * Assemble the cold-start brand corpus from the account's PUBLIC profile via
 * the market data provider (the same scraper the market radar uses): profile
 * facts plus the captions of recent posts. Comment text isn't available on
 * this route, so the comments count reads 0 — the trust line stays honest.
 */
export const fetchBrandCorpus = (
  handle: string,
): Effect.Effect<BrandCorpusResult, MarketProviderFailed, MarketDataProvider> =>
  Effect.gen(function* () {
    const provider = yield* MarketDataProvider;
    const profiles = yield* provider.getProfiles([handle]);
    const profile = profiles[0];
    if (profile === undefined) {
      return yield* new MarketProviderFailed({
        operation: "getProfiles",
        message: `perfil @${handle} não encontrado`,
      });
    }
    const captions = profile.latestPosts.flatMap((post) =>
      post.caption !== undefined && post.caption.trim() !== "" ? [post.caption] : [],
    );
    return {
      corpus: {
        profile: {
          name: profile.displayName,
          username: profile.handle,
          biography: profile.biography,
          accountType: profile.businessCategory,
          mediaCount: profile.postsCount,
        },
        captions,
        comments: [],
      },
      stats: { posts: profile.latestPosts.length, comments: 0, mentions: 0 },
    } satisfies BrandCorpusResult;
  });
