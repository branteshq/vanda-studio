import * as Layer from "effect/Layer";
import type * as LanguageModel from "effect/unstable/ai/LanguageModel";
import type { ActionCtx } from "../_generated/server";
import { memoryStoreLive } from "./liveMemory";
import { languageModelLayer } from "./liveModel";
import type { Memory } from "./memoryStore";

/**
 * The production layer for the consolidate stage inside a Convex action:
 * `Memory` persists through `ctx`, the language model calls OpenRouter.
 */
export const consolidateLayer = (
  ctx: ActionCtx,
  apiKey: string,
): Layer.Layer<Memory | LanguageModel.LanguageModel> =>
  Layer.mergeAll(memoryStoreLive(ctx), languageModelLayer(apiKey));
