import { WorkflowManager, vResultValidator, vWorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import {
  type ComposedPost,
  type CreatableSuggestion,
  type GeneratedImage,
  IMAGE_CONCURRENCY,
  ImageGen,
  composeCaption,
  createPost,
  resolveType,
  retrieveContext,
} from "./pipeline/create";
import { createLayer, imageGenLive, retrievalLive } from "./pipeline/liveCreate";
import { languageModelLayer } from "./pipeline/liveModel";
import type { PostType } from "./pipeline/memory";
import { postTypes } from "./pipeline/constants";

const postType = v.union(...postTypes.map((t) => v.literal(t)));

/** The wire shape of a generated image (ids are plain strings until persisted). */
const imageArg = {
  prompt: v.string(),
  width: v.number(),
  height: v.number(),
  storageId: v.optional(v.string()),
  externalUrl: v.optional(v.string()),
};

type PostTypeValue = typeof PostType.Type;

/** What `planComposition` hands the workflow: the resolved type + the model's plan. */
interface PlanComposition {
  readonly accountId: string;
  readonly type: PostTypeValue;
  readonly caption: string;
  readonly imagePrompts: ReadonlyArray<string>;
}

// --- Reads ----------------------------------------------------------------

/** Resolve an approved suggestion to what create needs to compose a post. */
export const loadCreatableSuggestion = internalQuery({
  args: { suggestionId: v.id("suggestions") },
  handler: async (ctx, { suggestionId }): Promise<CreatableSuggestion> => {
    const suggestion = await ctx.db.get(suggestionId);
    if (suggestion === null) throw new Error("suggestion not found");
    return {
      suggestionId: suggestion._id,
      accountId: suggestion.accountId,
      title: suggestion.title,
      themeName: suggestion.themeName,
      format: suggestion.format,
      beliefStatements: suggestion.beliefStatements,
    };
  },
});

/**
 * The RAG corpus: the account's held belief statements (brand knowledge) plus
 * its themes rendered as a voice summary. The live Retrieval layer ranks these
 * against the suggestion to build a context bundle.
 */
export const brandCorpus = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<{ statements: string[]; themeSummary: string }> => {
    const beliefs = await ctx.db
      .query("beliefs")
      .withIndex("by_account_status", (q) => q.eq("accountId", accountId))
      .collect();
    const themes = await ctx.db
      .query("themes")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    return {
      statements: beliefs.filter((b) => b.status !== "retired").map((b) => b.statement),
      themeSummary: themes.map((t) => `${t.name}: ${t.summary}`).join("; "),
    };
  },
});

// --- Write ----------------------------------------------------------------

/**
 * Persist a composed carousel: write each image as an atomic media unit and the
 * post that orders them, in one transaction so a post never exists without its
 * images. The suggestion is already `creating` (claimed by the cron or the
 * manual path before composition); this writes media only.
 */
export const composePost = internalMutation({
  args: {
    accountId: v.id("accounts"),
    suggestionId: v.id("suggestions"),
    type: postType,
    caption: v.string(),
    images: v.array(v.object(imageArg)),
  },
  handler: async (
    ctx,
    { accountId, suggestionId, type, caption, images },
  ): Promise<ComposedPost> => {
    // The owner may have steered this idea to needs_you mid-create (the manual
    // path runs synchronously and can't be canceled like the workflow). Never
    // compose a paused idea.
    const claimed = await ctx.db.get(suggestionId);
    if (claimed === null || claimed.status !== "creating")
      throw new Error("suggestion is no longer creating — create superseded");
    const now = Date.now();
    const imageIds: Array<Id<"images">> = [];
    for (const image of images) {
      const imageId = await ctx.db.insert("images", {
        accountId,
        origin: "generated",
        width: image.width,
        height: image.height,
        prompt: image.prompt,
        createdAt: now,
        // storageId is a real `_storage` id once the AI generator lands; the
        // placeholder carries an externalUrl instead.
        ...(image.storageId !== undefined ? { storageId: image.storageId as Id<"_storage"> } : {}),
        ...(image.externalUrl !== undefined ? { externalUrl: image.externalUrl } : {}),
      });
      imageIds.push(imageId);
    }
    const postId = await ctx.db.insert("posts", {
      accountId,
      type,
      imageIds,
      caption,
      platform: "instagram",
      status: "ready",
      suggestionId,
      createdAt: now,
    });
    return { postId, imageIds, caption, type };
  },
});

// --- Workflow steps -------------------------------------------------------

/**
 * Plan the composition: retrieve brand context (RAG) and have the model write
 * the caption + image prompts. The fast, cacheable head of the flow — kept in
 * one step so the expensive image generation downstream never redoes it.
 */
export const planComposition = internalAction({
  args: { suggestionId: v.id("suggestions") },
  handler: async (ctx, { suggestionId }): Promise<PlanComposition> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    const suggestion = await ctx.runQuery(internal.create.loadCreatableSuggestion, {
      suggestionId,
    });
    const composition = await Effect.runPromise(
      retrieveContext(suggestion).pipe(
        Effect.flatMap((bundle) => composeCaption(suggestion, bundle)),
        Effect.provide(retrievalLive(ctx)),
        Effect.provide(languageModelLayer(apiKey)),
      ),
    );
    return {
      accountId: suggestion.accountId,
      type: resolveType(suggestion),
      caption: composition.caption,
      imagePrompts: composition.imagePrompts,
    };
  },
});

/** Generate one carousel image. The slow/flaky step the workflow retries. */
export const generateImage = internalAction({
  args: { prompt: v.string() },
  handler: (_ctx, { prompt }): Promise<GeneratedImage> =>
    Effect.runPromise(
      Effect.flatMap(ImageGen, (gen) => gen.generate(prompt)).pipe(Effect.provide(imageGenLive)),
    ),
});

// --- Claim / release lifecycle --------------------------------------------

/**
 * Atomically claim an approved suggestion for creation (approved → creating),
 * returning whether this caller won. The single gate both entry points share so
 * a suggestion is never created twice.
 */
const claim = async (ctx: MutationCtx, suggestionId: Id<"suggestions">): Promise<boolean> => {
  const suggestion = await ctx.db.get(suggestionId);
  if (suggestion === null || suggestion.status !== "approved") return false;
  await ctx.db.patch(suggestionId, { status: "creating" });
  return true;
};

/** Release a claim (creating → approved) so a failed create is retried. */
const release = async (ctx: MutationCtx, suggestionId: Id<"suggestions">): Promise<void> => {
  const suggestion = await ctx.db.get(suggestionId);
  if (suggestion !== null && suggestion.status === "creating")
    await ctx.db.patch(suggestionId, { status: "approved" });
};

/** Claim for the manual path (createNow runs in an action, not a mutation). */
export const claimForCreate = internalMutation({
  args: { suggestionId: v.id("suggestions") },
  handler: (ctx, { suggestionId }): Promise<boolean> => claim(ctx, suggestionId),
});

/** Release a claim for the manual path when its create fails. */
export const releaseCreate = internalMutation({
  args: { suggestionId: v.id("suggestions") },
  handler: (ctx, { suggestionId }): Promise<void> => release(ctx, suggestionId),
});

// --- Durable workflow (the auto path) -------------------------------------

export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: IMAGE_CONCURRENCY },
});

/** Update a creating suggestion's progress (0..1) — the Vanda fazendo cards read it. */
export const setCreateProgress = internalMutation({
  args: { suggestionId: v.id("suggestions"), progress: v.number() },
  handler: (ctx, { suggestionId, progress }) => ctx.db.patch(suggestionId, { progress }),
});

/**
 * The create stage as a durable workflow: plan the composition, generate every
 * image as its own retried step (so a failure on image 3 never redoes the
 * caption or images 1–2), then compose the post. Survives server restarts.
 */
export const createWorkflow = workflow.define({
  args: { suggestionId: v.id("suggestions") },
  handler: async (step, { suggestionId }): Promise<void> => {
    const plan = await step.runAction(
      internal.create.planComposition,
      { suggestionId },
      { retry: true },
    );
    await step.runMutation(internal.create.setCreateProgress, { suggestionId, progress: 0.4 });
    const images = await Promise.all(
      plan.imagePrompts.map((prompt) =>
        step.runAction(internal.create.generateImage, { prompt }, { retry: true }),
      ),
    );
    await step.runMutation(internal.create.setCreateProgress, { suggestionId, progress: 0.9 });
    await step.runMutation(internal.create.composePost, {
      accountId: plan.accountId as Id<"accounts">,
      suggestionId,
      type: plan.type,
      caption: plan.caption,
      images,
    });
    await step.runMutation(internal.create.setCreateProgress, { suggestionId, progress: 1 });
  },
});

/** Release the claim if a create run fails, so the next pass retries it. */
export const onCreateComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ suggestionId: v.id("suggestions") }),
  },
  handler: async (ctx, { result, context }) => {
    if (result.kind === "success") return;
    await release(ctx, context.suggestionId);
  },
});

/**
 * Cron target: start a durable create for every approved suggestion. Claim each
 * (approved → creating) before starting so a second pass never double-creates;
 * `onCreateComplete` releases the claim on failure for the next pass to retry.
 */
export const createAllAccounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db.query("accounts").collect();
    for (const account of accounts) {
      if (account.connectionId === undefined) continue;
      const approved = await ctx.db
        .query("suggestions")
        .withIndex("by_account_status", (q) =>
          q.eq("accountId", account._id).eq("status", "approved"),
        )
        .collect();
      for (const suggestion of approved) {
        if (!(await claim(ctx, suggestion._id))) continue;
        const workflowId = await workflow.start(
          ctx,
          internal.create.createWorkflow,
          { suggestionId: suggestion._id },
          {
            onComplete: internal.create.onCreateComplete,
            context: { suggestionId: suggestion._id },
          },
        );
        await ctx.db.patch(suggestion._id, { workflowId });
      }
    }
  },
});

// --- On-demand (the manual path) ------------------------------------------

/**
 * Create one suggestion now, synchronously — the manual counterpart to the
 * durable cron workflow (create "pode ser automático ou manual"). Runs the same
 * flow as a single Effect; the user gets the composed post back immediately.
 */
export const createNow = internalAction({
  args: { suggestionId: v.id("suggestions") },
  handler: async (ctx, { suggestionId }): Promise<ComposedPost> => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    const claimed = await ctx.runMutation(internal.create.claimForCreate, { suggestionId });
    if (!claimed) throw new Error("suggestion is not approved (already creating, or acted on)");
    const suggestion = await ctx.runQuery(internal.create.loadCreatableSuggestion, {
      suggestionId,
    });
    try {
      return await Effect.runPromise(
        createPost(suggestion).pipe(Effect.provide(createLayer(ctx, apiKey))),
      );
    } catch (error) {
      await ctx.runMutation(internal.create.releaseCreate, { suggestionId });
      throw error;
    }
  },
});
