// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { memoryStoreLive } from "./pipeline/liveMemory";
import { suggestionsStoreLive } from "./pipeline/livePlan";
import { type Idea, plan } from "./pipeline/plan";
import { makePlannerStub } from "./pipeline/plan.testing";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const DOG = "customers love the resident golden retriever";
const ideas: ReadonlyArray<Idea> = [
  {
    title: "Golden retriever winter feature",
    format: "feed",
    themeName: "Dog content",
    beliefStatements: [DOG],
    rationale: "ride the rising theme",
  },
];
const accept = () => ({ verdict: "accept" as const, reason: "ok", sensitive: false });
const planStub = makePlannerStub(ideas, accept);

describe("plan through the ctx-backed stores", () => {
  it("persists a suggestion grounded in a held belief, with provenance", async () => {
    const t = convexTest(schema, modules);
    const { accountId, signalIds } = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now });
      const ids = [];
      for (const externalId of ["c1", "c2", "c3"]) {
        ids.push(
          await ctx.db.insert("signals", {
            accountId: id,
            source: "comments",
            externalId,
            text: "the dog",
            observedAt: 1,
          }),
        );
      }
      await ctx.db.insert("beliefs", {
        accountId: id,
        statement: DOG,
        kind: "audience",
        confidence: 0.7,
        supportingSignalIds: ids,
        firstSeenAt: 0,
        confidenceAsOf: now,
        status: "active",
      });
      await ctx.db.insert("themes", {
        accountId: id,
        name: "Dog content",
        summary: "golden",
        momentum: "rising",
        postCount: 0,
        signalCount: 3,
      });
      return { accountId: id, signalIds: ids };
    });

    await t.action(async (ctx) =>
      Effect.runPromise(
        plan(accountId).pipe(
          Effect.provide(memoryStoreLive(ctx)),
          Effect.provide(suggestionsStoreLive(ctx)),
          Effect.provide(planStub),
        ),
      ),
    );

    const all = await t.query(internal.plan.listSuggestions, { accountId });
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("approved");
    expect(all[0]!.beliefStatements).toEqual([DOG]);
    expect(all[0]!.signalIds).toEqual(signalIds);
  });

  it("replaces open suggestions on a re-plan but preserves committed ones", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now });
      const base = {
        accountId: id,
        rationale: "",
        format: "feed" as const,
        themeName: "x",
        beliefStatements: [],
        signalIds: [],
        requiresApproval: false,
        createdAt: 0,
      };
      await ctx.db.insert("suggestions", { ...base, title: "stale open", status: "suggestion" });
      await ctx.db.insert("suggestions", { ...base, title: "committed", status: "scheduled" });
      await ctx.db.insert("beliefs", {
        accountId: id,
        statement: DOG,
        kind: "audience",
        confidence: 0.7,
        supportingSignalIds: ["a", "b", "c"],
        firstSeenAt: 0,
        confidenceAsOf: now,
        status: "active",
      });
      return id;
    });

    await t.action(async (ctx) =>
      Effect.runPromise(
        plan(accountId).pipe(
          Effect.provide(memoryStoreLive(ctx)),
          Effect.provide(suggestionsStoreLive(ctx)),
          Effect.provide(planStub),
        ),
      ),
    );

    const titles = (await t.query(internal.plan.listSuggestions, { accountId })).map(
      (s) => s.title,
    );
    expect(titles).toContain("committed"); // committed state survived re-plan
    expect(titles).not.toContain("stale open"); // open one cleared
    expect(titles).toContain("Golden retriever winter feature"); // fresh batch inserted
  });
});
