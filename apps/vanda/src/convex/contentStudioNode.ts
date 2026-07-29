"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import {
  type CarouselDocumentPlan,
  type CarouselDocumentReview,
  planCarouselDocument,
  planLegacyCreativeBrief,
  regenerateCarouselSlide,
  reviseCarouselDocument,
  replaceCarouselSlide,
  reviewCarouselDocument,
  validateCarouselDocument,
  type ContentStudioBrand,
  type ContentStudioSource,
} from "./pipeline/contentStudio";
import {
  languageModelLayer,
  PIPELINE_MODELS,
  PROMPT_VERSIONS,
  type Mutable,
} from "./pipeline/liveModel";
import { runTracked } from "./pipeline/liveTelemetry";
import type { CreativeBrief } from "./pipeline/creativeDirector";

const documentPlanFromDoc = (document: Doc<"carouselDocuments">): CarouselDocumentPlan => ({
  title: document.title,
  caption: document.caption,
  accessibilityDescription: document.accessibilityDescription,
  canvas: document.canvas,
  style: document.style,
  brandFactIds: document.brandFactIds,
  slides: document.slides,
});

const reviewAndValidate = async (input: {
  readonly ctx: ActionCtx;
  readonly accountId: Id<"accounts">;
  readonly inputIds: ReadonlyArray<string>;
  readonly brief: Parameters<typeof reviewCarouselDocument>[0]["brief"];
  readonly document: CarouselDocumentPlan;
  readonly brand: ContentStudioBrand;
  readonly source: ContentStudioSource;
  readonly apiKey: string;
}): Promise<{
  readonly review: CarouselDocumentReview;
  readonly validation: ReturnType<typeof validateCarouselDocument>;
}> => {
  const review = await runTracked(
    input.ctx,
    {
      accountId: input.accountId,
      stage: "studio_carousel_review",
      model: PIPELINE_MODELS.studioCarouselReview,
      promptVersion: PROMPT_VERSIONS.studioCarouselReview,
      inputIds: [...input.inputIds],
    },
    () =>
      Effect.runPromise(
        reviewCarouselDocument({
          brief: input.brief,
          document: input.document,
          brand: input.brand,
          source: input.source,
        }).pipe(
          Effect.provide(languageModelLayer(input.apiKey, PIPELINE_MODELS.studioCarouselReview)),
        ),
      ),
    (result) => `${result.decision}: ${result.summary}`,
  );
  const validation = validateCarouselDocument({
    document: input.document,
    review,
    allowedBrandFactIds: new Set(input.brand.facts.map((fact) => fact.id)),
    allowedAssetIds: new Set(input.brand.authorizedAssets.map((asset) => asset.id)),
    source: input.source,
  });
  return { review, validation };
};

const saveGeneratedDocument = async (input: {
  readonly ctx: ActionCtx;
  readonly projectId: Id<"contentProjects">;
  readonly creativeBriefId?: Id<"creativeBriefs"> | undefined;
  readonly document: CarouselDocumentPlan;
  readonly review: CarouselDocumentReview;
  readonly validation: ReturnType<typeof validateCarouselDocument>;
  readonly changeKind: "generated" | "slide_regeneration" | "review_retry";
  readonly parentDocumentId?: Id<"carouselDocuments"> | undefined;
  readonly model: string;
  readonly promptVersion: string;
}): Promise<Id<"carouselDocuments">> =>
  input.ctx.runMutation(internal.contentStudio.savePlannedDocument, {
    projectId: input.projectId,
    ...(input.creativeBriefId !== undefined
      ? { creativeBriefId: input.creativeBriefId }
      : {}),
    changeKind: input.changeKind,
    ...(input.parentDocumentId !== undefined ? { parentDocumentId: input.parentDocumentId } : {}),
    createdBy: "model",
    ...(input.document as Mutable<CarouselDocumentPlan>),
    reviewDecision: input.review.decision,
    reviewSummary: input.review.summary,
    unsupportedClaims: [...input.review.unsupportedClaims],
    brandIssues: [...input.review.brandIssues],
    similarityRisks: [...input.review.similarityRisks],
    productionIssues: [...input.review.productionIssues],
    corrections: [...input.review.corrections],
    reviewConfidence: input.review.confidence,
    deterministicIssues: [...input.validation.issues],
    deterministicWarnings: [...input.validation.warnings],
    sourceSimilarity: input.validation.sourceSimilarity,
    model: input.model,
    promptVersion: input.promptVersion,
    reviewModel: PIPELINE_MODELS.studioCarouselReview,
    reviewPromptVersion: PROMPT_VERSIONS.studioCarouselReview,
  });

const loadProjectProduction = async (
  ctx: ActionCtx,
  projectInput: {
    readonly project: Doc<"contentProjects">;
    readonly creativeBriefId?: Id<"creativeBriefs"> | undefined;
    readonly briefSnapshotJson?: string | undefined;
    readonly sourceSnapshotJson?: string | undefined;
  },
): Promise<{
  brief: CreativeBrief;
  brand: ContentStudioBrand;
  source: ContentStudioSource;
}> => {
  if (projectInput.creativeBriefId) {
    const production = await ctx.runQuery(internal.contentStudio.loadProductionInput, {
      creativeBriefId: projectInput.creativeBriefId,
    });
    if (!production) throw new Error("production input is incomplete");
    return production;
  }
  const seed = await ctx.runQuery(internal.contentStudio.loadSeedProjectContext, {
    projectId: projectInput.project._id,
  });
  if (!seed) throw new Error("legacy project snapshots are incomplete");
  return {
    brief: JSON.parse(seed.briefSnapshotJson) as CreativeBrief,
    source: JSON.parse(seed.sourceSnapshotJson) as ContentStudioSource,
    brand: seed.brand,
  };
};

export const createFromBriefInternal = internalAction({
  args: { creativeBriefId: v.id("creativeBriefs"), retry: v.optional(v.boolean()) },
  handler: async (ctx, { creativeBriefId, retry }): Promise<Id<"contentProjects">> => {
    const claim = await ctx.runMutation(internal.contentStudio.claimBriefPlanning, {
      creativeBriefId,
      retry: retry ?? false,
    });
    if (!claim.claimed) return claim.projectId;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.contentStudio.failPlanning, {
        projectId: claim.projectId,
        error: "OPENROUTER_API_KEY is not set on the Convex deployment",
      });
      throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    }
    try {
      const input = await ctx.runQuery(internal.contentStudio.loadProductionInput, {
        creativeBriefId,
      });
      if (!input) throw new Error("production input is incomplete");
      const visualProfileId = await ctx.runAction(internal.visualBrandNode.ensureInternal, {
        accountId: input.brief.accountId,
      });
      await ctx.runMutation(internal.contentStudio.attachVisualProfile, {
        projectId: claim.projectId,
        visualProfileId,
      });
      const document = await runTracked(
        ctx,
        {
          accountId: input.brief.accountId,
          stage: "studio_carousel_plan",
          model: PIPELINE_MODELS.studioCarouselPlan,
          promptVersion: PROMPT_VERSIONS.studioCarouselPlan,
          inputIds: [creativeBriefId],
        },
        () =>
          Effect.runPromise(
            planCarouselDocument({ brief: input.brief, brand: input.brand }).pipe(
              Effect.provide(languageModelLayer(apiKey, PIPELINE_MODELS.studioCarouselPlan)),
            ),
          ),
        (result) =>
          `${result.slides.length} slides; ${result.caption.length} caracteres de legenda`,
      );
      const { review, validation } = await reviewAndValidate({
        ctx,
        accountId: input.brief.accountId,
        inputIds: [creativeBriefId],
        brief: input.brief,
        document,
        brand: input.brand,
        source: input.source,
        apiKey,
      });
      await saveGeneratedDocument({
        ctx,
        projectId: claim.projectId,
        creativeBriefId,
        document,
        review,
        validation,
        changeKind: "generated",
        model: PIPELINE_MODELS.studioCarouselPlan,
        promptVersion: PROMPT_VERSIONS.studioCarouselPlan,
      });
      if (validation.valid)
        await ctx.runMutation(internal.contentStudio.requestRenderInternal, {
          projectId: claim.projectId,
        });
      return claim.projectId;
    } catch (error) {
      await ctx.runMutation(internal.contentStudio.failPlanning, {
        projectId: claim.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});

export const seedLegacyOpportunityInternal = internalAction({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, { opportunityId }): Promise<Id<"contentProjects">> => {
    const input = await ctx.runQuery(internal.contentStudio.loadLegacySeedInput, {
      opportunityId,
    });
    if (!input) throw new Error("legacy opportunity input not found");
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    const visualProfileId = await ctx.runAction(internal.visualBrandNode.ensureInternal, {
      accountId: input.account._id,
    });
    const brief = await runTracked(
      ctx,
      {
        accountId: input.account._id,
        stage: "studio_carousel_plan",
        model: PIPELINE_MODELS.studioCarouselPlan,
        promptVersion: PROMPT_VERSIONS.studioLegacyBrief,
        inputIds: [opportunityId],
      },
      () =>
        Effect.runPromise(
          planLegacyCreativeBrief({ concept: input.concept, brand: input.brand }).pipe(
            Effect.provide(languageModelLayer(apiKey, PIPELINE_MODELS.studioCarouselPlan)),
          ),
        ),
      (result) => `${result.narrativeBeats.length} beats; ${result.title}`,
    );
    let document = await runTracked(
      ctx,
      {
        accountId: input.account._id,
        stage: "studio_carousel_plan",
        model: PIPELINE_MODELS.studioCarouselPlan,
        promptVersion: PROMPT_VERSIONS.studioCarouselPlan,
        inputIds: [opportunityId],
      },
      () =>
        Effect.runPromise(
          planCarouselDocument({ brief, brand: input.brand }).pipe(
            Effect.provide(languageModelLayer(apiKey, PIPELINE_MODELS.studioCarouselPlan)),
          ),
        ),
      (result) => `${result.slides.length} slides`,
    );
    let reviewed = await reviewAndValidate({
      ctx,
      accountId: input.account._id,
      inputIds: [opportunityId],
      brief,
      document,
      brand: input.brand,
      source: input.source,
      apiKey,
    });
    if (!reviewed.validation.valid) {
      document = await runTracked(
        ctx,
        {
          accountId: input.account._id,
          stage: "studio_carousel_plan",
          model: PIPELINE_MODELS.studioCarouselPlan,
          promptVersion: PROMPT_VERSIONS.studioCarouselPlan,
          inputIds: [opportunityId, "editorial-revision"],
        },
        () =>
          Effect.runPromise(
            reviseCarouselDocument({
              brief,
              document,
              review: reviewed.review,
              brand: input.brand,
            }).pipe(
              Effect.provide(languageModelLayer(apiKey, PIPELINE_MODELS.studioCarouselPlan)),
            ),
          ),
        (result) => `${result.slides.length} slides corrigidos`,
      );
      reviewed = await reviewAndValidate({
        ctx,
        accountId: input.account._id,
        inputIds: [opportunityId, "editorial-revision"],
        brief,
        document,
        brand: input.brand,
        source: input.source,
        apiKey,
      });
    }
    const claim = await ctx.runMutation(internal.contentStudio.claimLegacyProject, {
      accountId: input.account._id,
      opportunityId,
      visualProfileId,
      title: document.title,
      briefSnapshotJson: JSON.stringify(brief),
      sourceSnapshotJson: JSON.stringify(input.source),
    });
    if (!claim.claimed) return claim.projectId;
    await ctx.runMutation(internal.contentStudio.savePlannedDocument, {
      projectId: claim.projectId,
      changeKind: "generated",
      createdBy: "model",
      ...(document as Mutable<CarouselDocumentPlan>),
      reviewDecision: reviewed.review.decision,
      reviewSummary: reviewed.review.summary,
      unsupportedClaims: [...reviewed.review.unsupportedClaims],
      brandIssues: [...reviewed.review.brandIssues],
      similarityRisks: [...reviewed.review.similarityRisks],
      productionIssues: [...reviewed.review.productionIssues],
      corrections: [...reviewed.review.corrections],
      reviewConfidence: reviewed.review.confidence,
      deterministicIssues: [...reviewed.validation.issues],
      deterministicWarnings: [...reviewed.validation.warnings],
      sourceSimilarity: reviewed.validation.sourceSimilarity,
      model: PIPELINE_MODELS.studioCarouselPlan,
      promptVersion: PROMPT_VERSIONS.studioCarouselPlan,
      reviewModel: PIPELINE_MODELS.studioCarouselReview,
      reviewPromptVersion: PROMPT_VERSIONS.studioCarouselReview,
    });
    if (reviewed.validation.valid)
      await ctx.runMutation(internal.contentStudio.requestRenderInternal, {
        projectId: claim.projectId,
      });
    return claim.projectId;
  },
});

const reviewDraftCore = async (
  ctx: ActionCtx,
  projectId: Id<"contentProjects">,
): Promise<Id<"carouselDocuments">> => {
    const projectInput = await ctx.runQuery(internal.contentStudio.loadProjectDocument, {
      projectId,
    });
    if (!projectInput) throw new Error("active carousel document not found");
    const production = await loadProjectProduction(ctx, projectInput);
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    const document = documentPlanFromDoc(projectInput.document);
    const { review, validation } = await reviewAndValidate({
      ctx,
      accountId: projectInput.project.accountId,
      inputIds: [projectInput.document._id],
      brief: production.brief,
      document,
      brand: production.brand,
      source: production.source,
      apiKey,
    });
    const blocked = validation.issues.some((issue) => issue.startsWith("owner_asset_required:"));
    const status = validation.valid ? "ready_for_render" : blocked ? "blocked" : "draft";
    await ctx.runMutation(internal.contentStudio.setActiveReviewedDocument, {
      projectId,
      documentId: projectInput.document._id,
      status,
      reviewStatus: review.decision === "approved" ? "approved" : "rejected",
      reviewDecision: review.decision,
      reviewSummary: review.summary,
      unsupportedClaims: [...review.unsupportedClaims],
      brandIssues: [...review.brandIssues],
      similarityRisks: [...review.similarityRisks],
      productionIssues: [...review.productionIssues],
      corrections: [...review.corrections],
      reviewConfidence: review.confidence,
      deterministicIssues: [...validation.issues],
      deterministicWarnings: [...validation.warnings],
      sourceSimilarity: validation.sourceSimilarity,
      reviewModel: PIPELINE_MODELS.studioCarouselReview,
      reviewPromptVersion: PROMPT_VERSIONS.studioCarouselReview,
    });
    if (validation.valid)
      await ctx.runMutation(internal.contentStudio.requestRenderInternal, { projectId });
    return projectInput.document._id;
};

export const reviewDraft = action({
  args: { projectId: v.id("contentProjects") },
  handler: async (ctx, { projectId }): Promise<Id<"carouselDocuments">> => {
    await ctx.runQuery(internal.contentStudio.requireProjectOwner, { projectId });
    return reviewDraftCore(ctx, projectId);
  },
});

export const reviewDraftInternal = internalAction({
  args: { projectId: v.id("contentProjects") },
  handler: (ctx, { projectId }): Promise<Id<"carouselDocuments">> =>
    reviewDraftCore(ctx, projectId),
});

const regenerateSlideCore = async (
  ctx: ActionCtx,
  { projectId, slideId, instruction }: {
    projectId: Id<"contentProjects">;
    slideId: string;
    instruction: string;
  },
): Promise<Id<"carouselDocuments">> => {
    const projectInput = await ctx.runQuery(internal.contentStudio.loadProjectDocument, {
      projectId,
    });
    if (!projectInput) throw new Error("active carousel document not found");
    const production = await loadProjectProduction(ctx, projectInput);
    const current = documentPlanFromDoc(projectInput.document);
    const existingSlide = current.slides.find((slide) => slide.slideId === slideId);
    if (!existingSlide) throw new Error("carousel slide not found");
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    const replacement = await runTracked(
      ctx,
      {
        accountId: projectInput.project.accountId,
        stage: "studio_slide_regeneration",
        model: PIPELINE_MODELS.studioSlideRegeneration,
        promptVersion: PROMPT_VERSIONS.studioSlideRegeneration,
        inputIds: [projectInput.document._id, slideId],
      },
      () =>
        Effect.runPromise(
          regenerateCarouselSlide({
            document: current,
            slideId,
            instruction,
            brand: production.brand,
          }).pipe(
            Effect.provide(languageModelLayer(apiKey, PIPELINE_MODELS.studioSlideRegeneration)),
          ),
        ),
      (result) => `${result.slideId}: ${result.headline}`,
    );
    if (
      replacement.slideId !== existingSlide.slideId ||
      replacement.position !== existingSlide.position
    )
      throw new Error("regenerated slide changed its stable identity");
    const document = replaceCarouselSlide(current, replacement);
    const { review, validation } = await reviewAndValidate({
      ctx,
      accountId: projectInput.project.accountId,
      inputIds: [projectInput.document._id, slideId],
      brief: production.brief,
      document,
      brand: production.brand,
      source: production.source,
      apiKey,
    });
    const documentId = await saveGeneratedDocument({
      ctx,
      projectId,
      creativeBriefId: projectInput.creativeBriefId,
      document,
      review,
      validation,
      changeKind: "slide_regeneration",
      parentDocumentId: projectInput.document._id,
      model: PIPELINE_MODELS.studioSlideRegeneration,
      promptVersion: PROMPT_VERSIONS.studioSlideRegeneration,
    });
    if (validation.valid)
      await ctx.runMutation(internal.contentStudio.requestRenderInternal, { projectId });
    return documentId;
};

export const regenerateSlide = action({
  args: {
    projectId: v.id("contentProjects"),
    slideId: v.string(),
    instruction: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"carouselDocuments">> => {
    await ctx.runQuery(internal.contentStudio.requireProjectOwner, {
      projectId: args.projectId,
    });
    return regenerateSlideCore(ctx, args);
  },
});

export const regenerateSlideInternal = internalAction({
  args: {
    projectId: v.id("contentProjects"),
    slideId: v.string(),
    instruction: v.string(),
  },
  handler: (ctx, args): Promise<Id<"carouselDocuments">> => regenerateSlideCore(ctx, args),
});
