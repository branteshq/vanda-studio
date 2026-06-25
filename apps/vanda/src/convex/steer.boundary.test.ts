// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const signal = (accountId: string, externalId: string, now: number) => ({
  accountId: accountId as never,
  source: "comments" as const,
  externalId,
  text: externalId,
  observedAt: now,
  consolidatedAt: now,
  salience: 0.8,
});

describe("steer — owner corrects the reasoning, not just the output", () => {
  it("marks a signal noise: recomputes confidence and pauses a now-ungrounded idea", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const accountId = await t.run((ctx) =>
      ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now }),
    );
    const s1 = await t.run((ctx) => ctx.db.insert("signals", signal(accountId, "c1", now)));
    const s2 = await t.run((ctx) => ctx.db.insert("signals", signal(accountId, "c2", now)));
    const s3 = await t.run((ctx) => ctx.db.insert("signals", signal(accountId, "c3", now)));
    const beliefId = await t.run((ctx) =>
      ctx.db.insert("beliefs", {
        accountId,
        statement: "público ama pet",
        kind: "audience",
        confidence: 0.657, // three signals worth (1 − 0.7³)
        supportingSignalIds: [s1, s2, s3],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "active",
      }),
    );
    const suggestionId = await t.run((ctx) =>
      ctx.db.insert("suggestions", {
        accountId,
        title: "Reels pet-friendly",
        rationale: "r",
        themeName: "Pets",
        beliefStatements: ["público ama pet"],
        signalIds: [s1, s2, s3],
        status: "approved",
        requiresApproval: false,
        createdAt: now,
      }),
    );

    await t.mutation(internal.steer.markSignalNoise, { signalId: s1 });

    const belief = await t.run((ctx) => ctx.db.get(beliefId));
    expect(belief!.confidence).toBeLessThan(0.657); // inverse-reinforce dropped it
    expect(belief!.supportingSignalIds).toEqual([s2, s3]);
    expect((await t.run((ctx) => ctx.db.get(s1)))!.noise).toBe(true);

    // It fell below the evidence bar → the idea it grounds pauses for the owner.
    const suggestion = await t.run((ctx) => ctx.db.get(suggestionId));
    expect(suggestion!.status).toBe("needs_you");
    expect(suggestion!.requiresApproval).toBe(true);
  });

  it("leaves a still-grounded idea untouched when the belief stays above the bar", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const accountId = await t.run((ctx) =>
      ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now }),
    );
    const ids = await t.run(async (ctx) => {
      const out: string[] = [];
      for (const e of ["c1", "c2", "c3", "c4"]) {
        out.push(await ctx.db.insert("signals", signal(accountId, e, now)));
      }
      return out;
    });
    await t.run((ctx) =>
      ctx.db.insert("beliefs", {
        accountId,
        statement: "público ama pet",
        kind: "audience",
        confidence: 0.76, // four signals worth (1 − 0.7⁴)
        supportingSignalIds: ids,
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "active",
      }),
    );
    const suggestionId = await t.run((ctx) =>
      ctx.db.insert("suggestions", {
        accountId,
        title: "Reels pet-friendly",
        rationale: "r",
        themeName: "Pets",
        beliefStatements: ["público ama pet"],
        signalIds: ids,
        status: "approved",
        requiresApproval: false,
        createdAt: now,
      }),
    );

    await t.mutation(internal.steer.markSignalNoise, { signalId: ids[0]! as never });

    const suggestion = await t.run((ctx) => ctx.db.get(suggestionId));
    expect(suggestion!.status).toBe("approved"); // 3 signals @ 0.657 still clears the bar
  });

  it("corrects a belief's wording and re-points the ideas that cite it", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const accountId = await t.run((ctx) =>
      ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now }),
    );
    const beliefId = await t.run((ctx) =>
      ctx.db.insert("beliefs", {
        accountId,
        statement: "público ama pet",
        kind: "audience",
        confidence: 0.7,
        supportingSignalIds: ["s1"],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "active",
      }),
    );
    const suggestionId = await t.run((ctx) =>
      ctx.db.insert("suggestions", {
        accountId,
        title: "Reels",
        rationale: "r",
        themeName: "Pets",
        beliefStatements: ["público ama pet"],
        signalIds: ["s1"],
        status: "approved",
        requiresApproval: false,
        createdAt: now,
      }),
    );

    await t.mutation(internal.steer.correctBelief, {
      beliefId,
      statement: "público ama cachorros no inverno",
    });

    expect((await t.run((ctx) => ctx.db.get(beliefId)))!.statement).toBe(
      "público ama cachorros no inverno",
    );
    expect((await t.run((ctx) => ctx.db.get(suggestionId)))!.beliefStatements).toEqual([
      "público ama cachorros no inverno",
    ]);
  });

  it("refuses to rename a belief onto another belief's statement", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const accountId = await t.run((ctx) =>
      ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now }),
    );
    const mk = (statement: string) =>
      t.run((ctx) =>
        ctx.db.insert("beliefs", {
          accountId,
          statement,
          kind: "audience",
          confidence: 0.7,
          supportingSignalIds: [],
          firstSeenAt: now,
          confidenceAsOf: now,
          status: "active",
        }),
      );
    const a = await mk("público ama pet");
    await mk("manhãs engajam");

    // Statements are the provenance key — a colliding rename is rejected.
    await expect(
      t.mutation(internal.steer.correctBelief, { beliefId: a, statement: "manhãs engajam" }),
    ).rejects.toThrow();
    expect((await t.run((ctx) => ctx.db.get(a)))!.statement).toBe("público ama pet");
  });
});
