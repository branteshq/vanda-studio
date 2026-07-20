import * as Layer from "effect/Layer";
import type * as LanguageModel from "effect/unstable/ai/LanguageModel";
import type { ActionCtx } from "../_generated/server";
import { memoryStoreLive } from "./liveMemory";
import { brandContextLive } from "./liveBrandContext";
import { languageModelLayer, PIPELINE_MODELS } from "./liveModel";
import type { BrandContext } from "./brandContext";
import type { Memory } from "./memoryStore";

/**
 * The production layer for the consolidate stage inside a Convex action:
 * `Memory` persists through `ctx`, the language model calls OpenRouter.
 */
export const consolidateLayer = (
  ctx: ActionCtx,
  apiKey: string,
  memory: Layer.Layer<Memory> = memoryStoreLive(ctx),
): Layer.Layer<Memory | BrandContext | LanguageModel.LanguageModel> =>
  Layer.mergeAll(
    memory,
    brandContextLive(ctx),
    languageModelLayer(apiKey, PIPELINE_MODELS.consolidate),
  );
