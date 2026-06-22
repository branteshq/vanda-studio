import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { makeMemoryRecorder } from "./consolidate.testing";
import type { AccountMode, Belief, Theme } from "./memory";
import { type Critique, type Idea, plan } from "./plan";
import { makePlannerStub, makeSuggestionsRecorder } from "./plan.testing";

const strongBelief = (statement: string): Belief => ({
  accountId: "acct_1",
  statement,
  kind: "audience",
  confidence: 0.7, // >= minConfidence 0.6
  supportingSignalIds: ["s1", "s2", "s3"], // >= minEvidence 3
  firstSeenAt: 0,
  confidenceAsOf: 0,
  status: "active",
});

const dogTheme: Theme = {
  accountId: "acct_1",
  name: "Dog content",
  summary: "the resident golden retriever",
  momentum: "rising",
  postCount: 0,
  signalCount: 5,
};

const DOG_STATEMENT = "customers love the resident golden retriever";

const dogIdea: Idea = {
  title: "Meet our resident golden retriever — winter edition",
  format: "feed",
  themeName: "Dog content",
  beliefStatements: [DOG_STATEMENT],
  rationale: "Customers consistently delight in the dog; ride the rising theme.",
};

const accept: Critique = { verdict: "accept", reason: "specific and on-brand", sensitive: false };

const run = (opts: {
  readonly mode?: AccountMode;
  readonly beliefs: ReadonlyArray<Belief>;
  readonly themes?: ReadonlyArray<Theme>;
  readonly ideas: ReadonlyArray<Idea>;
  readonly critique?: Critique;
}) =>
  Effect.gen(function* () {
    const memory = makeMemoryRecorder({
      beliefs: opts.beliefs,
      themes: opts.themes ?? [],
      mode: opts.mode ?? "auto",
    });
    const sink = makeSuggestionsRecorder();
    yield* plan("acct_1").pipe(
      Effect.provide(memory.layer),
      Effect.provide(sink.layer),
      Effect.provide(makePlannerStub(opts.ideas, () => opts.critique ?? accept)),
    );
    return sink.saved;
  });

describe("plan", () => {
  it.effect("turns a grounded idea into a suggestion with provenance + control status", () =>
    Effect.gen(function* () {
      const saved = yield* run({
        mode: "auto",
        beliefs: [strongBelief(DOG_STATEMENT)],
        themes: [dogTheme],
        ideas: [dogIdea],
      });
      expect(saved).toHaveLength(1);
      const s = saved[0]!;
      expect(s.status).toBe("approved"); // auto + not sensitive → greenlit, regenerable
      expect(s.requiresApproval).toBe(false);
      expect(s.title).toContain("golden retriever");
      expect(s.format).toBe("feed");
      expect(s.beliefStatements).toEqual([DOG_STATEMENT]);
      expect(s.signalIds).toEqual(["s1", "s2", "s3"]); // provenance from the cited belief
    }),
  );

  it.effect("needs_approval mode routes the suggestion to needs_you", () =>
    Effect.gen(function* () {
      const saved = yield* run({
        mode: "needs_approval",
        beliefs: [strongBelief(DOG_STATEMENT)],
        themes: [dogTheme],
        ideas: [dogIdea],
      });
      expect(saved[0]!.status).toBe("needs_you");
      expect(saved[0]!.requiresApproval).toBe(true);
    }),
  );

  it.effect("manual mode leaves the suggestion for the user", () =>
    Effect.gen(function* () {
      const saved = yield* run({
        mode: "manual",
        beliefs: [strongBelief(DOG_STATEMENT)],
        themes: [dogTheme],
        ideas: [dogIdea],
      });
      expect(saved[0]!.status).toBe("suggestion");
      expect(saved[0]!.requiresApproval).toBe(false);
    }),
  );

  it.effect("a sensitive idea needs approval even in auto mode", () =>
    Effect.gen(function* () {
      const saved = yield* run({
        mode: "auto",
        beliefs: [strongBelief(DOG_STATEMENT)],
        themes: [dogTheme],
        ideas: [dogIdea],
        critique: { verdict: "accept", reason: "touches a competitor", sensitive: true },
      });
      expect(saved[0]!.status).toBe("needs_you");
      expect(saved[0]!.requiresApproval).toBe(true);
    }),
  );

  it.effect("rejects (with a reason) an idea not grounded in any held belief", () =>
    Effect.gen(function* () {
      const saved = yield* run({
        beliefs: [strongBelief(DOG_STATEMENT)], // actionable, so ideate runs
        themes: [dogTheme],
        ideas: [{ ...dogIdea, beliefStatements: ["something we never believed"] }],
      });
      expect(saved).toHaveLength(1);
      expect(saved[0]!.status).toBe("rejected");
      expect(saved[0]!.rejectionReason).toContain("not grounded");
    }),
  );

  it.effect("rejects an idea whose theme is saturated (posted within the cadence window)", () =>
    Effect.gen(function* () {
      const saved = yield* run({
        beliefs: [strongBelief(DOG_STATEMENT)],
        themes: [{ ...dogTheme, lastPostedAt: 1 }], // posted at t=1; Clock is ~0 in tests → within window
        ideas: [dogIdea],
      });
      expect(saved[0]!.status).toBe("rejected");
      expect(saved[0]!.rejectionReason).toContain("cadence window");
    }),
  );

  it.effect("persists the critique's rejection with its reason", () =>
    Effect.gen(function* () {
      const saved = yield* run({
        beliefs: [strongBelief(DOG_STATEMENT)],
        themes: [dogTheme],
        ideas: [dogIdea],
        critique: { verdict: "reject", reason: "too generic to post", sensitive: false },
      });
      expect(saved[0]!.status).toBe("rejected");
      expect(saved[0]!.rejectionReason).toBe("too generic to post");
    }),
  );

  it.effect("suggests nothing when no belief meets the evidence threshold", () =>
    Effect.gen(function* () {
      const weak: Belief = { ...strongBelief(DOG_STATEMENT), confidence: 0.3, status: "decaying" };
      const saved = yield* run({ beliefs: [weak], themes: [dogTheme], ideas: [dogIdea] });
      expect(saved).toHaveLength(0);
    }),
  );
});
