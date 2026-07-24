import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import { marketRunKinds, marketRunStatuses, opportunityStatuses } from "./pipeline/constants";
import {
  BREAKOUT_DETECTOR_VERSION,
  MAX_SOURCE_AGE_MS,
  assessBrandReadiness,
  assessFinalInput,
  assessPreflightInput,
  isUsableSemanticText,
  brandSnapshotHash,
} from "./pipeline/inputQuality";
import { detectBreakout } from "./pipeline/market";

const optionalCount = v.optional(v.number());

export const authorize = internalQuery({
  args: { accountId: v.id("accounts"), clerkId: v.string() },
  handler: async (ctx, { accountId, clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
    const account = await ctx.db.get(accountId);
    if (!user || !account || account.ownerUserId !== user._id) throw new Error("account not found");
    return true;
  },
});

export const loadBrandContext = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    const connection = account?.connectionId ? await ctx.db.get(account.connectionId) : null;
    const canon = await ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const themes = await ctx.db
      .query("themes")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const confirmed = canon.filter((item) => item.confirmedByOwner);
    const readiness = assessBrandReadiness({
      confirmedKinds: confirmed.map((item) => item.kind),
    });
    return {
      ownHandle: connection?.handle,
      context: [
        ...confirmed.map((item) => `${item.kind}: ${item.text}`),
        ...themes.map((theme) => `tema: ${theme.name} — ${theme.summary}`),
      ].join("\n"),
      canonIds: confirmed.map((item) => item._id),
      readiness,
    };
  },
});

export const ensureBrandSnapshot = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const canon = (
      await ctx.db
        .query("brandCanon")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    ).filter((item) => item.confirmedByOwner);
    const themes = await ctx.db
      .query("themes")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const contextLines = [
      ...canon.map((item) => `${item.kind}: ${item.text}`),
      ...themes.map((theme) => `tema: ${theme.name} — ${theme.summary}`),
    ];
    const hash = brandSnapshotHash(contextLines);
    const existing = await ctx.db
      .query("brandSnapshots")
      .withIndex("by_account_hash", (q) => q.eq("accountId", accountId).eq("hash", hash))
      .first();
    if (existing) return existing;
    const readiness = assessBrandReadiness({
      confirmedKinds: canon.map((item) => item.kind),
    });
    const snapshotId = await ctx.db.insert("brandSnapshots", {
      accountId,
      context: contextLines.join("\n"),
      canonIds: canon.map((item) => item._id),
      hash,
      readinessScore: readiness.score,
      missingRequired: [...readiness.missingRequired],
      missingRecommended: [...readiness.missingRecommended],
      createdAt: Date.now(),
    });
    return (await ctx.db.get(snapshotId))!;
  },
});

export const startRun = internalMutation({
  args: {
    accountId: v.id("accounts"),
    kind: v.union(...marketRunKinds.map((kind) => v.literal(kind))),
    stage: v.string(),
  },
  handler: (ctx, { accountId, kind, stage }) =>
    ctx.db.insert("marketRuns", {
      accountId,
      kind,
      status: "running",
      stage,
      startedAt: Date.now(),
      creatorsFound: 0,
      creatorsSelected: 0,
      postsObserved: 0,
      snapshotsRecorded: 0,
      opportunitiesDetected: 0,
      adaptationsCreated: 0,
    }),
});

export const updateRun = internalMutation({
  args: {
    runId: v.id("marketRuns"),
    status: v.optional(v.union(...marketRunStatuses.map((status) => v.literal(status)))),
    stage: v.optional(v.string()),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    language: v.optional(v.string()),
    searchQueries: v.optional(v.array(v.string())),
    creatorsFound: optionalCount,
    creatorsSelected: optionalCount,
    postsObserved: optionalCount,
    snapshotsRecorded: optionalCount,
    opportunitiesDetected: optionalCount,
    adaptationsCreated: optionalCount,
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    complete: v.optional(v.boolean()),
  },
  handler: async (ctx, { runId, complete, ...patch }) => {
    await ctx.db.patch(runId, {
      ...patch,
      ...(complete ? { completedAt: Date.now() } : {}),
    });
  },
});

const marketPostArg = v.object({
  externalId: v.string(),
  shortCode: v.optional(v.string()),
  permalink: v.string(),
  caption: v.optional(v.string()),
  mediaType: v.string(),
  productType: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  videoUrl: v.optional(v.string()),
  publishedAt: v.number(),
  views: v.optional(v.number()),
  plays: v.optional(v.number()),
  likes: v.optional(v.number()),
  comments: v.optional(v.number()),
});

const selectedCreatorArg = v.object({
  externalId: v.optional(v.string()),
  handle: v.string(),
  displayName: v.optional(v.string()),
  profileUrl: v.string(),
  biography: v.optional(v.string()),
  profileImageUrl: v.optional(v.string()),
  followers: v.optional(v.number()),
  following: v.optional(v.number()),
  postsCount: v.optional(v.number()),
  businessCategory: v.optional(v.string()),
  private: v.boolean(),
  verified: v.boolean(),
  relevanceScore: v.number(),
  relevanceReason: v.string(),
  topicalOverlap: v.optional(v.number()),
  audienceOverlap: v.optional(v.number()),
  offerOverlap: v.optional(v.number()),
  geographicOverlap: v.optional(v.number()),
  languageMatch: v.optional(v.number()),
  contentActivity: v.optional(v.number()),
  relevanceConfidence: v.optional(v.number()),
  relevanceVetoes: v.optional(v.array(v.string())),
  latestPosts: v.array(marketPostArg),
});

export const saveSelectedCreators = internalMutation({
  args: { accountId: v.id("accounts"), creators: v.array(selectedCreatorArg) },
  handler: async (ctx, { accountId, creators }) => {
    const now = Date.now();
    const ids = [];
    const selectedHandles = new Set(creators.map((creator) => creator.handle.toLocaleLowerCase()));
    for (const creator of creators) {
      const handle = creator.handle.toLocaleLowerCase();
      const existing = await ctx.db
        .query("marketCreators")
        .withIndex("by_account_handle", (q) => q.eq("accountId", accountId).eq("handle", handle))
        .unique();
      const { latestPosts: _latestPosts, ...profile } = creator;
      if (existing) {
        if (existing.feedback === "blocked" || existing.feedback === "irrelevant") continue;
        await ctx.db.patch(existing._id, {
          ...profile,
          handle,
          status: "active",
          updatedAt: now,
        });
        ids.push(existing._id);
      } else {
        ids.push(
          await ctx.db.insert("marketCreators", {
            accountId,
            ...profile,
            handle,
            status: "active",
            discoveredAt: now,
            updatedAt: now,
          }),
        );
      }
    }
    if (selectedHandles.size > 0) {
      const accountCreators = await ctx.db
        .query("marketCreators")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect();
      for (const creator of accountCreators) {
        if (
          creator.status === "active" &&
          creator.feedback !== "relevant" &&
          !selectedHandles.has(creator.handle)
        )
          await ctx.db.patch(creator._id, { status: "paused", updatedAt: now });
      }
    }
    return ids;
  },
});

export const listCreatorFeedback = internalQuery({
  args: { accountId: v.id("accounts"), handles: v.array(v.string()) },
  handler: async (ctx, { accountId, handles }) => {
    const rows = [];
    for (const rawHandle of handles) {
      const handle = rawHandle.toLocaleLowerCase();
      const creator = await ctx.db
        .query("marketCreators")
        .withIndex("by_account_handle", (q) => q.eq("accountId", accountId).eq("handle", handle))
        .unique();
      if (creator?.feedback) rows.push({ handle, feedback: creator.feedback });
    }
    return rows;
  },
});

export const listOnboardedAccounts = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("accounts").collect()).filter(
      (account) => account.onboardedAt !== undefined,
    ),
});

export const listActiveCreators = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) =>
    (
      await ctx.db
        .query("marketCreators")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    ).filter((creator) => creator.status === "active"),
});

export const recordObservations = internalMutation({
  args: {
    accountId: v.id("accounts"),
    brandSnapshotId: v.id("brandSnapshots"),
    creators: v.array(selectedCreatorArg),
  },
  handler: async (ctx, { accountId, brandSnapshotId, creators }) => {
    const brandSnapshot = await ctx.db.get(brandSnapshotId);
    if (!brandSnapshot || brandSnapshot.accountId !== accountId)
      throw new Error("brand snapshot not found");
    const observedAt = Date.now();
    let postsObserved = 0;
    let snapshotsRecorded = 0;
    const opportunityIds = [];

    for (const input of creators) {
      const handle = input.handle.toLocaleLowerCase();
      const creator = await ctx.db
        .query("marketCreators")
        .withIndex("by_account_handle", (q) => q.eq("accountId", accountId).eq("handle", handle))
        .unique();
      if (!creator || creator.status !== "active") continue;
      await ctx.db.patch(creator._id, {
        ...(input.followers !== undefined ? { followers: input.followers } : {}),
        ...(input.following !== undefined ? { following: input.following } : {}),
        ...(input.postsCount !== undefined ? { postsCount: input.postsCount } : {}),
        ...(input.profileImageUrl !== undefined ? { profileImageUrl: input.profileImageUrl } : {}),
        lastObservedAt: observedAt,
        updatedAt: observedAt,
      });

      for (const inputPost of input.latestPosts) {
        const isVideo =
          inputPost.mediaType.toLocaleLowerCase() === "video" ||
          inputPost.productType?.toLocaleLowerCase().includes("clip") === true;
        if (!isVideo) continue;
        postsObserved += 1;
        const existing = await ctx.db
          .query("marketPosts")
          .withIndex("by_creator_external", (q) =>
            q.eq("creatorId", creator._id).eq("externalPostId", inputPost.externalId),
          )
          .unique();
        let marketPostId;
        if (existing) {
          marketPostId = existing._id;
          await ctx.db.patch(existing._id, {
            permalink: inputPost.permalink,
            ...(inputPost.caption !== undefined ? { caption: inputPost.caption } : {}),
            ...(inputPost.thumbnailUrl !== undefined
              ? { thumbnailUrl: inputPost.thumbnailUrl }
              : {}),
            ...(inputPost.videoUrl !== undefined ? { videoUrl: inputPost.videoUrl } : {}),
            lastObservedAt: observedAt,
          });
        } else {
          marketPostId = await ctx.db.insert("marketPosts", {
            accountId,
            creatorId: creator._id,
            externalPostId: inputPost.externalId,
            permalink: inputPost.permalink,
            mediaType: inputPost.mediaType,
            publishedAt: inputPost.publishedAt,
            firstObservedAt: observedAt,
            lastObservedAt: observedAt,
            ...(inputPost.shortCode !== undefined ? { shortCode: inputPost.shortCode } : {}),
            ...(inputPost.caption !== undefined ? { caption: inputPost.caption } : {}),
            ...(inputPost.productType !== undefined ? { productType: inputPost.productType } : {}),
            ...(inputPost.thumbnailUrl !== undefined
              ? { thumbnailUrl: inputPost.thumbnailUrl }
              : {}),
            ...(inputPost.videoUrl !== undefined ? { videoUrl: inputPost.videoUrl } : {}),
          });
        }

        const previous = await ctx.db
          .query("metricSnapshots")
          .withIndex("by_market_post_observed", (q) => q.eq("marketPostId", marketPostId))
          .order("desc")
          .first();
        const current = {
          observedAt,
          followers: input.followers ?? creator.followers,
          views: inputPost.views,
          plays: inputPost.plays,
          likes: inputPost.likes,
          comments: inputPost.comments,
        };
        const snapshotId = await ctx.db.insert("metricSnapshots", {
          accountId,
          subjectType: "source_post",
          marketPostId,
          observedAt,
          ...(current.followers !== undefined ? { followers: current.followers } : {}),
          ...(current.views !== undefined ? { views: current.views } : {}),
          ...(current.plays !== undefined ? { plays: current.plays } : {}),
          ...(current.likes !== undefined ? { likes: current.likes } : {}),
          ...(current.comments !== undefined ? { comments: current.comments } : {}),
        });
        snapshotsRecorded += 1;

        const alreadyFlagged = await ctx.db
          .query("opportunities")
          .withIndex("by_market_post", (q) => q.eq("marketPostId", marketPostId))
          .first();
        if (alreadyFlagged) continue;
        const decision = detectBreakout(current, previous ?? undefined, {
          now: observedAt,
          publishedAt: inputPost.publishedAt,
        });
        if (!decision) continue;
        const assessment = assessPreflightInput({
          now: observedAt,
          publishedAt: inputPost.publishedAt,
          followers: current.followers,
          views: current.views,
          plays: current.plays,
          creatorRelevanceScore: creator.relevanceScore,
          creatorBlocked: creator.feedback === "blocked" || creator.feedback === "irrelevant",
          brandReady: brandSnapshot.missingRequired.length === 0,
        });
        const assessmentId = await ctx.db.insert("inputAssessments", {
          accountId,
          marketPostId,
          brandSnapshotId,
          decision: assessment.decision,
          stage: "preflight",
          detectorVersion: BREAKOUT_DETECTOR_VERSION,
          postAgeMs: Math.max(0, observedAt - inputPost.publishedAt),
          qualityScore: assessment.qualityScore,
          rejectionCodes: [...assessment.rejectionCodes],
          warnings: [...assessment.warnings],
          snapshotIds: previous ? [previous._id, snapshotId] : [snapshotId],
          evaluatedAt: observedAt,
        });
        const opportunityId = await ctx.db.insert("opportunities", {
          accountId,
          marketPostId,
          status: assessment.decision === "qualified" ? "qualifying" : "rejected",
          score: decision.score,
          triggerType: decision.triggerType,
          triggerReason: decision.reason,
          triggeredAt: observedAt,
          detectorVersion: decision.detectorVersion,
          eligibleUntil: inputPost.publishedAt + MAX_SOURCE_AGE_MS,
          postAgeAtDetection: Math.max(0, observedAt - inputPost.publishedAt),
          brandSnapshotId,
          inputAssessmentId: assessmentId,
          ...(assessment.rejectionCodes.length > 0
            ? { rejectionCodes: [...assessment.rejectionCodes] }
            : {}),
          createdAt: observedAt,
          updatedAt: observedAt,
        });
        await ctx.db.patch(assessmentId, { opportunityId });
        if (assessment.decision === "qualified") opportunityIds.push(opportunityId);
      }
    }

    return { postsObserved, snapshotsRecorded, opportunityIds };
  },
});

export const loadQualificationSource = internalQuery({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, { opportunityId }) => {
    const opportunity = await ctx.db.get(opportunityId);
    if (!opportunity) return null;
    const post = await ctx.db.get(opportunity.marketPostId);
    if (!post) return null;
    const creator = await ctx.db.get(post.creatorId);
    const dossier = await ctx.db
      .query("sourceDossiers")
      .withIndex("by_market_post", (q) => q.eq("marketPostId", post._id))
      .first();
    return { opportunity, post, creator, dossier };
  },
});

export const attachOpportunityBrandSnapshot = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
    brandSnapshotId: v.id("brandSnapshots"),
  },
  handler: async (ctx, { opportunityId, brandSnapshotId }) => {
    const opportunity = await ctx.db.get(opportunityId);
    const snapshot = await ctx.db.get(brandSnapshotId);
    if (!opportunity || !snapshot || opportunity.accountId !== snapshot.accountId)
      throw new Error("opportunity brand snapshot mismatch");
    if (!opportunity.brandSnapshotId)
      await ctx.db.patch(opportunityId, { brandSnapshotId, status: "qualifying" });
  },
});

export const completeSourceQualification = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
    provider: v.string(),
    providerFetchedAt: v.number(),
    caption: v.optional(v.string()),
    transcript: v.optional(v.string()),
    transcriptLanguage: v.optional(v.string()),
    videoStorageId: v.optional(v.id("_storage")),
    thumbnailStorageId: v.optional(v.id("_storage")),
    frameStorageIds: v.array(v.id("_storage")),
    visualDescription: v.optional(v.string()),
    providerError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity) throw new Error("opportunity not found");
    const post = await ctx.db.get(opportunity.marketPostId);
    if (!post) throw new Error("market post not found");
    const creator = await ctx.db.get(post.creatorId);
    if (!creator) throw new Error("market creator not found");
    const brandSnapshot = opportunity.brandSnapshotId
      ? await ctx.db.get(opportunity.brandSnapshotId)
      : null;
    if (!brandSnapshot) throw new Error("brand snapshot not found");
    const latestSnapshot = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_market_post_observed", (q) => q.eq("marketPostId", post._id))
      .order("desc")
      .first();
    if (!latestSnapshot) throw new Error("metric snapshot not found");

    const assessment = assessFinalInput({
      now: args.providerFetchedAt,
      publishedAt: post.publishedAt,
      followers: latestSnapshot.followers,
      views: latestSnapshot.views,
      plays: latestSnapshot.plays,
      creatorRelevanceScore: creator.relevanceScore,
      creatorBlocked: creator.feedback === "blocked" || creator.feedback === "irrelevant",
      brandReady: brandSnapshot.missingRequired.length === 0,
      caption: args.caption ?? post.caption,
      transcript: args.transcript,
      hasDurableVideo: args.videoStorageId !== undefined,
      hasDurableThumbnail: args.thumbnailStorageId !== undefined,
      frameCount: args.frameStorageIds.length,
      visualDescription: args.visualDescription,
    });
    const hasUsableTranscript = isUsableSemanticText(args.transcript);
    const hasUsableCaption = isUsableSemanticText(args.caption ?? post.caption);
    const hasUsableVisualEvidence =
      args.videoStorageId !== undefined ||
      args.frameStorageIds.length >= 3 ||
      args.thumbnailStorageId !== undefined;
    const contentType: "mixed" | "spoken" | "visual" | "unknown" = hasUsableTranscript
      ? hasUsableVisualEvidence
        ? "mixed"
        : "spoken"
      : hasUsableVisualEvidence
        ? "visual"
        : "unknown";
    const now = Date.now();
    const existingDossier = await ctx.db
      .query("sourceDossiers")
      .withIndex("by_market_post", (q) => q.eq("marketPostId", post._id))
      .first();
    const dossierPatch = {
      accountId: opportunity.accountId,
      marketPostId: post._id,
      status: assessment.decision === "qualified" ? ("ready" as const) : ("rejected" as const),
      provider: args.provider,
      providerFetchedAt: args.providerFetchedAt,
      frameStorageIds: args.frameStorageIds,
      contentType,
      hasUsableVideo: args.videoStorageId !== undefined,
      hasUsableTranscript,
      hasUsableCaption,
      hasUsableVisualEvidence,
      qualityScore: assessment.qualityScore,
      rejectionCodes: [...assessment.rejectionCodes],
      ...(args.caption !== undefined ? { caption: args.caption } : {}),
      ...(args.transcript !== undefined ? { transcript: args.transcript } : {}),
      ...(args.transcriptLanguage !== undefined
        ? { transcriptLanguage: args.transcriptLanguage }
        : {}),
      ...(args.videoStorageId !== undefined ? { videoStorageId: args.videoStorageId } : {}),
      ...(args.thumbnailStorageId !== undefined
        ? { thumbnailStorageId: args.thumbnailStorageId }
        : {}),
      ...(args.visualDescription !== undefined
        ? { visualDescription: args.visualDescription }
        : {}),
      ...(args.providerError !== undefined ? { lastError: args.providerError } : {}),
      updatedAt: now,
    };
    let dossierId;
    if (existingDossier) {
      dossierId = existingDossier._id;
      await ctx.db.patch(dossierId, dossierPatch);
    } else {
      dossierId = await ctx.db.insert("sourceDossiers", {
        ...dossierPatch,
        createdAt: now,
      });
    }
    const preflight = opportunity.inputAssessmentId
      ? await ctx.db.get(opportunity.inputAssessmentId)
      : null;
    const assessmentId = await ctx.db.insert("inputAssessments", {
      accountId: opportunity.accountId,
      marketPostId: post._id,
      opportunityId: opportunity._id,
      brandSnapshotId: brandSnapshot._id,
      dossierId,
      decision: assessment.decision,
      stage: "final",
      detectorVersion: opportunity.detectorVersion ?? BREAKOUT_DETECTOR_VERSION,
      postAgeMs: Math.max(0, args.providerFetchedAt - post.publishedAt),
      qualityScore: assessment.qualityScore,
      rejectionCodes: [...assessment.rejectionCodes],
      warnings: [
        ...assessment.warnings,
        ...(args.providerError ? [`provider_warning:${args.providerError}`] : []),
      ],
      snapshotIds: preflight?.snapshotIds ?? [latestSnapshot._id],
      evaluatedAt: args.providerFetchedAt,
    });
    await ctx.db.patch(opportunity._id, {
      status: assessment.decision === "qualified" ? "ready_for_analysis" : "rejected",
      dossierId,
      inputAssessmentId: assessmentId,
      rejectionCodes: [...assessment.rejectionCodes],
      ...(args.transcript !== undefined ? { sourceTranscript: args.transcript } : {}),
      updatedAt: now,
    });
    return { decision: assessment.decision, dossierId, qualityScore: assessment.qualityScore };
  },
});

export const loadOpportunity = internalQuery({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, { opportunityId }) => {
    const opportunity = await ctx.db.get(opportunityId);
    if (!opportunity) return null;
    const post = await ctx.db.get(opportunity.marketPostId);
    if (!post) return null;
    const creator = await ctx.db.get(post.creatorId);
    const dossier = opportunity.dossierId ? await ctx.db.get(opportunity.dossierId) : null;
    const canon = await ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", opportunity.accountId))
      .collect();
    return {
      opportunity,
      post,
      creator,
      dossier,
      brandContext: canon
        .filter((item) => item.confirmedByOwner)
        .map((item) => `${item.kind}: ${item.text}`)
        .join("\n"),
    };
  },
});

export const setOpportunityStatus = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
    status: v.union(...opportunityStatuses.map((status) => v.literal(status))),
    lastError: v.optional(v.string()),
  },
  handler: (ctx, { opportunityId, status, lastError }) =>
    ctx.db.patch(opportunityId, {
      status,
      ...(lastError !== undefined ? { lastError } : {}),
      updatedAt: Date.now(),
    }),
});

export const saveAdaptation = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
    transcript: v.optional(v.string()),
    coreIdea: v.string(),
    hook: v.string(),
    structure: v.string(),
    pacing: v.string(),
    visualConcept: v.string(),
    whyItWorks: v.string(),
    creatorSpecificElements: v.array(v.string()),
    adaptedHook: v.string(),
    adaptedSlides: v.array(v.string()),
    adaptedCaption: v.string(),
    transformationNotes: v.string(),
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity) throw new Error("opportunity not found");
    const now = Date.now();
    const imageIds = [];
    for (let index = 0; index < args.storageIds.length; index += 1) {
      imageIds.push(
        await ctx.db.insert("images", {
          accountId: opportunity.accountId,
          origin: "generated",
          purpose: "post",
          storageId: args.storageIds[index]!,
          width: 1080,
          height: 1350,
          prompt: `market adaptation slide ${index + 1}`,
          createdAt: now,
        }),
      );
    }
    const postId = await ctx.db.insert("posts", {
      accountId: opportunity.accountId,
      type: "feed",
      imageIds,
      caption: args.adaptedCaption,
      platform: "instagram",
      status: "ready",
      opportunityId: opportunity._id,
      createdAt: now,
    });
    await ctx.db.patch(opportunity._id, {
      status: "awaiting_approval",
      ...(args.transcript !== undefined ? { sourceTranscript: args.transcript } : {}),
      coreIdea: args.coreIdea,
      hook: args.hook,
      structure: args.structure,
      pacing: args.pacing,
      visualConcept: args.visualConcept,
      whyItWorks: args.whyItWorks,
      creatorSpecificElements: args.creatorSpecificElements,
      adaptedHook: args.adaptedHook,
      adaptedSlides: args.adaptedSlides,
      adaptedCaption: args.adaptedCaption,
      transformationNotes: args.transformationNotes,
      postId,
      lastError: undefined,
      updatedAt: now,
    });
    return postId;
  },
});

export const approveOpportunity = mutation({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, { opportunityId }) => {
    const opportunity = await ctx.db.get(opportunityId);
    if (!opportunity) throw new Error("opportunity not found");
    await requireOwnedAccount(ctx, opportunity.accountId);
    if (opportunity.scheduledPostId) return opportunity.scheduledPostId;
    if (opportunity.status !== "awaiting_approval" || !opportunity.postId)
      throw new Error("opportunity is not ready for publication");
    const scheduledFor = Date.now() + 5_000;
    const scheduledPostId = await ctx.db.insert("scheduledPosts", {
      accountId: opportunity.accountId,
      postId: opportunity.postId,
      scheduledFor,
      status: "scheduled",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(opportunity.postId, { status: "scheduled" });
    await ctx.db.patch(opportunityId, {
      status: "publishing",
      scheduledPostId,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAt(scheduledFor, internal.publishScheduledNode.runScheduledPost, {
      scheduledPostId,
    });
    return scheduledPostId;
  },
});

export const listPublishedForMeasurement = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const rows = [];
    for (const status of ["publishing", "published", "measuring"] as const) {
      const opportunities = await ctx.db
        .query("opportunities")
        .withIndex("by_account_status", (q) => q.eq("accountId", accountId).eq("status", status))
        .collect();
      for (const opportunity of opportunities) {
        if (!opportunity.scheduledPostId) continue;
        const scheduled = await ctx.db.get(opportunity.scheduledPostId);
        if (scheduled?.status === "published" && scheduled.externalPostId)
          rows.push({
            opportunityId: opportunity._id,
            scheduledPostId: scheduled._id,
            externalPostId: scheduled.externalPostId,
          });
      }
    }
    return rows;
  },
});

export const recordPublicationSnapshot = internalMutation({
  args: {
    opportunityId: v.id("opportunities"),
    scheduledPostId: v.id("scheduledPosts"),
    views: v.optional(v.number()),
    likes: v.optional(v.number()),
    comments: v.optional(v.number()),
  },
  handler: async (ctx, { opportunityId, scheduledPostId, views, likes, comments }) => {
    const opportunity = await ctx.db.get(opportunityId);
    if (!opportunity) return;
    await ctx.db.insert("metricSnapshots", {
      accountId: opportunity.accountId,
      subjectType: "publication",
      scheduledPostId,
      observedAt: Date.now(),
      ...(views !== undefined ? { views } : {}),
      ...(likes !== undefined ? { likes } : {}),
      ...(comments !== undefined ? { comments } : {}),
    });
    await ctx.db.patch(opportunityId, { status: "measuring", updatedAt: Date.now() });
  },
});

export const dashboard = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    const creators = (
      await ctx.db
        .query("marketCreators")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    ).filter((creator) => creator.status === "active");
    const posts = await ctx.db
      .query("marketPosts")
      .withIndex("by_account_published", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(100);
    const opportunities = [];
    for (const status of opportunityStatuses) {
      const rows = await ctx.db
        .query("opportunities")
        .withIndex("by_account_status", (q) => q.eq("accountId", accountId).eq("status", status))
        .collect();
      opportunities.push(...rows);
    }
    const runs = await ctx.db
      .query("marketRuns")
      .withIndex("by_account_started", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(1);
    const assessments = await ctx.db
      .query("inputAssessments")
      .withIndex("by_account_evaluated", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(200);
    const latestFinalByPost = new Map<Id<"marketPosts">, (typeof assessments)[number]>();
    for (const assessment of assessments) {
      if (assessment.stage === "final" && !latestFinalByPost.has(assessment.marketPostId))
        latestFinalByPost.set(assessment.marketPostId, assessment);
    }
    const finalAssessments = [...latestFinalByPost.values()];
    const rejectionReasons: Record<string, number> = {};
    for (const assessment of finalAssessments)
      for (const code of assessment.rejectionCodes)
        rejectionReasons[code] = (rejectionReasons[code] ?? 0) + 1;
    const creatorById = new Map(creators.map((creator) => [creator._id, creator]));
    const postById = new Map(posts.map((post) => [post._id, post]));
    const latestPostByCreator = new Map<string, (typeof posts)[number]>();
    for (const post of posts) {
      if (!latestPostByCreator.has(post.creatorId)) latestPostByCreator.set(post.creatorId, post);
    }

    const opportunityCards = await Promise.all(
      opportunities
        .filter(
          (opportunity) => opportunity.status !== "dismissed" && opportunity.status !== "rejected",
        )
        .sort((a, b) => b.score - a.score)
        .map(async (opportunity) => {
          const post =
            postById.get(opportunity.marketPostId) ?? (await ctx.db.get(opportunity.marketPostId));
          const creator = post
            ? (creatorById.get(post.creatorId) ?? (await ctx.db.get(post.creatorId)))
            : null;
          const scheduled = opportunity.scheduledPostId
            ? await ctx.db.get(opportunity.scheduledPostId)
            : null;
          const dossier = opportunity.dossierId ? await ctx.db.get(opportunity.dossierId) : null;
          const sourcePreviewUrl = dossier?.thumbnailStorageId
            ? await ctx.storage.getUrl(dossier.thumbnailStorageId)
            : null;
          const snapshots = await ctx.db
            .query("metricSnapshots")
            .withIndex("by_market_post_observed", (q) =>
              q.eq("marketPostId", opportunity.marketPostId),
            )
            .order("desc")
            .take(1);
          const publicationSnapshots = opportunity.scheduledPostId
            ? await ctx.db
                .query("metricSnapshots")
                .withIndex("by_publication_observed", (q) =>
                  q.eq("scheduledPostId", opportunity.scheduledPostId),
                )
                .order("desc")
                .take(1)
            : [];
          return {
            ...opportunity,
            post,
            creator,
            metrics: snapshots[0] ?? null,
            publicationMetrics: publicationSnapshots[0] ?? null,
            dossier,
            sourcePreviewUrl,
            scheduled,
          };
        }),
    );

    return {
      latestRun: runs[0] ?? null,
      totals: {
        creators: creators.length,
        posts: posts.length,
        opportunities: opportunityCards.length,
        ready: opportunityCards.filter((item) => item.status === "awaiting_approval").length,
      },
      inputQuality: {
        qualified: finalAssessments.filter((item) => item.decision === "qualified").length,
        rejected: finalAssessments.filter((item) => item.decision === "rejected").length,
        rejectionReasons,
      },
      creators: [...creators]
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .map((creator) => ({
          ...creator,
          latestPost: latestPostByCreator.get(creator._id) ?? null,
        })),
      opportunities: opportunityCards,
    };
  },
});

export const setCreatorFeedback = mutation({
  args: {
    creatorId: v.id("marketCreators"),
    feedback: v.union(v.literal("relevant"), v.literal("irrelevant"), v.literal("blocked")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { creatorId, feedback, reason }) => {
    const creator = await ctx.db.get(creatorId);
    if (!creator) throw new Error("creator not found");
    await requireOwnedAccount(ctx, creator.accountId);
    await ctx.db.patch(creatorId, {
      feedback,
      ...(reason?.trim() ? { feedbackReason: reason.trim() } : {}),
      feedbackAt: Date.now(),
      status: feedback === "relevant" ? "active" : "rejected",
      updatedAt: Date.now(),
    });
  },
});

export const dismissOpportunity = mutation({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, { opportunityId }) => {
    const opportunity = await ctx.db.get(opportunityId);
    if (!opportunity) throw new Error("opportunity not found");
    await requireOwnedAccount(ctx, opportunity.accountId);
    await ctx.db.patch(opportunityId, { status: "dismissed", updatedAt: Date.now() });
  },
});
