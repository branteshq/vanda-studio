// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { consolidate, type SignalJudgment } from "./pipeline/consolidate";
import { makeStubConsolidator } from "./pipeline/consolidate.testing";
import { memoryStoreLive } from "./pipeline/liveMemory";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const judge = (): SignalJudgment => ({
  kind: "audience",
  salience: 0.7,
  relation: "novel",
  beliefStatement: "customers love the golden retriever",
  themeName: "Dog content",
});

describe("consolidate through the ctx-backed memory store", () => {
  it("persists beliefs/themes/notes and clears the pending queue", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now });
      await ctx.db.insert("signals", {
        accountId: id,
        source: "comments",
        externalId: "c1",
        text: "the dog is adorable",
        observedAt: 1,
      });
      return id;
    });

    const pending = await t.query(internal.consolidate.listUnconsolidatedSignals, { accountId });
    expect(pending).toHaveLength(1);

    const inputs = pending.map((s) => ({
      id: s._id,
      source: s.source,
      text: s.text,
      observedAt: s.observedAt,
    }));
    await t.action(async (ctx) =>
      Effect.runPromise(
        consolidate(accountId, inputs).pipe(
          Effect.provide(memoryStoreLive(ctx)),
          Effect.provide(makeStubConsolidator(judge)),
        ),
      ),
    );

    const snapshot = await t.query(internal.consolidate.loadSnapshot, { accountId });
    expect(snapshot.beliefs).toHaveLength(1);
    expect(snapshot.beliefs[0]!.statement).toBe("customers love the golden retriever");
    expect(snapshot.beliefs[0]!.supportingSignalIds).toEqual(inputs.map((s) => s.id));
    expect(snapshot.themes).toHaveLength(1);

    const notes = await t.run((ctx) => ctx.db.query("memoryNotes").collect());
    expect(notes).toHaveLength(1);
    expect(notes[0]!.signalCount).toBe(1);

    // the signal is marked consolidated → no longer pending
    const stillPending = await t.query(internal.consolidate.listUnconsolidatedSignals, {
      accountId,
    });
    expect(stillPending).toHaveLength(0);
  });

  it("upserts an existing belief by statement rather than duplicating it", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now });
      await ctx.db.insert("beliefs", {
        accountId: id,
        statement: "customers love the golden retriever",
        kind: "audience",
        confidence: 0.3,
        supportingSignalIds: ["seed"],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "decaying",
      });
      await ctx.db.insert("themes", {
        accountId: id,
        name: "Dog content",
        summary: "the resident golden retriever",
        momentum: "steady",
        lastPostedAt: 123,
        postCount: 2,
        signalCount: 5,
      });
      await ctx.db.insert("signals", {
        accountId: id,
        source: "comments",
        externalId: "c2",
        text: "still adorable",
        observedAt: 5,
      });
      return id;
    });

    const pending = await t.query(internal.consolidate.listUnconsolidatedSignals, { accountId });
    const inputs = pending.map((s) => ({
      id: s._id,
      source: s.source,
      text: s.text,
      observedAt: s.observedAt,
    }));
    await t.action(async (ctx) =>
      Effect.runPromise(
        consolidate(accountId, inputs).pipe(
          Effect.provide(memoryStoreLive(ctx)),
          Effect.provide(makeStubConsolidator(judge)),
        ),
      ),
    );

    const snapshot = await t.query(internal.consolidate.loadSnapshot, { accountId });
    expect(snapshot.beliefs).toHaveLength(1); // upserted, not duplicated
    expect(snapshot.beliefs[0]!.confidence).toBeGreaterThan(0.3); // reinforced
    expect(snapshot.beliefs[0]!.supportingSignalIds).toEqual(["seed", ...inputs.map((s) => s.id)]);
    expect(snapshot.beliefs[0]!.kind).toBe("audience"); // scalar fields survive the snapshot projection
    expect(snapshot.themes).toHaveLength(1); // upserted by name, not duplicated
    expect(snapshot.themes[0]!.signalCount).toBe(6); // 5 + 1
    expect(snapshot.themes[0]!.lastPostedAt).toBe(123); // preserved through replace
    expect(snapshot.themes[0]!.postCount).toBe(2);
  });
});
