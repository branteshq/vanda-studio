"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { getPostAnalytics } from "./publisher/uploadpost";
import {
  analyzeSourceMechanism,
  generateCreativeDirections,
  reviewCreativeBrief,
  scoreCreativeDirection,
  selectCreativeBrief,
  validateCreativePackage,
  validateDirectionSet,
  type BriefReview,
  type BriefSelection,
  type CreativeDirectorBrand,
  type CreativeDirectorSource,
  type MechanismAnalysis,
} from "./pipeline/creativeDirector";
import {
  MarketDataProvider,
  apifyMarketDataLayer,
  planMarketSearch,
  rankCandidates,
  type MarketProfile,
  type MarketSearchPlan,
  type RankedMarketProfile,
  type ReelDetail,
} from "./pipeline/market";
import {
  languageModelLayer,
  PIPELINE_MODELS,
  PROMPT_VERSIONS,
  type Mutable,
} from "./pipeline/liveModel";
import { isUsableSemanticText } from "./pipeline/inputQuality";
import { runTracked } from "./pipeline/liveTelemetry";
import {
  SourceUnderstanding,
  openRouterSourceUnderstandingLayer,
  type SourceEvidence,
} from "./pipeline/sourceUnderstanding";
import { publicError } from "../errors";

const ACTIVE_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

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

interface SourceAnalysisRequest {
  video: Blob;
  caption?: string;
}

type RankedCandidate = RankedMarketProfile;

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

const profileInput = (
  profile: MarketProfile,
  ranking: Pick<RankedCandidate, "relevanceScore" | "relevanceReason"> &
    Partial<Omit<RankedCandidate, "profile" | "relevanceScore" | "relevanceReason">>,
) => {
  const latestPosts = profile.latestPosts.map((post) => {
    const row = {
      externalId: post.externalId,
      permalink: post.permalink,
      mediaType: post.mediaType,
      publishedAt: post.publishedAt,
    };

    if (post.shortCode !== undefined) Object.assign(row, { shortCode: post.shortCode });

    if (post.caption !== undefined) Object.assign(row, { caption: post.caption });

    if (post.productType !== undefined) Object.assign(row, { productType: post.productType });

    if (post.thumbnailUrl !== undefined) Object.assign(row, { thumbnailUrl: post.thumbnailUrl });

    if (post.videoUrl !== undefined) Object.assign(row, { videoUrl: post.videoUrl });

    if (post.views !== undefined) Object.assign(row, { views: post.views });

    if (post.plays !== undefined) Object.assign(row, { plays: post.plays });

    if (post.likes !== undefined) Object.assign(row, { likes: post.likes });

    if (post.comments !== undefined) Object.assign(row, { comments: post.comments });

    return row;
  });

  const row = {
    handle: profile.handle,
    profileUrl: profile.profileUrl,
    private: profile.private,
    verified: profile.verified,
    relevanceScore: ranking.relevanceScore,
    relevanceReason: ranking.relevanceReason,
    latestPosts,
  };

  if (ranking.topicalOverlap !== undefined)
    Object.assign(row, { topicalOverlap: ranking.topicalOverlap });

  if (ranking.audienceOverlap !== undefined)
    Object.assign(row, { audienceOverlap: ranking.audienceOverlap });

  if (ranking.offerOverlap !== undefined)
    Object.assign(row, { offerOverlap: ranking.offerOverlap });

  if (ranking.geographicOverlap !== undefined)
    Object.assign(row, { geographicOverlap: ranking.geographicOverlap });

  if (ranking.languageMatch !== undefined)
    Object.assign(row, { languageMatch: ranking.languageMatch });

  if (ranking.contentActivity !== undefined)
    Object.assign(row, { contentActivity: ranking.contentActivity });

  if (ranking.relevanceConfidence !== undefined)
    Object.assign(row, { relevanceConfidence: ranking.relevanceConfidence });

  if (ranking.relevanceVetoes !== undefined)
    Object.assign(row, { relevanceVetoes: [...ranking.relevanceVetoes] });

  if (profile.externalId !== undefined) Object.assign(row, { externalId: profile.externalId });

  if (profile.displayName !== undefined) Object.assign(row, { displayName: profile.displayName });

  if (profile.biography !== undefined) Object.assign(row, { biography: profile.biography });

  if (profile.profileImageUrl !== undefined)
    Object.assign(row, { profileImageUrl: profile.profileImageUrl });

  if (profile.followers !== undefined) Object.assign(row, { followers: profile.followers });

  if (profile.following !== undefined) Object.assign(row, { following: profile.following });

  if (profile.postsCount !== undefined) Object.assign(row, { postsCount: profile.postsCount });

  if (profile.businessCategory !== undefined)
    Object.assign(row, { businessCategory: profile.businessCategory });

  return row;
};

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

      const feedback: ReadonlyArray<{
        handle: string;
        feedback: "relevant" | "irrelevant" | "blocked";
      }> = await ctx.runQuery(internal.market.listCreatorFeedback, {
        accountId,
        handles: profiles.map((profile) => profile.handle),
      });

      const excludedHandles = new Set(
        feedback.flatMap((item) =>
          item.feedback === "irrelevant" || item.feedback === "blocked" ? [item.handle] : [],
        ),
      );

      const candidates = profiles
        .filter(
          (profile) =>
            !excludedHandles.has(profile.handle.toLocaleLowerCase()) &&
            eligible(profile, brand.ownHandle, now),
        )
        .toSorted((a, b) => activityScore(b, now) - activityScore(a, now))
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

      const selected = [...ranked]
        .toSorted((a, b) => {
          const aScore = a.relevanceScore * 0.7 + activityScore(a.profile, now) * 0.3;
          const bScore = b.relevanceScore * 0.7 + activityScore(b.profile, now) * 0.3;

          return bScore - aScore;
        })
        .slice(0, TARGET_CREATORS);

      const creatorRows = selected.map(({ profile, ...ranking }) => profileInput(profile, ranking));

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

    const brandSnapshot: Doc<"brandSnapshots"> = await ctx.runMutation(
      internal.market.ensureBrandSnapshot,
      { accountId },
    );

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

      const ranking = {
        relevanceScore: existing?.relevanceScore ?? 0,
        relevanceReason: existing?.relevanceReason ?? "Conta monitorada pelo radar.",
      };

      if (existing?.topicalOverlap !== undefined)
        Object.assign(ranking, { topicalOverlap: existing.topicalOverlap });

      if (existing?.audienceOverlap !== undefined)
        Object.assign(ranking, { audienceOverlap: existing.audienceOverlap });

      if (existing?.offerOverlap !== undefined)
        Object.assign(ranking, { offerOverlap: existing.offerOverlap });

      if (existing?.geographicOverlap !== undefined)
        Object.assign(ranking, { geographicOverlap: existing.geographicOverlap });

      if (existing?.languageMatch !== undefined)
        Object.assign(ranking, { languageMatch: existing.languageMatch });

      if (existing?.contentActivity !== undefined)
        Object.assign(ranking, { contentActivity: existing.contentActivity });

      if (existing?.relevanceConfidence !== undefined)
        Object.assign(ranking, { relevanceConfidence: existing.relevanceConfidence });

      if (existing?.relevanceVetoes !== undefined)
        Object.assign(ranking, { relevanceVetoes: existing.relevanceVetoes });

      return profileInput(profile, ranking);
    });

    // SAFETY: recordObservations has the ObservationResult validator contract; generated internal
    // function references do not preserve that return type through this recursive module boundary.
    return (await ctx.runMutation(internal.market.recordObservations, {
      accountId,
      brandSnapshotId: brandSnapshot._id,
      creators: rows,
    })) as ObservationResult;
  },
});

const downloadSourceAsset = async (
  url: string | undefined,
  maxBytes: number,
): Promise<Blob | undefined> => {
  if (!url) return undefined;
  const response = await fetch(url, { redirect: "follow" });

  if (!response.ok) throw new Error(`asset HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") ?? "0");

  if (declaredSize > maxBytes) throw new Error(`asset exceeds ${maxBytes} bytes`);
  const blob = await response.blob();

  if (blob.size === 0) throw new Error("asset is empty");

  if (blob.size > maxBytes) throw new Error(`asset exceeds ${maxBytes} bytes`);

  return blob;
};

const likelyTranscriptLanguage = (text: string | undefined): string | undefined => {
  if (!text?.trim()) return undefined;
  const words = text.toLocaleLowerCase().match(/[\p{L}]{2,}/gu) ?? [];
  const portuguese = new Set(["a", "as", "com", "como", "de", "do", "e", "em", "para", "que"]);

  return words.filter((word) => portuguese.has(word)).length >= 2 ? "pt-BR" : undefined;
};

/** Hydrate a metric-qualified source into durable media and enforce the final input gate. */
export const qualifyOpportunity = internalAction({
  args: { opportunityId: v.id("opportunities"), analyzeAfter: v.optional(v.boolean()) },
  handler: async (ctx, { opportunityId, analyzeAfter }): Promise<boolean> => {
    const apifyToken = process.env.APIFY_API_TOKEN;
    const modelKey = process.env.OPENROUTER_API_KEY;

    if (!apifyToken) throw new Error("APIFY_API_TOKEN is not set on the Convex deployment");

    if (!modelKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");

    const source: {
      opportunity: Doc<"opportunities">;
      post: Doc<"marketPosts">;
      creator: Doc<"marketCreators"> | null;
      dossier: Doc<"sourceDossiers"> | null;
    } | null = await ctx.runQuery(internal.market.loadQualificationSource, { opportunityId });

    if (!source) throw new Error("opportunity source not found");

    if (source.opportunity.status === "rejected") return false;
    await ctx.runMutation(internal.usage.charge, {
      accountId: source.opportunity.accountId,
      kind: "scan",
      usd: APIFY_QUALIFY_ESTIMATE_USD,
      ref: "qualify",
    });

    if (!source.opportunity.brandSnapshotId) {
      const snapshot: Doc<"brandSnapshots"> = await ctx.runMutation(
        internal.market.ensureBrandSnapshot,
        { accountId: source.opportunity.accountId },
      );

      await ctx.runMutation(internal.market.attachOpportunityBrandSnapshot, {
        opportunityId,
        brandSnapshotId: snapshot._id,
      });
    }

    if (source.dossier?.status === "ready") {
      if (analyzeAfter)
        await ctx.scheduler.runAfter(0, internal.marketNode.directOpportunity, { opportunityId });

      return true;
    }

    let detail: ReelDetail | undefined;
    let providerError: string | undefined;

    try {
      detail = await Effect.runPromise(
        Effect.flatMap(MarketDataProvider, (provider) =>
          provider.getReel(source.post.permalink),
        ).pipe(Effect.provide(apifyMarketDataLayer(apifyToken))),
      );
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error);
    }

    const assetErrors: string[] = [];
    let videoBlob: Blob | undefined;
    let videoStorageId: Id<"_storage"> | undefined;
    let thumbnailStorageId: Id<"_storage"> | undefined;

    try {
      videoBlob = await downloadSourceAsset(detail?.videoUrl ?? source.post.videoUrl, 100_000_000);

      if (videoBlob) videoStorageId = await ctx.storage.store(videoBlob);
    } catch (error) {
      assetErrors.push(`video: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const thumbnail = await downloadSourceAsset(
        detail?.thumbnailUrl ?? source.post.thumbnailUrl,
        10_000_000,
      );

      if (thumbnail) thumbnailStorageId = await ctx.storage.store(thumbnail);
    } catch (error) {
      assetErrors.push(`thumbnail: ${error instanceof Error ? error.message : String(error)}`);
    }

    const providerTranscript = detail?.transcript?.trim() || undefined;
    const caption = detail?.caption?.trim() || source.post.caption?.trim() || undefined;
    let evidence: SourceEvidence | undefined;

    if (videoBlob) {
      try {
        evidence = await runTracked(
          ctx,
          {
            accountId: source.opportunity.accountId,
            stage: "market_source",
            model: PIPELINE_MODELS.marketSource,
            promptVersion: PROMPT_VERSIONS.marketSource,
            inputIds: [source.post.externalPostId],
          },
          () =>
            Effect.runPromise(
              Effect.flatMap(SourceUnderstanding, (service) => {
                const request: SourceAnalysisRequest = { video: videoBlob };

                if (caption) request.caption = caption;

                return service.analyze(request);
              }).pipe(Effect.provide(openRouterSourceUnderstandingLayer(modelKey))),
            ),
          (result: SourceEvidence) =>
            `${result.contentType}; ${result.frameEvidence.length} momentos`,
        );
      } catch (error) {
        assetErrors.push(
          `understanding: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const transcript = isUsableSemanticText(providerTranscript)
      ? providerTranscript
      : evidence?.transcript.trim() || undefined;

    const transcriptLanguage = evidence?.language || likelyTranscriptLanguage(transcript);

    const qualificationInput = {
      opportunityId,
      provider: "apify/instagram-reel-scraper",
      providerFetchedAt: Date.now(),
      frameStorageIds: thumbnailStorageId ? [thumbnailStorageId] : [],
    };

    if (caption) Object.assign(qualificationInput, { caption });

    if (transcript) Object.assign(qualificationInput, { transcript });

    if (transcriptLanguage) Object.assign(qualificationInput, { transcriptLanguage });

    if (evidence) {
      const frameEvidence = evidence.frameEvidence.map((frame) => {
        const item = { timestampMs: frame.timestampMs, description: frame.description };

        if (frame.onScreenText) Object.assign(item, { onScreenText: frame.onScreenText });

        return item;
      });

      Object.assign(qualificationInput, {
        transcriptConfidence: evidence.transcriptConfidence,
        visualDescription: evidence.visualDescription,
        visualConfidence: evidence.visualConfidence,
        frameEvidence,
      });
    }

    if (videoStorageId) Object.assign(qualificationInput, { videoStorageId });

    if (thumbnailStorageId) Object.assign(qualificationInput, { thumbnailStorageId });

    if (providerError || assetErrors.length)
      Object.assign(qualificationInput, {
        providerError: [providerError, ...assetErrors].filter(Boolean).join("; "),
      });

    const qualification: {
      decision: "qualified" | "rejected";
      dossierId: Id<"sourceDossiers">;
      qualityScore: number;
    } = await ctx.runMutation(internal.market.completeSourceQualification, qualificationInput);

    if (qualification.decision === "qualified" && analyzeAfter)
      await ctx.scheduler.runAfter(0, internal.marketNode.directOpportunity, { opportunityId });

    return qualification.decision === "qualified";
  },
});

/** Turn one qualified source into an independently reviewed, production-ready creative brief. */
export const directOpportunity = internalAction({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, { opportunityId }): Promise<Id<"creativeBriefs"> | null> => {
    const modelKey = process.env.OPENROUTER_API_KEY;

    if (!modelKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");

    const input: {
      opportunity: Doc<"opportunities">;
      post: Doc<"marketPosts">;
      creator: Doc<"marketCreators"> | null;
      dossier: Doc<"sourceDossiers">;
      brandSnapshot: Doc<"brandSnapshots">;
      brandFacts: ReadonlyArray<{ id: string; kind: string; text: string }>;
      authorizedAssets: ReadonlyArray<{ id: string; kind: string }>;
    } | null = await ctx.runQuery(internal.market.loadCreativeDirectorInput, { opportunityId });

    if (!input) throw new Error("qualified creative input not found");

    if (input.opportunity.creativeBriefId) return input.opportunity.creativeBriefId;

    if (input.opportunity.status !== "ready_for_analysis" && input.opportunity.status !== "failed")
      throw new Error("opportunity is not ready for creative direction");

    if (input.dossier.status !== "ready") throw new Error("source dossier is not ready");

    const source: CreativeDirectorSource = {
      triggerReason: input.opportunity.triggerReason,
      frameEvidence: input.dossier.frameEvidence ?? [],
    };

    if (input.creator?.handle) Object.assign(source, { creatorHandle: input.creator.handle });
    const sourceCaption = input.dossier.caption ?? input.post.caption;

    if (sourceCaption) Object.assign(source, { sourceCaption });

    if (input.dossier.transcript) Object.assign(source, { transcript: input.dossier.transcript });

    if (input.dossier.visualDescription)
      Object.assign(source, { visualDescription: input.dossier.visualDescription });

    const brand: CreativeDirectorBrand = {
      context: input.brandSnapshot.context,
      facts: input.brandFacts,
      authorizedAssets: input.authorizedAssets,
    };

    const allowedBrandFactIds = new Set(input.brandFacts.map((fact) => fact.id));
    const allowedAssetIds = new Set(input.authorizedAssets.map((asset) => asset.id));

    try {
      await ctx.runMutation(internal.market.setOpportunityStatus, {
        opportunityId,
        status: "analyzing",
      });

      const analysis: MechanismAnalysis = await runTracked(
        ctx,
        {
          accountId: input.opportunity.accountId,
          stage: "market_mechanism",
          model: PIPELINE_MODELS.marketMechanism,
          promptVersion: PROMPT_VERSIONS.marketMechanism,
          inputIds: [input.post.externalPostId, input.dossier._id],
        },
        () =>
          Effect.runPromise(
            analyzeSourceMechanism({ source }).pipe(
              Effect.provide(languageModelLayer(modelKey, PIPELINE_MODELS.marketMechanism)),
            ),
          ),
        (result: MechanismAnalysis) =>
          result.adaptable ? `${result.reusableMechanisms.length} mecanismos` : "fonte rejeitada",
      );

      // SAFETY: Convex arguments require mutable arrays, while the validated model result exposes
      // the same arrays as readonly; the mutation serializes them without mutating the value.
      const analysisId: Id<"creativeAnalyses"> = await ctx.runMutation(
        internal.market.saveCreativeAnalysis,
        {
          opportunityId,
          model: PIPELINE_MODELS.marketMechanism,
          promptVersion: PROMPT_VERSIONS.marketMechanism,
          ...(analysis as Mutable<MechanismAnalysis>),
        },
      );

      if (!analysis.adaptable) return null;

      const directionSet = await runTracked(
        ctx,
        {
          accountId: input.opportunity.accountId,
          stage: "market_directions",
          model: PIPELINE_MODELS.marketDirections,
          promptVersion: PROMPT_VERSIONS.marketDirections,
          inputIds: [analysisId, input.brandSnapshot._id],
        },
        () =>
          Effect.runPromise(
            generateCreativeDirections({ source, analysis, brand }).pipe(
              Effect.provide(languageModelLayer(modelKey, PIPELINE_MODELS.marketDirections)),
            ),
          ),
        (result) => `${result.directions.length} direções`,
      );

      const directionIssues = validateDirectionSet(directionSet.directions);

      if (directionSet.directions.length !== 3) {
        await ctx.runMutation(internal.market.rejectCreativeDirector, {
          opportunityId,
          reason: directionIssues.join(" · ") || "A diretora não produziu três direções.",
        });

        return null;
      }

      const scoredDirections = directionSet.directions.map((direction) => ({
        title: direction.title,
        concept: direction.concept,
        objective: direction.objective,
        targetAudience: direction.targetAudience,
        angle: direction.angle,
        hook: direction.hook,
        narrativeArc: direction.narrativeArc,
        visualDirection: direction.visualDirection,
        callToAction: direction.callToAction,
        brandFactIds: direction.brandFactIds,
        requiredAssets: direction.requiredAssets,
        retainedMechanisms: direction.retainedMechanisms,
        avoidedSourceElements: direction.avoidedSourceElements,
        brandFitScore: direction.brandFitScore,
        evidenceFitScore: direction.evidenceFitScore,
        noveltyScore: direction.noveltyScore,
        feasibilityScore: direction.feasibilityScore,
        riskScore: direction.riskScore,
        totalScore: scoreCreativeDirection(direction),
      }));

      // SAFETY: Convex serializes the validated direction array and does not mutate it; Mutable only
      // removes readonly modifiers to match the generated mutation argument contract.
      const directionIds: Array<Id<"creativeDirections">> = await ctx.runMutation(
        internal.market.saveCreativeDirections,
        {
          opportunityId,
          analysisId,
          model: PIPELINE_MODELS.marketDirections,
          promptVersion: PROMPT_VERSIONS.marketDirections,
          directions: scoredDirections as Mutable<typeof scoredDirections>,
        },
      );

      const selection: BriefSelection = await runTracked(
        ctx,
        {
          accountId: input.opportunity.accountId,
          stage: "market_selection",
          model: PIPELINE_MODELS.marketSelection,
          promptVersion: PROMPT_VERSIONS.marketSelection,
          inputIds: directionIds,
        },
        () =>
          Effect.runPromise(
            selectCreativeBrief({ analysis, directions: scoredDirections, brand }).pipe(
              Effect.provide(languageModelLayer(modelKey, PIPELINE_MODELS.marketSelection)),
            ),
          ),
        (result: BriefSelection) => `direção ${result.selectedDirectionNumber}`,
      );

      const selectedIndex = selection.selectedDirectionNumber - 1;
      const selectedDirection = scoredDirections[selectedIndex];
      const selectedDirectionId = directionIds[selectedIndex];

      if (
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= 3 ||
        !selectedDirection ||
        !selectedDirectionId
      ) {
        await ctx.runMutation(internal.market.rejectCreativeDirector, {
          opportunityId,
          reason: "A seleção retornou uma direção inexistente.",
        });

        return null;
      }

      await ctx.runMutation(internal.market.setOpportunityStatus, {
        opportunityId,
        status: "reviewing_brief",
      });

      const review: BriefReview = await runTracked(
        ctx,
        {
          accountId: input.opportunity.accountId,
          stage: "market_brief_review",
          model: PIPELINE_MODELS.marketBriefReview,
          promptVersion: PROMPT_VERSIONS.marketBriefReview,
          inputIds: [selectedDirectionId, analysisId],
        },
        () =>
          Effect.runPromise(
            reviewCreativeBrief({
              source,
              analysis,
              direction: selectedDirection,
              brief: selection.brief,
              brand,
            }).pipe(
              Effect.provide(languageModelLayer(modelKey, PIPELINE_MODELS.marketBriefReview)),
            ),
          ),
        (result: BriefReview) => result.decision,
      );

      const validation = validateCreativePackage({
        source,
        directions: scoredDirections,
        selection,
        review,
        allowedBrandFactIds,
        allowedAssetIds,
      });

      // SAFETY: The model brief was schema-validated and Convex only serializes this value; Mutable
      // removes readonly modifiers to satisfy the generated mutation argument contract.
      const briefId: Id<"creativeBriefs"> = await ctx.runMutation(
        internal.market.saveCreativeBrief,
        {
          opportunityId,
          analysisId,
          selectedDirectionId,
          selectionReason: selection.selectionReason,
          tradeoffs: [...selection.tradeoffs],
          rejectedDirectionReasons: [...selection.rejectedDirectionReasons],
          model: PIPELINE_MODELS.marketSelection,
          promptVersion: PROMPT_VERSIONS.marketSelection,
          reviewModel: PIPELINE_MODELS.marketBriefReview,
          reviewPromptVersion: PROMPT_VERSIONS.marketBriefReview,
          deterministicIssues: [...validation.issues],
          sourceSimilarity: validation.sourceSimilarity,
          ...(selection.brief as Mutable<BriefSelection["brief"]>),
          reviewDecision: review.decision,
          reviewSummary: review.summary,
          brandGrounding: review.brandGrounding.map((item) => ({ ...item })),
          unsupportedClaims: [...review.unsupportedClaims],
          similarityRisks: [...review.similarityRisks],
          missingAssets: [...review.missingAssets],
          reviewIssues: [...review.issues],
          reviewConfidence: review.confidence,
        },
      );

      // The brief is research output: Vanda reads it via /market and produces
      // the post herself (paint + run_code + create_post) — no auto-factory.
      return briefId;
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

/** Record lightweight publisher metrics for adaptations Instagram has published. */
export const measurePublications = internalAction({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<number> => {
    const publications: ReadonlyArray<{
      opportunityId: Id<"opportunities">;
      scheduledPostId: Id<"scheduledPosts">;
      externalPostId: string;
    }> = await ctx.runQuery(internal.market.listPublishedForMeasurement, { accountId });

    if (publications.length === 0) return 0;
    // One cached-analytics read covers every published post of the profile;
    // absent posts (fresh publish, snapshot lag) are skipped until next run.
    let analytics: Map<string, { views: number; likes: number; comments: number }>;

    try {
      analytics = await getPostAnalytics(String(accountId));
    } catch (error) {
      console.warn(`publisher analytics read failed for ${accountId}`, error);

      return 0;
    }

    let recorded = 0;

    for (const publication of publications) {
      const metrics = analytics.get(publication.externalPostId);

      if (metrics === undefined) continue;
      await ctx.runMutation(internal.market.recordPublicationSnapshot, {
        opportunityId: publication.opportunityId,
        scheduledPostId: publication.scheduledPostId,
        views: metrics.views,
        likes: metrics.likes,
        comments: metrics.comments,
      });
      recorded += 1;
    }

    return recorded;
  },
});

/** Flat Apify estimates per pass — tuned against the real bill via usageEvents. */
const APIFY_OBSERVE_ESTIMATE_USD = 0.05;

const APIFY_QUALIFY_ESTIMATE_USD = 0.01;

/** Owner-triggered legacy discover → observe entry point. */
export const runAccount = internalAction({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<MarketRunResult> => {
    const budget = await ctx.runQuery(internal.usage.budget, { accountId });

    if (!budget.ok) throw publicError("USAGE_LIMIT");
    // Charged up front: the Apify fetches happen regardless of what we find.
    await ctx.runMutation(internal.usage.charge, {
      accountId,
      kind: "scan",
      usd: APIFY_OBSERVE_ESTIMATE_USD,
      ref: "market-run",
    });

    let creators: ReadonlyArray<{
      readonly _id: Id<"marketCreators">;
      readonly relevanceScore: number;
    }> = await ctx.runQuery(internal.market.listActiveCreators, { accountId });

    const needsDiscovery = creators.every((creator) => creator.relevanceScore < 0.65);

    const runId: Id<"marketRuns"> = await ctx.runMutation(internal.market.startRun, {
      accountId,
      kind: "full_loop",
      stage: needsDiscovery ? "starting_discovery" : "starting_observation",
    });

    try {
      let discovery: DiscoveryResult | undefined;

      if (needsDiscovery) {
        // SAFETY: discoverAccount declares DiscoveryResult, but recursive generated action references
        // lose return-type precision across this module boundary.
        discovery = (await ctx.runAction(internal.marketNode.discoverAccount, {
          accountId,
          runId,
        })) as DiscoveryResult;
        creators = await ctx.runQuery(internal.market.listActiveCreators, { accountId });
      }

      // SAFETY: observeAccount declares ObservationResult, but recursive generated action references
      // lose return-type precision across this module boundary.
      const observation = (await ctx.runAction(internal.marketNode.observeAccount, {
        accountId,
        runId,
      })) as ObservationResult;

      for (const [index, opportunityId] of observation.opportunityIds.entries()) {
        await ctx.scheduler.runAfter(0, internal.marketNode.qualifyOpportunity, {
          opportunityId,
          analyzeAfter: index === 0,
        });
      }

      await ctx.runAction(internal.marketNode.measurePublications, { accountId });
      await ctx.runMutation(internal.market.updateRun, {
        runId,
        status: "succeeded",
        stage: "complete",
        creatorsSelected: creators.length,
        postsObserved: observation.postsObserved,
        snapshotsRecorded: observation.snapshotsRecorded,
        opportunitiesDetected: observation.opportunityIds.length,
        adaptationsCreated: 0,
        summary: `${creators.length} contas · ${observation.postsObserved} vídeos · ${observation.opportunityIds.length} oportunidades novas.`,
        complete: true,
      });

      const result: MarketRunResult = {
        selected: creators.length,
        postsObserved: observation.postsObserved,
        opportunitiesDetected: observation.opportunityIds.length,
      };

      if (discovery) Object.assign(result, { plan: discovery.plan, found: discovery.found });

      return result;
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
