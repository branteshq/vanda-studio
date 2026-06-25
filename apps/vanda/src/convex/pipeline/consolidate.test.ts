import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FastCheck from "effect/testing/FastCheck";
import { consolidate, foldConsolidation, SignalJudgment, SIGNAL_MARKER } from "./consolidate";
import {
  failingConsolidator,
  makeMemoryRecorder,
  makeStubConsolidator,
} from "./consolidate.testing";
import type { StoredSignal } from "./domain";
import { Belief, defaultPolicy } from "./memory";
import type { MemorySnapshot } from "./memoryStore";

const signal = (id: string, text: string): StoredSignal => ({
  id,
  source: "comments",
  text,
  observedAt: 1,
});
const fixed = (judgment: SignalJudgment) => () => judgment;
const empty: MemorySnapshot = {
  beliefs: [],
  themes: [],
  policy: defaultPolicy,
  mode: "needs_approval",
};

/** A marker-keyed judge: keys only on the signal text after SIGNAL_MARKER. */
const routeJudge = (prompt: string): SignalJudgment => {
  const text = prompt.slice(prompt.lastIndexOf(SIGNAL_MARKER) + SIGNAL_MARKER.length);
  return text.includes("slow")
    ? {
        kind: "sentiment",
        salience: 0.6,
        relation: "novel",
        beliefStatement: "service can be slow",
        themeName: "Service",
      }
    : {
        kind: "audience",
        salience: 0.7,
        relation: "novel",
        beliefStatement: "customers love dogs",
        themeName: "Dogs",
      };
};

describe("foldConsolidation (pure)", () => {
  it("decays stale beliefs before folding new evidence", () => {
    const stale: Belief = {
      accountId: "acct_1",
      statement: "service is fast",
      kind: "sentiment",
      confidence: 0.8,
      supportingSignalIds: ["s0"],
      firstSeenAt: 0,
      confidenceAsOf: 0,
      status: "active",
    };
    // one half-life later, with no new evidence for it
    const result = foldConsolidation(
      "acct_1",
      { beliefs: [stale], themes: [], policy: defaultPolicy, mode: "needs_approval" },
      [],
      defaultPolicy.decayHalfLifeMs,
    );
    expect(result.beliefs[0]!.confidence).toBeCloseTo(0.4);
  });

  it("does not compound decay across passes (untouched belief)", () => {
    const hl = defaultPolicy.decayHalfLifeMs;
    const belief: Belief = {
      accountId: "acct_1",
      statement: "customers love dogs",
      kind: "audience",
      confidence: 0.8,
      supportingSignalIds: ["s0"],
      firstSeenAt: 0,
      confidenceAsOf: 0,
      status: "active",
    };
    // pass 1 at one half-life (no signals): 0.8 -> 0.4, anchor advances to hl
    const pass1 = foldConsolidation(
      "acct_1",
      { beliefs: [belief], themes: [], policy: defaultPolicy, mode: "needs_approval" },
      [],
      hl,
    );
    expect(pass1.beliefs[0]!.confidence).toBeCloseTo(0.4, 10);
    // pass 2 at two half-lives, feeding pass 1 back: 0.8*0.5^2 = 0.2, NOT 0.4*0.5^2 = 0.1
    const pass2 = foldConsolidation(
      "acct_1",
      { beliefs: pass1.beliefs, themes: [], policy: defaultPolicy, mode: "needs_approval" },
      [],
      2 * hl,
    );
    expect(pass2.beliefs[0]!.confidence).toBeCloseTo(0.2, 10);
  });

  it("is perception only — never produces a post idea", () => {
    const result = foldConsolidation(
      "acct_1",
      empty,
      [
        {
          signal: signal("s1", "x"),
          judgment: {
            kind: "audience",
            salience: 0.5,
            relation: "novel",
            beliefStatement: "b",
            themeName: "t",
          },
        },
      ],
      0,
    );
    expect(Object.keys(result)).toEqual(["beliefs", "themes", "note", "consumedSignals"]);
  });

  const beliefArb = Schema.toArbitrary(Belief);
  const ts = FastCheck.integer({ min: 0, max: 4_000_000_000_000 });
  const signalArb = FastCheck.record({
    id: FastCheck.string(),
    source: FastCheck.constantFrom("comments", "mentions", "competitors", "trends", "posts"),
    text: FastCheck.string(),
    observedAt: ts,
  });
  const judgmentShape = {
    kind: FastCheck.constantFrom("audience", "product", "competitor", "sentiment", "trend"),
    salience: FastCheck.constant(0.5),
    relation: FastCheck.constantFrom("supports", "contradicts", "novel"),
    themeName: FastCheck.constantFrom("t1", "t2"),
  };

  // Draw belief statements from the snapshot so reinforce/contradict-on-match (not just
  // the create path) are exercised; seed a theme so the theme-match branch is hit too.
  const scenario = FastCheck.array(beliefArb, { maxLength: 5 }).chain((beliefs) => {
    const statements = beliefs.map((b) => b.statement);
    const statementArb =
      statements.length > 0
        ? FastCheck.oneof(FastCheck.constantFrom(...statements), FastCheck.string())
        : FastCheck.string();
    const entryArb = FastCheck.record({ ...judgmentShape, beliefStatement: statementArb }).map(
      (judgment) => ({ judgment }),
    );
    return FastCheck.tuple(
      FastCheck.constant(beliefs),
      FastCheck.array(FastCheck.tuple(signalArb, entryArb), { maxLength: 8 }),
      ts,
    );
  });

  it.prop(
    "keeps every belief confidence within [0,1] across reinforce/contradict/create + decay",
    [scenario],
    ([[beliefs, pairs, now]]) => {
      const themes = [
        {
          accountId: "acct_1",
          name: "t1",
          summary: "s",
          momentum: "steady" as const,
          postCount: 0,
          signalCount: 0,
        },
      ];
      const entries = pairs.map(([signal, { judgment }]) => ({ signal, judgment }));
      const result = foldConsolidation(
        "acct_1",
        { beliefs, themes, policy: defaultPolicy, mode: "needs_approval" },
        entries,
        now,
      );
      for (const belief of result.beliefs) {
        expect(belief.confidence).toBeGreaterThanOrEqual(0);
        expect(belief.confidence).toBeLessThanOrEqual(1);
      }
    },
  );
});

describe("consolidate (program, stub model)", () => {
  it.effect("creates a belief + theme from a novel signal and journals it", () =>
    Effect.gen(function* () {
      const recorder = makeMemoryRecorder();
      const judge = fixed({
        kind: "audience",
        salience: 0.7,
        relation: "novel",
        beliefStatement: "customers love the golden retriever",
        themeName: "Dog content",
      });
      const result = yield* consolidate("acct_1", [signal("s1", "the dog is adorable")]).pipe(
        Effect.provide(recorder.layer),
        Effect.provide(makeStubConsolidator(judge)),
      );

      expect(result.beliefs).toHaveLength(1);
      expect(result.beliefs[0]!.statement).toBe("customers love the golden retriever");
      expect(result.beliefs[0]!.kind).toBe("audience");
      expect(result.beliefs[0]!.confidence).toBeCloseTo(defaultPolicy.learningRate);
      expect(result.beliefs[0]!.supportingSignalIds).toEqual(["s1"]);
      expect(result.themes).toHaveLength(1);
      expect(result.note).toContain("1 new");
      expect(recorder.applied).toHaveLength(1);
    }),
  );

  it.effect("accrues independent evidence across runs (confidence rises)", () =>
    Effect.gen(function* () {
      const recorder = makeMemoryRecorder();
      const judge = fixed({
        kind: "audience",
        salience: 0.7,
        relation: "supports",
        beliefStatement: "customers love the golden retriever",
        themeName: "Dog content",
      });
      yield* consolidate("acct_1", [signal("s1", "the dog is adorable")]).pipe(
        Effect.provide(recorder.layer),
        Effect.provide(makeStubConsolidator(judge)),
      );
      const second = yield* consolidate("acct_1", [signal("s2", "love the pup")]).pipe(
        Effect.provide(recorder.layer),
        Effect.provide(makeStubConsolidator(judge)),
      );

      expect(second.beliefs[0]!.supportingSignalIds).toEqual(["s1", "s2"]);
      expect(second.beliefs[0]!.confidence).toBeCloseTo(0.51); // 0.3 + (1-0.3)*0.3
      expect(second.themes[0]!.signalCount).toBe(2);
    }),
  );

  it.effect("merges same-batch signals onto one belief", () =>
    Effect.gen(function* () {
      const recorder = makeMemoryRecorder();
      const judge = fixed({
        kind: "audience",
        salience: 0.6,
        relation: "novel",
        beliefStatement: "dogs delight customers",
        themeName: "Dogs",
      });
      const result = yield* consolidate("acct_1", [
        signal("s1", "the dog"),
        signal("s2", "another dog"),
      ]).pipe(Effect.provide(recorder.layer), Effect.provide(makeStubConsolidator(judge)));

      expect(result.beliefs).toHaveLength(1);
      expect(result.beliefs[0]!.supportingSignalIds).toEqual(["s1", "s2"]);
    }),
  );

  it.effect("lowers confidence when a signal contradicts a held belief", () =>
    Effect.gen(function* () {
      const seeded: Belief = {
        accountId: "acct_1",
        statement: "service is fast",
        kind: "sentiment",
        confidence: 0.8,
        supportingSignalIds: ["s0"],
        firstSeenAt: 0,
        confidenceAsOf: 0,
        status: "active",
      };
      const recorder = makeMemoryRecorder({ beliefs: [seeded] });
      const judge = fixed({
        kind: "sentiment",
        salience: 0.6,
        relation: "contradicts",
        beliefStatement: "service is fast",
        themeName: "Service",
      });
      const result = yield* consolidate("acct_1", [signal("s1", "so slow today")]).pipe(
        Effect.provide(recorder.layer),
        Effect.provide(makeStubConsolidator(judge)),
      );

      const belief = result.beliefs.find((b) => b.statement === "service is fast")!;
      expect(belief.confidence).toBeCloseTo(0.4); // 0.8 * contradictionFactor(0.5)
      expect(belief.supportingSignalIds).toEqual(["s0"]); // contradiction adds no evidence
    }),
  );

  it.effect("routes distinct signals to distinct beliefs (model sees the signal text)", () =>
    Effect.gen(function* () {
      const recorder = makeMemoryRecorder();
      const result = yield* consolidate("acct_1", [
        signal("s1", "the dog is great"),
        signal("s2", "so slow today"),
      ]).pipe(Effect.provide(recorder.layer), Effect.provide(makeStubConsolidator(routeJudge)));

      expect(result.beliefs.map((b) => b.statement)).toEqual([
        "customers love dogs",
        "service can be slow",
      ]);
      expect(result.themes).toHaveLength(2);
    }),
  );

  it.effect("aborts without applying anything when the model fails", () =>
    Effect.gen(function* () {
      const recorder = makeMemoryRecorder();
      const exit = yield* consolidate("acct_1", [signal("s1", "x")]).pipe(
        Effect.provide(recorder.layer),
        Effect.provide(failingConsolidator),
        Effect.exit,
      );
      expect(exit._tag).toBe("Failure");
      expect(recorder.applied).toHaveLength(0); // nothing half-applied; signals stay pending
    }),
  );
});
