import * as Effect from "effect/Effect";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { modelStages } from "./constants";

type ModelStage = (typeof modelStages)[number];

interface RunMetadata {
  readonly accountId: Id<"accounts">;
  readonly stage: ModelStage;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputIds: ReadonlyArray<string>;
}

/**
 * Flat per-call cost estimates by model, charged to the usage meter on
 * success. Estimates, not exact accounting: pipeline prompts are bounded, and
 * the usageEvents trail (kind "pipeline", ref = stage) is how they get tuned
 * against the real OpenRouter bill. The internal renderer costs nothing.
 */
const MODEL_COST_ESTIMATE_USD: Record<string, number> = {
  "openai/gpt-5-nano": 0.002,
  "openai/gpt-5-mini": 0.01,
  "google/gemini-2.5-flash": 0.005,
  "bytedance-seed/seedream-4.5": 0.03,
  "vanda/carousel-renderer-v1": 0,
};
const DEFAULT_MODEL_COST_ESTIMATE_USD = 0.01;

export const runTracked = async <A>(
  ctx: ActionCtx,
  metadata: RunMetadata,
  run: () => Promise<A>,
  summarize: (value: A) => string,
): Promise<A> => {
  const estimateUsd = MODEL_COST_ESTIMATE_USD[metadata.model] ?? DEFAULT_MODEL_COST_ESTIMATE_USD;
  return Effect.runPromise(
    Effect.tryPromise(() =>
      ctx.runMutation(internal.modelTelemetry.start, {
        ...metadata,
        inputIds: [...metadata.inputIds],
      }),
    ).pipe(
      Effect.flatMap((runId) =>
        Effect.tryPromise({ try: run, catch: (error) => error }).pipe(
          Effect.tap((value) =>
            Effect.tryPromise(() =>
              ctx.runMutation(internal.modelTelemetry.finish, {
                runId,
                status: "succeeded",
                outputSummary: summarize(value),
              }),
            ),
          ),
          Effect.tap(() =>
            estimateUsd > 0
              ? Effect.tryPromise(() =>
                  ctx.runMutation(internal.usage.charge, {
                    accountId: metadata.accountId,
                    kind: "pipeline",
                    usd: estimateUsd,
                    ref: metadata.stage,
                  }),
                ).pipe(Effect.ignore)
              : Effect.void,
          ),
          Effect.tapError((error) =>
            Effect.tryPromise(() =>
              ctx.runMutation(internal.modelTelemetry.finish, {
                runId,
                status: "failed",
                error: String(error),
              }),
            ).pipe(Effect.ignore),
          ),
          Effect.mapError((error) => new Error(String(error))),
        ),
      ),
    ),
  );
};
