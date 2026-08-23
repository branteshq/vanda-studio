"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { BrandAnalysis, CorpusStats } from "./pipeline/brand";
import { proposeBrandProfile } from "./pipeline/brandProfile";
import { fetchBrandCorpus, uploadPostInstagramReaderLayer } from "./pipeline/liveBrand";
import { languageModelLayer, PIPELINE_MODELS, PROMPT_VERSIONS } from "./pipeline/liveModel";
import { runTracked } from "./pipeline/liveTelemetry";

/**
 * Onboarding's "Vanda is reading your account" step: resolve the caller's
 * connected handle, fetch its first-party Upload-Post corpus + counts, and run one
 * structured LLM pass into a `BrandAnalysis`. Returns the analysis (for the
 * Confirmar screen to edit) plus the corpus stats (the "LI N POSTS · …" trust
 * line) — not persisted, so re-running on a refresh is safe (idempotent, no
 * writes). Explicit return type breaks the `api ↔ brandProfile ↔
 * brandProfileNode` cycle.
 */
export const analyzeAccount = action({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<{ analysis: BrandAnalysis; stats: CorpusStats }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const { handle } = await ctx.runQuery(internal.brandProfile.resolveOwnedHandle, {
      accountId,
      clerkId: identity.subject,
    });
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    const publisherUsername = String(accountId);
    return runTracked(
      ctx,
      {
        accountId,
        stage: "brand_profile",
        model: PIPELINE_MODELS.brandProfile,
        promptVersion: PROMPT_VERSIONS.brandProfile,
        inputIds: [handle],
      },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const { corpus, stats } = yield* fetchBrandCorpus(publisherUsername, handle);
            const analysis = yield* proposeBrandProfile(corpus);
            return { analysis, stats };
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                languageModelLayer(apiKey, PIPELINE_MODELS.brandProfile),
                uploadPostInstagramReaderLayer,
              ),
            ),
          ),
        ),
      ({ stats }) => `${stats.posts} posts; ${stats.comments} comentários`,
    );
  },
});
