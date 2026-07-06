// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const OWNER = "owner-clerk";
const INTRUDER = "intruder-clerk";

/**
 * Seed the auth fixture every board op gates on: the caller's `users` row + one
 * `accounts` row they own, plus a second user who owns nothing (the non-owner
 * whose identity must collapse to "account not found"). `withIdentity({subject:
 * OWNER})` then passes `requireOwnedAccount`; `INTRUDER` fails it.
 */
const seedOwnedAccount = async (t: TestConvex<typeof schema>): Promise<Id<"accounts">> => {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: OWNER });
    await ctx.db.insert("users", { name: "Other", email: "o@e.com", clerkId: INTRUDER });
    return await ctx.db.insert("accounts", {
      ownerUserId: me,
      mode: "auto",
      createdAt: now,
      updatedAt: now,
    });
  });
};

describe("board.board — the Automático board, partitioned by control status", () => {
  it("partitions by status, joins the belief chip + scheduled provenance, excludes dropped ideas", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const now = Date.now();

    const ids = await t.run(async (ctx) => {
      const belief = await ctx.db.insert("beliefs", {
        accountId,
        statement: "dogs delight customers",
        kind: "audience",
        confidence: 0.82,
        supportingSignalIds: [],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "active",
      });
      const base = {
        accountId,
        rationale: "r",
        themeName: "Dogs",
        signalIds: [],
        requiresApproval: false,
      };
      // One card per status; created times ascending so `desc` order is deterministic.
      const needsYou = await ctx.db.insert("suggestions", {
        ...base,
        title: "Precisa de você",
        beliefStatements: ["no belief cites this"], // → belief chip null
        status: "needs_you",
        createdAt: now + 1,
      });
      const creating = await ctx.db.insert("suggestions", {
        ...base,
        title: "Vanda fazendo",
        beliefStatements: [],
        status: "creating",
        progress: 0.4, // → progress passthrough
        createdAt: now + 2,
      });
      const poolSuggestion = await ctx.db.insert("suggestions", {
        ...base,
        title: "Proposta",
        beliefStatements: ["dogs delight customers"], // → belief chip join
        status: "suggestion",
        createdAt: now + 3,
      });
      const poolApproved = await ctx.db.insert("suggestions", {
        ...base,
        title: "Aprovada",
        beliefStatements: [],
        status: "approved",
        createdAt: now + 4,
      });
      const dismissed = await ctx.db.insert("suggestions", {
        ...base,
        title: "Dispensada",
        beliefStatements: [],
        status: "dismissed",
        createdAt: now + 5,
      });
      const rejected = await ctx.db.insert("suggestions", {
        ...base,
        title: "Rejeitada",
        beliefStatements: [],
        status: "rejected",
        rejectionReason: "off-brand",
        createdAt: now + 6,
      });

      // Scheduled chain: scheduledPost → post(suggestionId) → belief.
      const scheduledSuggestion = await ctx.db.insert("suggestions", {
        ...base,
        title: "Agendado: cães",
        beliefStatements: ["dogs delight customers"],
        status: "scheduled",
        createdAt: now + 7,
      });
      const postWithProvenance = await ctx.db.insert("posts", {
        accountId,
        type: "reel",
        imageIds: [],
        caption: "c",
        platform: "instagram",
        status: "scheduled",
        suggestionId: scheduledSuggestion,
        createdAt: now,
      });
      const postOrphan = await ctx.db.insert("posts", {
        accountId,
        type: "feed",
        imageIds: [],
        caption: "c",
        platform: "instagram",
        status: "scheduled",
        createdAt: now,
      });
      const postPublished = await ctx.db.insert("posts", {
        accountId,
        type: "story",
        imageIds: [],
        caption: "c",
        platform: "instagram",
        status: "published",
        createdAt: now,
      });
      // Included, asc by scheduledFor → [orphan(+1000), provenance(+2000)].
      const schedLater = await ctx.db.insert("scheduledPosts", {
        accountId,
        postId: postWithProvenance,
        scheduledFor: now + 2000,
        status: "scheduled",
        createdAt: now,
        updatedAt: now,
      });
      const schedSooner = await ctx.db.insert("scheduledPosts", {
        accountId,
        postId: postOrphan,
        scheduledFor: now + 1000,
        status: "scheduled",
        createdAt: now,
        updatedAt: now,
      });
      // Excluded: published + failed never surface on the calendar.
      await ctx.db.insert("scheduledPosts", {
        accountId,
        postId: postPublished,
        scheduledFor: now + 500,
        status: "published",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("scheduledPosts", {
        accountId,
        postId: postOrphan,
        scheduledFor: now + 400,
        status: "failed",
        createdAt: now,
        updatedAt: now,
      });

      return {
        belief,
        needsYou,
        creating,
        poolSuggestion,
        poolApproved,
        dismissed,
        rejected,
        schedLater,
        schedSooner,
      };
    });

    const board = await t.withIdentity({ subject: OWNER }).query(api.board.board, { accountId });

    // Partitions hold exactly the right statuses.
    expect(board.needsYou.map((c) => c.id)).toEqual([ids.needsYou]);
    expect(board.creating.map((c) => c.id)).toEqual([ids.creating]);
    expect(new Set(board.pool.map((c) => c.id))).toEqual(
      new Set([ids.poolSuggestion, ids.poolApproved]),
    );

    // Dropped ideas (dismissed/rejected) appear in no partition.
    const shown = [...board.needsYou, ...board.creating, ...board.pool].map((c) => c.id);
    expect(shown).not.toContain(ids.dismissed);
    expect(shown).not.toContain(ids.rejected);

    // Belief chip join: statement + confidence, or null when nothing cites a belief.
    const cited = board.pool.find((c) => c.id === ids.poolSuggestion)!;
    expect(cited.belief).toEqual({ statement: "dogs delight customers", confidence: 0.82 });
    expect(board.needsYou[0]!.belief).toBeNull();

    // Progress passthrough: creating carries it, an untouched suggestion is null.
    expect(board.creating[0]!.progress).toBe(0.4);
    expect(cited.progress).toBeNull();

    // Scheduled join: asc by scheduledFor, published/failed excluded, title/format/belief joined.
    expect(board.scheduled.map((s) => s.id)).toEqual([ids.schedSooner, ids.schedLater]);
    const sooner = board.scheduled[0]!;
    const later = board.scheduled[1]!;
    expect(later.title).toBe("Agendado: cães");
    expect(later.format).toBe("reel");
    expect(later.belief).toEqual({ statement: "dogs delight customers", confidence: 0.82 });
    // Orphan post (no suggestion) → default title, null belief, its own post format.
    expect(sooner.title).toBe("Post agendado");
    expect(sooner.format).toBe("feed");
    expect(sooner.belief).toBeNull();
  });

  it("rejects a non-owner and an anonymous caller", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    await expect(
      t.withIdentity({ subject: INTRUDER }).query(api.board.board, { accountId }),
    ).rejects.toThrow(/account not found/);
    await expect(t.query(api.board.board, { accountId })).rejects.toThrow();
  });
});

describe("board.observing — the Observando rail", () => {
  it("surfaces salient-first notable signals (noise excluded, capped 5) with routine + today counts", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const { noise } = await t.run(async (ctx) => {
      const signal = (externalId: string, salience: number, observedAt: number, noise?: boolean) =>
        ctx.db.insert("signals", {
          accountId,
          source: "comments" as const,
          externalId,
          text: externalId,
          observedAt,
          salience,
          ...(noise ? { noise: true } : {}),
        });
      // 6 live within 24h + 1 old live (48h) + 1 noise (highest salience).
      await signal("s090", 0.9, now);
      await signal("s075", 0.75, now);
      await signal("s060", 0.6, now);
      await signal("s045", 0.45, now);
      await signal("s030", 0.3, now);
      await signal("s015", 0.15, now);
      await signal("sOld", 0.5, dayAgo - 60_000); // old but live → notable-eligible, not "today"
      const noise = await signal("sNoise", 0.99, now, true); // highest salience, still excluded
      return { noise };
    });

    const obs = await t.withIdentity({ subject: OWNER }).query(api.board.observing, { accountId });

    // totalToday counts every signal in the last 24h (noise included), old ones excluded.
    expect(obs.totalToday).toBe(7); // 6 recent live + 1 noise; old one is 48h back

    // notable: salient-first, capped at 5, noise excluded despite its 0.99.
    expect(obs.notable).toHaveLength(5);
    expect(obs.notable.map((n) => n.salience)).toEqual([0.9, 0.75, 0.6, 0.5, 0.45]);
    expect(obs.notable.some((n) => n.id === noise)).toBe(false);
    expect(obs.notable[0]!.source).toBe("comments");
    expect(obs.notable[0]!.text).toBe("s090");

    // routineCount = live (7) minus the 5 notable = 2.
    expect(obs.routineCount).toBe(2);
  });

  it("learns the strongest live beliefs, retired excluded, hinting how each cashes out", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const now = Date.now();

    const ids = await t.run(async (ctx) => {
      const sigA = await ctx.db.insert("signals", {
        accountId,
        source: "comments",
        externalId: "a",
        text: "a",
        observedAt: now,
      });
      const sigB = await ctx.db.insert("signals", {
        accountId,
        source: "mentions",
        externalId: "b",
        text: "b",
        observedAt: now,
      });
      const belief = (statement: string, confidence: number, opts?: Partial<{ retired: boolean; support: string[] }>) =>
        ctx.db.insert("beliefs", {
          accountId,
          statement,
          kind: "audience" as const,
          confidence,
          supportingSignalIds: opts?.support ?? [],
          firstSeenAt: now,
          confidenceAsOf: now,
          status: opts?.retired ? ("retired" as const) : ("active" as const),
        });
      const agenda = await belief("S_agenda", 0.9, { support: [sigA, sigB] });
      const needsYou = await belief("S_needs", 0.8);
      const idea = await belief("S_idea", 0.7);
      const none = await belief("S_null", 0.6);
      const retired = await belief("S_retired", 0.99, { retired: true }); // top confidence, still excluded

      const cite = (statement: string, status: "scheduled" | "needs_you" | "suggestion" | "dismissed") =>
        ctx.db.insert("suggestions", {
          accountId,
          title: statement,
          rationale: "r",
          themeName: "t",
          beliefStatements: [statement],
          signalIds: [],
          status,
          requiresApproval: false,
          createdAt: now,
        });
      await cite("S_agenda", "scheduled"); // → agenda
      await cite("S_needs", "needs_you"); // → needs_you
      await cite("S_idea", "suggestion"); // → idea
      await cite("S_null", "dismissed"); // dismissed doesn't cash out → null

      return { agenda, needsYou, idea, none, retired };
    });

    const obs = await t.withIdentity({ subject: OWNER }).query(api.board.observing, { accountId });

    // Retired excluded even at the highest confidence; the rest sorted desc.
    expect(obs.learned.map((b) => b.id)).toEqual([ids.agenda, ids.needsYou, ids.idea, ids.none]);
    expect(obs.learned.some((b) => b.id === ids.retired)).toBe(false);
    expect(obs.learned.map((b) => b.confidence)).toEqual([0.9, 0.8, 0.7, 0.6]);

    // Hint derivation from the citing suggestions' statuses.
    const byId = new Map(obs.learned.map((b) => [b.id, b] as const));
    expect(byId.get(ids.agenda)!.hint).toBe("agenda");
    expect(byId.get(ids.needsYou)!.hint).toBe("needs_you");
    expect(byId.get(ids.idea)!.hint).toBe("idea");
    expect(byId.get(ids.none)!.hint).toBeNull();

    // signalCount = supportingSignalIds length.
    expect(byId.get(ids.agenda)!.signalCount).toBe(2);
    expect(byId.get(ids.idea)!.signalCount).toBe(0);
  });

  it("rejects a non-owner", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    await expect(
      t.withIdentity({ subject: INTRUDER }).query(api.board.observing, { accountId }),
    ).rejects.toThrow(/account not found/);
  });
});

describe("board.lineage — intervir na linhagem", () => {
  it("resolves the primary belief, salient-first noise-flagged signals, and the discarded count", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const now = Date.now();

    const ids = await t.run(async (ctx) => {
      const sig = (externalId: string, salience: number, noise?: boolean) =>
        ctx.db.insert("signals", {
          accountId,
          source: "comments" as const,
          externalId,
          text: externalId,
          observedAt: now,
          salience,
          ...(noise ? { noise: true } : {}),
        });
      const sigHigh = await sig("high", 0.9);
      const sigMid = await sig("mid", 0.6);
      const sigLowNoise = await sig("lowNoise", 0.3, true);
      // Two extra account signals Vanda saw but didn't lean on → discarded.
      await sig("extra1", 0.2);
      await sig("extra2", 0.1);

      // Two beliefs; the suggestion's beliefStatements[0] picks the primary one.
      const primary = await ctx.db.insert("beliefs", {
        accountId,
        statement: "S_primary",
        kind: "audience",
        confidence: 0.71,
        supportingSignalIds: [sigHigh, sigMid, sigLowNoise],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "active",
      });
      await ctx.db.insert("beliefs", {
        accountId,
        statement: "S_secondary",
        kind: "trend",
        confidence: 0.99, // higher, but not index 0 → must not be chosen
        supportingSignalIds: [],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "active",
      });
      const suggestion = await ctx.db.insert("suggestions", {
        accountId,
        title: "Ideia",
        rationale: "r",
        themeName: "t",
        beliefStatements: ["S_primary", "S_secondary"],
        signalIds: [],
        status: "suggestion",
        requiresApproval: false,
        createdAt: now,
      });
      return { suggestion, primary, sigHigh, sigMid, sigLowNoise };
    });

    const lineage = await t
      .withIdentity({ subject: OWNER })
      .query(api.board.lineage, { suggestionId: ids.suggestion });

    // Belief resolved from beliefStatements[0], not the higher-confidence [1].
    expect(lineage.belief).toEqual({
      id: ids.primary,
      statement: "S_primary",
      confidence: 0.71,
      kind: "audience",
    });
    expect(lineage.suggestion).toEqual({ id: ids.suggestion, title: "Ideia" });

    // Salient-first, each carrying its noise flag.
    expect(lineage.salientSignals.map((s) => s.id)).toEqual([
      ids.sigHigh,
      ids.sigMid,
      ids.sigLowNoise,
    ]);
    expect(lineage.salientSignals.map((s) => s.noise)).toEqual([false, false, true]);

    // discardedCount = totalAccountSignals(5) - salient(3).
    expect(lineage.discardedCount).toBe(2);
  });

  it("throws on a missing suggestion and a non-owner", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const now = Date.now();
    const suggestionId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("suggestions", {
        accountId,
        title: "Ideia",
        rationale: "r",
        themeName: "t",
        beliefStatements: [],
        signalIds: [],
        status: "suggestion",
        requiresApproval: false,
        createdAt: now,
      });
      const ghost = await ctx.db.insert("suggestions", {
        accountId,
        title: "ghost",
        rationale: "r",
        themeName: "t",
        beliefStatements: [],
        signalIds: [],
        status: "suggestion",
        requiresApproval: false,
        createdAt: now,
      });
      await ctx.db.delete(ghost); // valid-shaped id that no longer resolves
      return { real: id, ghost };
    });

    await expect(
      t.withIdentity({ subject: OWNER }).query(api.board.lineage, { suggestionId: suggestionId.ghost }),
    ).rejects.toThrow(/suggestion not found/);
    await expect(
      t.withIdentity({ subject: INTRUDER }).query(api.board.lineage, { suggestionId: suggestionId.real }),
    ).rejects.toThrow(/account not found/);
  });
});

describe("board.dismiss — dispensar", () => {
  it("dismisses an idea the owner owns and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const now = Date.now();
    const suggestionId = await t.run((ctx) =>
      ctx.db.insert("suggestions", {
        accountId,
        title: "Ideia",
        rationale: "r",
        themeName: "t",
        beliefStatements: [],
        signalIds: [],
        status: "suggestion",
        requiresApproval: false,
        createdAt: now,
      }),
    );

    const asOwner = t.withIdentity({ subject: OWNER });
    await asOwner.mutation(api.board.dismiss, { suggestionId });
    expect((await t.run((ctx) => ctx.db.get(suggestionId)))!.status).toBe("dismissed");

    // Idempotent: dismissing an already-dismissed idea is a no-op, not an error.
    await asOwner.mutation(api.board.dismiss, { suggestionId });
    expect((await t.run((ctx) => ctx.db.get(suggestionId)))!.status).toBe("dismissed");
  });

  it("dismisses a creating idea that never started a workflow (no cancel needed)", async () => {
    // NOTE: dismiss cancels an in-flight workflow only when workflowId is set;
    // that `cancel()` hits the @convex-dev/workflow component, which convex-test
    // cannot run. The reachable contract is the guarded path: a "creating" idea
    // with no workflowId dismisses directly, skipping the cancel branch.
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const now = Date.now();
    const suggestionId = await t.run((ctx) =>
      ctx.db.insert("suggestions", {
        accountId,
        title: "Sem workflow",
        rationale: "r",
        themeName: "t",
        beliefStatements: [],
        signalIds: [],
        status: "creating",
        progress: 0.2,
        requiresApproval: false,
        createdAt: now,
      }),
    );
    await t.withIdentity({ subject: OWNER }).mutation(api.board.dismiss, { suggestionId });
    expect((await t.run((ctx) => ctx.db.get(suggestionId)))!.status).toBe("dismissed");
  });

  it("throws for a non-owner and a missing suggestion", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const now = Date.now();
    const { real, ghost } = await t.run(async (ctx) => {
      const real = await ctx.db.insert("suggestions", {
        accountId,
        title: "Ideia",
        rationale: "r",
        themeName: "t",
        beliefStatements: [],
        signalIds: [],
        status: "suggestion",
        requiresApproval: false,
        createdAt: now,
      });
      const ghost = await ctx.db.insert("suggestions", {
        accountId,
        title: "ghost",
        rationale: "r",
        themeName: "t",
        beliefStatements: [],
        signalIds: [],
        status: "suggestion",
        requiresApproval: false,
        createdAt: now,
      });
      await ctx.db.delete(ghost);
      return { real, ghost };
    });

    await expect(
      t.withIdentity({ subject: INTRUDER }).mutation(api.board.dismiss, { suggestionId: real }),
    ).rejects.toThrow(/account not found/);
    // The unowned idea was not touched.
    expect((await t.run((ctx) => ctx.db.get(real)))!.status).toBe("suggestion");
    await expect(
      t.withIdentity({ subject: OWNER }).mutation(api.board.dismiss, { suggestionId: ghost }),
    ).rejects.toThrow(/suggestion not found/);
  });
});

describe("board.markNoise / board.correctBelief — auth wrappers over the steer impls", () => {
  it("markNoise: owner flips the signal to noise, non-owner is rejected", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const now = Date.now();
    const signalId = await t.run((ctx) =>
      ctx.db.insert("signals", {
        accountId,
        source: "comments",
        externalId: "c1",
        text: "c1",
        observedAt: now,
        salience: 0.5,
      }),
    );

    await expect(
      t.withIdentity({ subject: INTRUDER }).mutation(api.board.markNoise, { signalId }),
    ).rejects.toThrow(/account not found/);
    expect((await t.run((ctx) => ctx.db.get(signalId)))!.noise).toBeUndefined();

    await t.withIdentity({ subject: OWNER }).mutation(api.board.markNoise, { signalId });
    expect((await t.run((ctx) => ctx.db.get(signalId)))!.noise).toBe(true);
  });

  it("correctBelief: owner renames the belief, non-owner is rejected", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const now = Date.now();
    const beliefId = await t.run((ctx) =>
      ctx.db.insert("beliefs", {
        accountId,
        statement: "old wording",
        kind: "audience",
        confidence: 0.7,
        supportingSignalIds: [],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "active",
      }),
    );

    await expect(
      t
        .withIdentity({ subject: INTRUDER })
        .mutation(api.board.correctBelief, { beliefId, statement: "new wording" }),
    ).rejects.toThrow(/account not found/);
    expect((await t.run((ctx) => ctx.db.get(beliefId)))!.statement).toBe("old wording");

    await t
      .withIdentity({ subject: OWNER })
      .mutation(api.board.correctBelief, { beliefId, statement: "new wording" });
    expect((await t.run((ctx) => ctx.db.get(beliefId)))!.statement).toBe("new wording");
  });
});
