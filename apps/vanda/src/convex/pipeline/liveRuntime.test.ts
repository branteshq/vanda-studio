import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { memoryRebuildLive, memoryStoreLive } from "./liveMemory";
import { runTracked } from "./liveTelemetry";
import { Memory, type ConsolidationResult } from "./memoryStore";

const accountId = "account-1" as Id<"accounts">;
const result: ConsolidationResult = {
  beliefs: [],
  themes: [],
  note: "rebuild",
  consumedSignals: [{ id: "signal-1", salience: 0, discardedReason: "reação genérica" }],
};

describe("live pipeline runtime boundaries", () => {
  it("preserves the provider error in telemetry and the rejected promise", async () => {
    const mutations: unknown[] = [];
    const ctx = {
      runMutation: vi.fn(async (_name: unknown, args: unknown) => {
        mutations.push(args);
        return mutations.length === 1 ? "run-1" : undefined;
      }),
    } as unknown as ActionCtx;

    await expect(
      runTracked(
        ctx,
        {
          accountId,
          stage: "consolidate",
          model: "openai/gpt-5-nano",
          promptVersion: "test",
          inputIds: ["signal-1"],
        },
        () => Promise.reject(new Error("structured output failed")),
        () => "unused",
      ),
    ).rejects.toThrow("structured output failed");

    expect(mutations[1]).toMatchObject({
      status: "failed",
      error: "Error: structured output failed",
    });
  });

  it("does not clear derived memory until a successful result is applied", async () => {
    let mutationCount = 0;
    const ctx = {
      runQuery: vi.fn(async () => ({
        beliefs: [{ statement: "existing" }],
        themes: [{ name: "existing" }],
        policy: {},
        mode: "needs_approval",
      })),
      runMutation: vi.fn(async () => {
        mutationCount += 1;
      }),
    } as unknown as ActionCtx;

    const snapshot = await Effect.runPromise(
      Effect.flatMap(Memory, (memory) => memory.loadSnapshot(accountId)).pipe(
        Effect.provide(memoryRebuildLive(ctx)),
      ),
    );
    expect(snapshot.beliefs).toEqual([]);
    expect(snapshot.themes).toEqual([]);
    expect(mutationCount).toBe(0);

    await Effect.runPromise(
      Effect.flatMap(Memory, (memory) => memory.apply(accountId, result)).pipe(
        Effect.provide(memoryRebuildLive(ctx)),
      ),
    );
    expect(mutationCount).toBe(2);
  });

  it("passes deterministic discard reasons through the live persistence adapter", async () => {
    let applied: unknown;
    const ctx = {
      runMutation: vi.fn(async (_name: unknown, args: unknown) => {
        applied = args;
      }),
    } as unknown as ActionCtx;

    await Effect.runPromise(
      Effect.flatMap(Memory, (memory) => memory.apply(accountId, result)).pipe(
        Effect.provide(memoryStoreLive(ctx)),
      ),
    );

    expect(applied).toMatchObject({
      consumedSignals: [{ id: "signal-1", salience: 0, discardedReason: "reação genérica" }],
    });
  });
});
