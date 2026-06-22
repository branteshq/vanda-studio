import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { Suggestion } from "./memory";

/** What one plan pass produced — accepted ideas and persisted rejections alike. */
export interface PlanResult {
  readonly suggestions: ReadonlyArray<Suggestion>;
}

/**
 * Persistence boundary for plan output. A pass replaces the account's open,
 * not-yet-acted suggestions (suggestion / needs_you / rejected) with the fresh
 * batch; committed states (creating / scheduled / dismissed) are left alone so
 * re-deliberation never clobbers a decision or in-flight work.
 */
export interface SuggestionsShape {
  readonly save: (accountId: string, result: PlanResult) => Effect.Effect<void, Cause.UnknownError>;
}

export class Suggestions extends Context.Service<Suggestions, SuggestionsShape>()(
  "@vanda/pipeline/Suggestions",
) {}
