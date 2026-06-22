import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Suggestion } from "./memory";
import type { Critique, Idea } from "./plan";
import { type PlanResult, Suggestions, type SuggestionsShape } from "./suggestions";
import { makeStubLanguageModel } from "./testLanguageModel";

/** Critique prompts contain this; ideate prompts don't — lets the stub route calls. */
const CRITIQUE_HINT = "skeptical editor";

/**
 * Stub `LanguageModel` for plan: returns `{ ideas }` for the ideate call and
 * `critique(title)` for each critique call, distinguished by prompt content.
 */
export const makePlannerStub = (
  ideas: ReadonlyArray<Idea>,
  critique: (title: string) => Critique,
) =>
  makeStubLanguageModel((prompt) => {
    if (prompt.includes(CRITIQUE_HINT)) {
      const title = /Title: (.*)/.exec(prompt)?.[1] ?? "";
      return critique(title);
    }
    return { ideas };
  });

export interface SuggestionsRecorder {
  readonly layer: Layer.Layer<Suggestions>;
  /** The latest saved batch (a pass replaces it). */
  readonly saved: ReadonlyArray<Suggestion>;
}

/** In-memory `Suggestions` store; keeps the most recently saved batch for assertions. */
export const makeSuggestionsRecorder = (): SuggestionsRecorder => {
  const saved: Array<Suggestion> = [];
  const layer = Layer.succeed(Suggestions, {
    save: (_accountId, result: PlanResult) =>
      Effect.sync(() => {
        saved.length = 0;
        saved.push(...result.suggestions);
      }),
  } satisfies SuggestionsShape);
  return { layer, saved };
};
