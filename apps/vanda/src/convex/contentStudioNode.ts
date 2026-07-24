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
  regenerateCarouselSlide,
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
  readonly creativeBriefId: Id<"creativeBriefs">;
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
    creativeBriefId: input.creativeBriefId,
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

export const reviewDraft = action({
  args: { projectId: v.id("contentProjects") },
  handler: async (ctx, { projectId }): Promise<Id<"carouselDocuments">> => {
    await ctx.runQuery(internal.contentStudio.requireProjectOwner, { projectId });
    const projectInput = await ctx.runQuery(internal.contentStudio.loadProjectDocument, {
      projectId,
    });
    if (!projectInput) throw new Error("active carousel document not found");
    const production = await ctx.runQuery(internal.contentStudio.loadProductionInput, {
      creativeBriefId: projectInput.creativeBriefId,
    });
    if (!production) throw new Error("production input is incomplete");
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
    return projectInput.document._id;
  },
});

export const regenerateSlide = action({
  args: {
    projectId: v.id("contentProjects"),
    slideId: v.string(),
    instruction: v.string(),
  },
  handler: async (ctx, { projectId, slideId, instruction }): Promise<Id<"carouselDocuments">> => {
    await ctx.runQuery(internal.contentStudio.requireProjectOwner, { projectId });
    const projectInput = await ctx.runQuery(internal.contentStudio.loadProjectDocument, {
      projectId,
    });
    if (!projectInput) throw new Error("active carousel document not found");
    const production = await ctx.runQuery(internal.contentStudio.loadProductionInput, {
      creativeBriefId: projectInput.creativeBriefId,
    });
    if (!production) throw new Error("production input is incomplete");
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
    return saveGeneratedDocument({
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
  },
});
