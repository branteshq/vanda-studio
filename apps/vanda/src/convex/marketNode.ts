"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import {
  MarketDataProvider,
  adaptMarketOpportunity,
  apifyMarketDataLayer,
  planMarketSearch,
  rankCandidates,
  type MarketProfile,
  type MarketSearchPlan,
  type OpportunityAdaptation,
  type ReelDetail,
} from "./pipeline/market";
import { languageModelLayer, PIPELINE_MODELS, PROMPT_VERSIONS } from "./pipeline/liveModel";
import { runTracked } from "./pipeline/liveTelemetry";

const ACTIVE_WINDOW_MS = 1000 * 60 * 60 * 24 * 180;
const MIN_FOLLOWERS = 50;
const MAX_FOLLOWERS = 1_000;
const MAX_CANDIDATES_FOR_MODEL = 45;
const TARGET_CREATORS = 10;

export interface DiscoveryResult {
  readonly plan: MarketSearchPlan;
  readonly found: number;
  readonly selected: number;
}

export interface MarketRunResult {
  readonly selected: number;
  readonly plan?: MarketSearchPlan;
  readonly found?: number;
  readonly postsObserved?: number;
  readonly opportunitiesDetected?: number;
}

interface ObservationResult {
  readonly postsObserved: number;
  readonly snapshotsRecorded: number;
  readonly opportunityIds: ReadonlyArray<Id<"opportunities">>;
}

type RankedCandidate = {
  readonly profile: MarketProfile;
  readonly relevanceScore: number;
  readonly relevanceReason: string;
};

const activityScore = (profile: MarketProfile, now: number): number => {
  const recent = profile.latestPosts.filter((post) => now - post.publishedAt <= ACTIVE_WINDOW_MS);
  const video = recent.filter(
    (post) =>
      post.mediaType.toLocaleLowerCase() === "video" ||
      post.productType?.toLocaleLowerCase().includes("clip") === true,
  );
  return Math.min(1, recent.length / 6) * 0.55 + Math.min(1, video.length / 3) * 0.45;
};

const eligible = (profile: MarketProfile, ownHandle: string | undefined, now: number): boolean => {
  if (profile.private || profile.followers === undefined) return false;
  if (profile.followers < MIN_FOLLOWERS || profile.followers >= MAX_FOLLOWERS) return false;
  if (ownHandle && profile.handle.toLocaleLowerCase() === ownHandle.toLocaleLowerCase())
    return false;
  return profile.latestPosts.some((post) => now - post.publishedAt <= ACTIVE_WINDOW_MS);
};

const profileInput = (profile: MarketProfile, relevanceScore: number, relevanceReason: string) => ({
  handle: profile.handle,
  profileUrl: profile.profileUrl,
  private: profile.private,
  verified: profile.verified,
  relevanceScore,
  relevanceReason,
  ...(profile.externalId !== undefined ? { externalId: profile.externalId } : {}),
  ...(profile.displayName !== undefined ? { displayName: profile.displayName } : {}),
  ...(profile.biography !== undefined ? { biography: profile.biography } : {}),
  ...(profile.profileImageUrl !== undefined ? { profileImageUrl: profile.profileImageUrl } : {}),
  ...(profile.followers !== undefined ? { followers: profile.followers } : {}),
  ...(profile.following !== undefined ? { following: profile.following } : {}),
  ...(profile.postsCount !== undefined ? { postsCount: profile.postsCount } : {}),
  ...(profile.businessCategory !== undefined ? { businessCategory: profile.businessCategory } : {}),
  latestPosts: profile.latestPosts.map((post) => ({
    externalId: post.externalId,
    permalink: post.permalink,
    mediaType: post.mediaType,
    publishedAt: post.publishedAt,
    ...(post.shortCode !== undefined ? { shortCode: post.shortCode } : {}),
    ...(post.caption !== undefined ? { caption: post.caption } : {}),
    ...(post.productType !== undefined ? { productType: post.productType } : {}),
    ...(post.thumbnailUrl !== undefined ? { thumbnailUrl: post.thumbnailUrl } : {}),
    ...(post.videoUrl !== undefined ? { videoUrl: post.videoUrl } : {}),
    ...(post.views !== undefined ? { views: post.views } : {}),
    ...(post.plays !== undefined ? { plays: post.plays } : {}),
    ...(post.likes !== undefined ? { likes: post.likes } : {}),
    ...(post.comments !== undefined ? { comments: post.comments } : {}),
  })),
});

/** Discover and persist a small, active, relevant market set for one account. */
export const discoverAccount = internalAction({
  args: { accountId: v.id("accounts"), runId: v.id("marketRuns") },
  handler: async (ctx, { accountId, runId }): Promise<DiscoveryResult> => {
    const apifyToken = process.env.APIFY_API_TOKEN;
    const modelKey = process.env.OPENROUTER_API_KEY;
    if (!apifyToken) throw new Error("APIFY_API_TOKEN is not set on the Convex deployment");
    if (!modelKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");

    const brand: { readonly ownHandle: string | undefined; readonly context: string } =
      await ctx.runQuery(internal.market.loadBrandContext, { accountId });
    if (!brand.context.trim()) throw new Error("brand context is empty");

    try {
      await ctx.runMutation(internal.market.updateRun, { runId, stage: "planning_search" });
      const plan: MarketSearchPlan = await runTracked(
        ctx,
        {
          accountId,
          stage: "market_discovery",
          model: PIPELINE_MODELS.marketDiscovery,
          promptVersion: PROMPT_VERSIONS.marketDiscovery,
          inputIds: [accountId],
        },
        () =>
          Effect.runPromise(
            planMarketSearch(brand.context).pipe(
              Effect.provide(languageModelLayer(modelKey, PIPELINE_MODELS.marketDiscovery)),
            ),
          ),
        (result: MarketSearchPlan) => `${result.category}; ${result.profileQueries.length} buscas`,
      );

      await ctx.runMutation(internal.market.updateRun, {
        runId,
        stage: "searching_profiles",
        category: plan.category,
        location: plan.location,
        language: plan.language,
        searchQueries: [...plan.profileQueries],
      });

      const profiles = await Effect.runPromise(
        Effect.flatMap(MarketDataProvider, (provider) =>
          provider.searchProfiles(plan.profileQueries),
        ).pipe(Effect.provide(apifyMarketDataLayer(apifyToken))),
      );
      const now = Date.now();
      const candidates = profiles
        .filter((profile) => eligible(profile, brand.ownHandle, now))
        .sort((a, b) => activityScore(b, now) - activityScore(a, now))
        .slice(0, MAX_CANDIDATES_FOR_MODEL);

      await ctx.runMutation(internal.market.updateRun, {
        runId,
        stage: "ranking_candidates",
        creatorsFound: profiles.length,
      });

      const ranked: ReadonlyArray<RankedCandidate> =
        candidates.length === 0
          ? []
          : await runTracked(
              ctx,
              {
                accountId,
                stage: "market_discovery",
                model: PIPELINE_MODELS.marketDiscovery,
                promptVersion: PROMPT_VERSIONS.marketRanking,
                inputIds: candidates.map((profile) => profile.handle),
              },
              () =>
                Effect.runPromise(
                  rankCandidates(brand.context, plan, candidates).pipe(
                    Effect.provide(languageModelLayer(modelKey, PIPELINE_MODELS.marketDiscovery)),
                  ),
                ),
              (result: ReadonlyArray<RankedCandidate>) => `${result.length} perfis relevantes`,
            );

      const relevant =
        ranked.length > 0
          ? ranked
          : candidates.map((profile) => ({
              profile,
              relevanceScore: 0.6,
              relevanceReason: `Encontrado na busca “${plan.profileQueries[0] ?? plan.category}” e passou pelos filtros de tamanho e atividade.`,
            }));
      const selected = [...relevant]
        .sort((a, b) => {
          const aScore = a.relevanceScore * 0.7 + activityScore(a.profile, now) * 0.3;
          const bScore = b.relevanceScore * 0.7 + activityScore(b.profile, now) * 0.3;
          return bScore - aScore;
        })
        .slice(0, TARGET_CREATORS);
      const creatorRows = selected.map(({ profile, relevanceScore, relevanceReason }) =>
        profileInput(profile, relevanceScore, relevanceReason),
      );

      await ctx.runMutation(internal.market.saveSelectedCreators, {
        accountId,
        creators: creatorRows,
      });
      await ctx.runMutation(internal.market.updateRun, {
        runId,
        stage: "discovery_complete",
        creatorsFound: profiles.length,
        creatorsSelected: selected.length,
        summary:
          selected.length === TARGET_CREATORS
            ? `Vanda selecionou ${selected.length} contas para o radar.`
            : `Vanda encontrou ${selected.length} contas que passaram por todos os filtros.`,
      });
      return { plan, found: profiles.length, selected: selected.length };
    } catch (error) {
      await ctx.runMutation(internal.market.updateRun, {
        runId,
        status: "failed",
        stage: "failed",
        error: error instanceof Error ? error.message : String(error),
        complete: true,
      });
      throw error;
    }
  },
});

/** Refresh tracked profiles, persist Reel snapshots, and deterministically flag breakouts. */
export const observeAccount = internalAction({
  args: { accountId: v.id("accounts"), runId: v.id("marketRuns") },
  handler: async (ctx, { accountId, runId }): Promise<ObservationResult> => {
    const apifyToken = process.env.APIFY_API_TOKEN;
    if (!apifyToken) throw new Error("APIFY_API_TOKEN is not set on the Convex deployment");
    const creators: ReadonlyArray<Doc<"marketCreators">> = await ctx.runQuery(
      internal.market.listActiveCreators,
      { accountId },
    );
    if (creators.length === 0)
      return { postsObserved: 0, snapshotsRecorded: 0, opportunityIds: [] };

    await ctx.runMutation(internal.market.updateRun, { runId, stage: "observing_reels" });
    const profiles = await Effect.runPromise(
      Effect.flatMap(MarketDataProvider, (provider) =>
        provider.getProfiles(creators.map((creator) => creator.handle)),
      ).pipe(Effect.provide(apifyMarketDataLayer(apifyToken))),
    );
    const existingByHandle = new Map(creators.map((creator) => [creator.handle, creator]));
    const rows = profiles.map((profile) => {
      const existing = existingByHandle.get(profile.handle.toLocaleLowerCase());
      return profileInput(
        profile,
        existing?.relevanceScore ?? 0,
        existing?.relevanceReason ?? "Conta monitorada pelo radar.",
      );
    });
    return (await ctx.runMutation(internal.market.recordObservations, {
      accountId,
      creators: rows,
    })) as ObservationResult;
  },
});

const wrapSlide = (text: string, max = 24): string => {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= max) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 7).join("\n");
};

const renderSlides = (slides: ReadonlyArray<string>): Promise<ReadonlyArray<Blob>> =>
  Promise.all(
    slides.map(async (slide, index) => {
      // Intentionally constrained MVP renderer: a hosted PNG service turns the model's
      // copy into a real Instagram-compatible image. Swap this boundary for the branded
      // renderer later without touching opportunity or publishing state.
      const text = `${String(index + 1).padStart(2, "0")} / ${slides.length}\n\n${wrapSlide(slide)}`;
      const url = new URL("https://placehold.co/1080x1350/1b1424/ffffff.png");
      url.searchParams.set("text", text);
      url.searchParams.set("font", "roboto");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`slide render failed: HTTP ${response.status}`);
      return response.blob();
    }),
  );

/** Analyze one breakout, transform it to the brand, and persist a hosted carousel. */
export const analyzeOpportunity = internalAction({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, { opportunityId }): Promise<Id<"posts">> => {
    const apifyToken = process.env.APIFY_API_TOKEN;
    const modelKey = process.env.OPENROUTER_API_KEY;
    if (!apifyToken) throw new Error("APIFY_API_TOKEN is not set on the Convex deployment");
    if (!modelKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    const source: {
      opportunity: Doc<"opportunities">;
      post: Doc<"marketPosts">;
      creator: Doc<"marketCreators"> | null;
      brandContext: string;
    } | null = await ctx.runQuery(internal.market.loadOpportunity, { opportunityId });
    if (!source) throw new Error("opportunity source not found");

    try {
      await ctx.runMutation(internal.market.setOpportunityStatus, {
        opportunityId,
        status: "analyzing",
      });
      const detail: ReelDetail = await Effect.runPromise(
        Effect.flatMap(MarketDataProvider, (provider) =>
          provider.getReel(source.post.permalink),
        ).pipe(
          Effect.catch(() =>
            Effect.succeed({
              externalId: source.post.externalPostId,
              permalink: source.post.permalink,
              mediaType: source.post.mediaType,
              publishedAt: source.post.publishedAt,
              ...(source.post.caption ? { caption: source.post.caption } : {}),
              ...(source.post.videoUrl ? { videoUrl: source.post.videoUrl } : {}),
            }),
          ),
          Effect.provide(apifyMarketDataLayer(apifyToken)),
        ),
      );
      await ctx.runMutation(internal.market.setOpportunityStatus, {
        opportunityId,
        status: "adapting",
      });
      const adaptation: OpportunityAdaptation = await runTracked(
        ctx,
        {
          accountId: source.opportunity.accountId,
          stage: "market_adapt",
          model: PIPELINE_MODELS.marketAdapt,
          promptVersion: PROMPT_VERSIONS.marketAdapt,
          inputIds: [source.post.externalPostId],
        },
        () =>
          Effect.runPromise(
            adaptMarketOpportunity({
              transcript: detail.transcript,
              caption: detail.caption ?? source.post.caption,
              triggerReason: source.opportunity.triggerReason,
              brandContext: source.brandContext,
            }).pipe(Effect.provide(languageModelLayer(modelKey, PIPELINE_MODELS.marketAdapt))),
          ),
        (result: OpportunityAdaptation) => `${result.adaptedSlides.length} slides`,
      );
      const slides = adaptation.adaptedSlides.length
        ? adaptation.adaptedSlides
        : [adaptation.adaptedHook];
      const blobs = await renderSlides(slides);
      const storageIds = await Promise.all(blobs.map((blob) => ctx.storage.store(blob)));
      return await ctx.runMutation(internal.market.saveAdaptation, {
        opportunityId,
        ...(detail.transcript ? { transcript: detail.transcript } : {}),
        ...adaptation,
        adaptedSlides: [...slides],
        creatorSpecificElements: [...adaptation.creatorSpecificElements],
        storageIds,
      });
    } catch (error) {
      await ctx.runMutation(internal.market.setOpportunityStatus, {
        opportunityId,
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

/** Cron target: enqueue one full market pass for every onboarded account. */
export const runAllAccounts = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const accounts: Array<{ _id: Id<"accounts"> }> = await ctx.runQuery(
      internal.market.listOnboardedAccounts,
      {},
    );
    for (const account of accounts) {
      await ctx.scheduler.runAfter(0, internal.marketNode.runAccount, { accountId: account._id });
    }
  },
});

/** The manual button and hourly cron share this complete discover → observe entry point. */
export const runAccount = internalAction({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<MarketRunResult> => {
    let creators: ReadonlyArray<{ readonly _id: Id<"marketCreators"> }> = await ctx.runQuery(
      internal.market.listActiveCreators,
      { accountId },
    );
    const runId: Id<"marketRuns"> = await ctx.runMutation(internal.market.startRun, {
      accountId,
      kind: "full_loop",
      stage: creators.length === 0 ? "starting_discovery" : "starting_observation",
    });
    try {
      let discovery: DiscoveryResult | undefined;
      if (creators.length === 0) {
        discovery = (await ctx.runAction(internal.marketNode.discoverAccount, {
          accountId,
          runId,
        })) as DiscoveryResult;
        creators = await ctx.runQuery(internal.market.listActiveCreators, { accountId });
      }
      const observation = (await ctx.runAction(internal.marketNode.observeAccount, {
        accountId,
        runId,
      })) as ObservationResult;
      const opportunitiesToAdapt = observation.opportunityIds.slice(0, 1);
      for (const opportunityId of opportunitiesToAdapt) {
        await ctx.scheduler.runAfter(0, internal.marketNode.analyzeOpportunity, { opportunityId });
      }
      await ctx.runMutation(internal.market.updateRun, {
        runId,
        status: "succeeded",
        stage: "complete",
        creatorsSelected: creators.length,
        postsObserved: observation.postsObserved,
        snapshotsRecorded: observation.snapshotsRecorded,
        opportunitiesDetected: observation.opportunityIds.length,
        adaptationsCreated: opportunitiesToAdapt.length,
        summary: `${creators.length} contas · ${observation.postsObserved} vídeos · ${observation.opportunityIds.length} oportunidades novas.`,
        complete: true,
      });
      return {
        selected: creators.length,
        ...(discovery ? { plan: discovery.plan, found: discovery.found } : {}),
        postsObserved: observation.postsObserved,
        opportunitiesDetected: observation.opportunityIds.length,
      };
    } catch (error) {
      await ctx.runMutation(internal.market.updateRun, {
        runId,
        status: "failed",
        stage: "failed",
        error: error instanceof Error ? error.message : String(error),
        complete: true,
      });
      throw error;
    }
  },
});
