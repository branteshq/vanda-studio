import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { type Mutable } from "./liveModel";
import {
  Memory,
  type ConsolidationResult,
  type MemoryShape,
  type MemorySnapshot,
} from "./memoryStore";

export const accountKey = (id: string): Id<"accounts"> => id as Id<"accounts">;

const applyResult = (
  ctx: ActionCtx,
  accountId: string,
  result: ConsolidationResult,
): Promise<unknown> =>
  ctx.runMutation(internal.consolidate.applyConsolidation, {
    accountId: accountKey(accountId),
    beliefs: result.beliefs as unknown as Mutable<ConsolidationResult["beliefs"]>,
    themes: result.themes as unknown as Mutable<ConsolidationResult["themes"]>,
    note: result.note,
    consumedSignals: result.consumedSignals.map((signal) => ({
      id: signal.id,
      salience: signal.salience,
      ...(signal.discardedReason === undefined ? {} : { discardedReason: signal.discardedReason }),
    })),
  });

/**
 * `Memory` backed by the Convex action `ctx` — the canonical binding shared by
 * consolidate (read snapshot + write deltas) and plan (read snapshot). Explicit
 * method return types break the `api ↔ *Action ↔ live*` import cycle.
 */
export const memoryStoreLive = (ctx: ActionCtx): Layer.Layer<Memory> =>
  Layer.succeed(Memory, {
    loadSnapshot: (accountId: string): Effect.Effect<MemorySnapshot, Cause.UnknownError> =>
      Effect.tryPromise(() =>
        ctx.runQuery(internal.consolidate.loadSnapshot, { accountId: accountKey(accountId) }),
      ),
    apply: (
      accountId: string,
      result: ConsolidationResult,
    ): Effect.Effect<void, Cause.UnknownError> =>
      Effect.tryPromise(() => applyResult(ctx, accountId, result)).pipe(Effect.asVoid),
  } satisfies MemoryShape);

/** Build replacement memory first; only clear the previous derivation after success. */
export const memoryRebuildLive = (ctx: ActionCtx): Layer.Layer<Memory> =>
  Layer.succeed(Memory, {
    loadSnapshot: (accountId: string): Effect.Effect<MemorySnapshot, Cause.UnknownError> =>
      Effect.map(
        Effect.tryPromise(() =>
          ctx.runQuery(internal.consolidate.loadSnapshot, { accountId: accountKey(accountId) }),
        ),
        (snapshot) => ({ ...snapshot, beliefs: [], themes: [] }),
      ),
    apply: (
      accountId: string,
      result: ConsolidationResult,
    ): Effect.Effect<void, Cause.UnknownError> =>
      Effect.tryPromise(async () => {
        await ctx.runMutation(internal.pipelineAdmin.resetDerived, {
          accountId: accountKey(accountId),
        });
        await applyResult(ctx, accountId, result);
      }).pipe(Effect.asVoid),
  } satisfies MemoryShape);
