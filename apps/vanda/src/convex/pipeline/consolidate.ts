import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import type { StoredSignal } from "./domain";
import { contradictBelief, decayBelief, reinforceBelief } from "./discernment";
import { type Belief, BeliefKind, type Theme, UnitInterval } from "./memory";
import { Memory, type ConsolidationResult, type MemorySnapshot } from "./memoryStore";

/** How a signal bears on a belief, as judged by the model. */
export const SignalRelation = Schema.Literals(["supports", "contradicts", "novel"]);
export type SignalRelation = typeof SignalRelation.Type;

/**
 * The model's perception of one signal: which belief it bears on (a canonical
 * statement — the EXACT wording of an existing belief when supporting or
 * contradicting it, else a fresh statement), how, plus the belief kind, an
 * importance score, and the recurring theme it belongs to. Bounded by the
 * schema so out-of-range output fails decoding rather than corrupting memory.
 * This is perception only; turning beliefs into posts is plan's job.
 */
export const SignalJudgment = Schema.Struct({
  kind: BeliefKind,
  salience: UnitInterval,
  relation: SignalRelation,
  beliefStatement: Schema.String,
  themeName: Schema.String,
});
export type SignalJudgment = typeof SignalJudgment.Type;

/**
 * Delimiter after which the signal text is appended verbatim. A test stub keys
 * on this to recover the signal, so prompt boilerplate above it (or the known
 * beliefs listed below) can change without affecting deterministic test
 * classification.
 */
export const SIGNAL_MARKER = "SIGNAL >>> ";

const judgePrompt = (signal: StoredSignal, beliefs: ReadonlyArray<Belief>): string => {
  const known =
    beliefs.length === 0
      ? "(none yet)"
      : beliefs.map((belief) => `- ${belief.statement}`).join("\n");
  return (
    `You maintain a small business's brand memory. Given a new signal and the ` +
    `beliefs already held, decide which belief the signal bears on.\n` +
    `Reuse a belief's EXACT wording when the signal supports or contradicts it; ` +
    `otherwise write one new concise belief statement. Also return its kind, an ` +
    `importance from 0 to 1, and a short recurring-theme name. Do not propose ` +
    `any post or action.\n\n` +
    `Known beliefs:\n${known}\n\n` +
    `${SIGNAL_MARKER}(${signal.source}) ${signal.text}`
  );
};

const JUDGE_CONCURRENCY = 4;

const normalize = (statement: string): string => statement.trim().toLowerCase();

interface JudgedSignal {
  readonly signal: StoredSignal;
  readonly judgment: SignalJudgment;
}

/**
 * Pure consolidation fold: decay every belief by elapsed time, then thread each
 * judgment into the belief/theme sets. Matching is by normalized statement, so
 * two signals in one batch that the model gives the SAME statement collapse onto
 * one belief, and a fresh belief created early in the batch can be reinforced
 * later by an identically-worded judgment. (The model judges each signal against
 * the snapshot only — it cannot see earlier same-batch creations — so signals it
 * words differently stay distinct.) Emits the full post-pass memory plus a
 * journal note — and, structurally, never a post idea.
 */
export const foldConsolidation = (
  accountId: string,
  snapshot: MemorySnapshot,
  entries: ReadonlyArray<JudgedSignal>,
  now: number,
): ConsolidationResult => {
  const { policy } = snapshot;
  let beliefs: ReadonlyArray<Belief> = snapshot.beliefs.map((belief) =>
    decayBelief(belief, now, policy),
  );
  let themes: ReadonlyArray<Theme> = snapshot.themes;
  let created = 0;
  let reinforced = 0;
  let contradicted = 0;

  for (const { signal, judgment } of entries) {
    const idx = beliefs.findIndex(
      (belief) => normalize(belief.statement) === normalize(judgment.beliefStatement),
    );

    if (idx >= 0) {
      const current = beliefs[idx]!;
      let updated: Belief;
      if (judgment.relation === "contradicts") {
        updated = contradictBelief(current, now, policy);
        contradicted += 1;
      } else {
        updated = reinforceBelief(current, signal.id, now, policy);
        reinforced += 1;
      }
      beliefs = beliefs.map((belief, k) => (k === idx ? updated : belief));
    } else if (judgment.relation !== "contradicts") {
      // A signal that contradicts a belief we don't hold changes nothing.
      const fresh: Belief = {
        accountId,
        statement: judgment.beliefStatement,
        kind: judgment.kind,
        confidence: 0,
        supportingSignalIds: [],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "retired",
      };
      beliefs = [...beliefs, reinforceBelief(fresh, signal.id, now, policy)];
      created += 1;
    }

    const themeIdx = themes.findIndex(
      (theme) => normalize(theme.name) === normalize(judgment.themeName),
    );
    if (themeIdx >= 0) {
      const current = themes[themeIdx]!;
      const bumped: Theme = { ...current, signalCount: current.signalCount + 1 };
      themes = themes.map((theme, k) => (k === themeIdx ? bumped : theme));
    } else {
      themes = [
        ...themes,
        {
          accountId,
          name: judgment.themeName,
          summary: judgment.beliefStatement,
          // Momentum needs windowed per-theme signal counts; recomputeMomentum
          // is wired when plan (Phase 5) tags signals by theme. New themes start steady.
          momentum: "steady",
          postCount: 0,
          signalCount: 1,
        },
      ];
    }
  }

  const note =
    `Consolidated ${entries.length} signal(s): ${created} new, ${reinforced} reinforced, ` +
    `${contradicted} contradicted. Tracking ${themes.length} theme(s).`;

  return {
    beliefs,
    themes,
    note,
    consumedSignals: entries.map((entry) => ({
      id: entry.signal.id,
      salience: entry.judgment.salience,
    })),
  };
};

/**
 * The consolidate stage: perceive a batch of new signals against current memory.
 * Loads the memory snapshot, asks the model how each signal bears on the held
 * beliefs (concurrently, each seeing only the snapshot), folds those judgments in
 * (pure), and writes the deltas. A model failure aborts the pass without applying
 * anything, so the signals stay unconsolidated and are retried on the next cycle.
 */
export const consolidate = Effect.fn("pipeline.consolidate")(function* (
  accountId: string,
  signals: ReadonlyArray<StoredSignal>,
) {
  const memory = yield* Memory;
  const snapshot = yield* memory.loadSnapshot(accountId);
  const entries = yield* Effect.forEach(
    signals,
    (signal) =>
      LanguageModel.generateObject({
        prompt: judgePrompt(signal, snapshot.beliefs),
        schema: SignalJudgment,
      }).pipe(Effect.map((response): JudgedSignal => ({ signal, judgment: response.value }))),
    { concurrency: JUDGE_CONCURRENCY },
  );
  const now = yield* Clock.currentTimeMillis;
  const result = foldConsolidation(accountId, snapshot, entries, now);
  yield* memory.apply(accountId, result);
  return result;
});
