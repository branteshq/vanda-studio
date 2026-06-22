import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { AccountMode, Belief, Policy, Theme } from "./memory";

/** A consistent read of an account's discernment memory + autonomy setting. */
export interface MemorySnapshot {
  readonly beliefs: ReadonlyArray<Belief>;
  readonly themes: ReadonlyArray<Theme>;
  readonly policy: Policy;
  readonly mode: AccountMode;
}

/**
 * The belief/theme/journal deltas one consolidation pass produces. `beliefs` and
 * `themes` are the full post-pass sets (existing rows decayed/updated + any
 * created), so `apply` is a straight upsert. `consumedSignalIds` are the signals
 * folded in — marked consolidated so they're never re-counted.
 */
export interface ConsolidationResult {
  readonly beliefs: ReadonlyArray<Belief>;
  readonly themes: ReadonlyArray<Theme>;
  readonly note: string;
  readonly consumedSignalIds: ReadonlyArray<string>;
}

/**
 * Persistence boundary for the discernment memory: read a snapshot, write a
 * pass's deltas. `consolidate` is a pure function of the snapshot, so this seam
 * is its only I/O — which keeps each run crash-safe and replayable.
 */
export interface MemoryShape {
  readonly loadSnapshot: (accountId: string) => Effect.Effect<MemorySnapshot, Cause.UnknownError>;
  readonly apply: (
    accountId: string,
    result: ConsolidationResult,
  ) => Effect.Effect<void, Cause.UnknownError>;
}

export class Memory extends Context.Service<Memory, MemoryShape>()("@vanda/pipeline/Memory") {}
