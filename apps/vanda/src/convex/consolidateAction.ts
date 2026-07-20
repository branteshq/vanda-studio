import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { consolidate } from "./pipeline/consolidate";
import { consolidateLayer } from "./pipeline/liveConsolidate";
import { memoryRebuildLive } from "./pipeline/liveMemory";
import { PIPELINE_MODELS, PROMPT_VERSIONS } from "./pipeline/liveModel";
import { runTracked } from "./pipeline/liveTelemetry";

/**
 * Consolidate one account: fold its pending signals into belief/theme memory
 * with the model, persisting the deltas. Best-effort — nothing to do with no
 * pending signals, and a model/persistence failure leaves the signals
 * unconsolidated for the next cycle (nothing is half-applied).
 */
const runConsolidation = async (ctx: ActionCtx, accountId: Id<"accounts">, rebuild: boolean) => {
  const signals = await ctx.runQuery(
    rebuild
      ? internal.consolidate.listSignalsForRebuild
      : internal.consolidate.listUnconsolidatedSignals,
    { accountId },
  );
  if (signals.length === 0) return;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
  const inputs = signals.map((signal) => ({
    id: signal._id,
    source: signal.source,
    text: signal.text,
    observedAt: signal.observedAt,
    ...(signal.authorHandle !== undefined ? { authorHandle: signal.authorHandle } : {}),
    ...(signal.permalink !== undefined ? { permalink: signal.permalink } : {}),
    ...(signal.ingestedAt !== undefined ? { ingestedAt: signal.ingestedAt } : {}),
    ...(signal.syncKind !== undefined ? { syncKind: signal.syncKind } : {}),
    ...(signal.mediaExternalId !== undefined ? { mediaExternalId: signal.mediaExternalId } : {}),
    ...(signal.mediaCaption !== undefined ? { mediaCaption: signal.mediaCaption } : {}),
    ...(signal.mediaType !== undefined ? { mediaType: signal.mediaType } : {}),
    ...(signal.mediaPublishedAt !== undefined ? { mediaPublishedAt: signal.mediaPublishedAt } : {}),
    ...(signal.isSelf !== undefined ? { isSelf: signal.isSelf } : {}),
  }));
  await runTracked(
    ctx,
    {
      accountId,
      stage: "consolidate",
      model: PIPELINE_MODELS.consolidate,
      promptVersion: PROMPT_VERSIONS.consolidate,
      inputIds: inputs.map((signal) => signal.id),
    },
    () =>
      Effect.runPromise(
        consolidate(accountId, inputs).pipe(
          Effect.provide(
            consolidateLayer(ctx, apiKey, rebuild ? memoryRebuildLive(ctx) : undefined),
          ),
        ),
      ),
    (result) =>
      `${result.beliefs.length} crenças; ${result.themes.length} temas; ` +
      `${result.consumedSignals.length} sinais`,
  );
};

export const consolidateAccount = internalAction({
  args: { accountId: v.id("accounts") },
  handler: (ctx, { accountId }) => runConsolidation(ctx, accountId, false),
});

export const rebuildAccount = internalAction({
  args: { accountId: v.id("accounts") },
  handler: (ctx, { accountId }) => runConsolidation(ctx, accountId, true),
});
