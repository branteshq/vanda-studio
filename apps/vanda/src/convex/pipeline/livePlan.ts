import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as LanguageModel from "effect/unstable/ai/LanguageModel";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { memoryStoreLive } from "./liveMemory";
import { languageModelLayer, type Mutable } from "./liveModel";
import type { Memory } from "./memoryStore";
import { type PlanResult, Suggestions, type SuggestionsShape } from "./suggestions";

const accountKey = (id: string): Id<"accounts"> => id as Id<"accounts">;

/**
 * `Suggestions` backed by the Convex action `ctx`. Explicit return type breaks
 * the `api ↔ planAction ↔ livePlan` import cycle.
 */
export const suggestionsStoreLive = (ctx: ActionCtx): Layer.Layer<Suggestions> =>
  Layer.succeed(Suggestions, {
    save: (accountId: string, result: PlanResult): Effect.Effect<void, Cause.UnknownError> =>
      Effect.tryPromise(() =>
        ctx.runMutation(internal.plan.saveSuggestions, {
          accountId: accountKey(accountId),
          suggestions: result.suggestions as unknown as Mutable<PlanResult["suggestions"]>,
        }),
      ).pipe(Effect.asVoid),
  } satisfies SuggestionsShape);

/**
 * The production layer for the plan stage inside a Convex action: `Memory` reads
 * + `Suggestions` writes through `ctx`, the language model calls OpenRouter.
 * (Pass a stronger model to `languageModelLayer` here to upgrade deliberation.)
 */
export const planLayer = (
  ctx: ActionCtx,
  apiKey: string,
): Layer.Layer<Memory | Suggestions | LanguageModel.LanguageModel> =>
  Layer.mergeAll(memoryStoreLive(ctx), suggestionsStoreLive(ctx), languageModelLayer(apiKey));
