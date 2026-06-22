import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import type { SignalJudgment } from "./consolidate";
import { type AccountMode, type Belief, defaultPolicy, type Policy, type Theme } from "./memory";
import {
  type ConsolidationResult,
  Memory,
  type MemoryShape,
  type MemorySnapshot,
} from "./memoryStore";
import { makeStubLanguageModel } from "./testLanguageModel";

/** Stub `LanguageModel` for consolidate: `generateObject` returns `judge(prompt)`. */
export const makeStubConsolidator = (judge: (prompt: string) => SignalJudgment) =>
  makeStubLanguageModel(judge);

/** A stub model that always fails — for the model-failure-aborts-the-pass path. */
export const failingConsolidator = Layer.succeed(LanguageModel.LanguageModel, {
  generateObject: () => Effect.fail(new Error("stub LanguageModel failure")),
  generateText: () => Effect.die("stub LanguageModel: generateText is not supported"),
  streamText: () => Stream.die("stub LanguageModel: streamText is not supported"),
} as unknown as LanguageModel.Service);

export interface MemoryRecorder {
  readonly layer: Layer.Layer<Memory>;
  /** Every result `apply` received, in order. */
  readonly applied: ReadonlyArray<ConsolidationResult>;
  /** The current persisted snapshot (reflects applied results). */
  readonly snapshot: () => MemorySnapshot;
}

/**
 * In-memory `Memory` seeded with beliefs/themes/policy. `loadSnapshot` returns
 * the live state and `apply` folds a result back in, so consecutive
 * `consolidate` runs see each other's writes (evidence accrues across passes).
 */
export const makeMemoryRecorder = (
  seed: {
    readonly beliefs?: ReadonlyArray<Belief>;
    readonly themes?: ReadonlyArray<Theme>;
    readonly policy?: Policy;
    readonly mode?: AccountMode;
  } = {},
): MemoryRecorder => {
  let beliefs: ReadonlyArray<Belief> = seed.beliefs ?? [];
  let themes: ReadonlyArray<Theme> = seed.themes ?? [];
  const policy = seed.policy ?? defaultPolicy;
  const mode = seed.mode ?? "needs_approval";
  const applied: Array<ConsolidationResult> = [];

  const layer = Layer.succeed(Memory, {
    loadSnapshot: () => Effect.sync(() => ({ beliefs, themes, policy, mode })),
    apply: (_accountId, result) =>
      Effect.sync(() => {
        beliefs = result.beliefs;
        themes = result.themes;
        applied.push(result);
      }),
  } satisfies MemoryShape);

  return { layer, applied, snapshot: () => ({ beliefs, themes, policy, mode }) };
};
