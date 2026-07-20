import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import type { StoredSignal } from "./domain";
import { BrandContext, renderBrandContext } from "./brandContext";
import { contradictBelief, decayBelief, reinforceIndependentEvidence } from "./discernment";
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
  beliefKey: Schema.optionalKey(Schema.String),
  kind: BeliefKind,
  salience: UnitInterval,
  relation: SignalRelation,
  beliefStatement: Schema.String,
  themeName: Schema.String,
});
export type SignalJudgment = typeof SignalJudgment.Type;

export const SignalGroup = Schema.Struct({
  signalIds: Schema.Array(Schema.String),
  beliefKey: Schema.optionalKey(Schema.String),
  kind: BeliefKind,
  salience: UnitInterval,
  relation: SignalRelation,
  beliefStatement: Schema.String,
  themeName: Schema.String,
});

export const IgnoredSignal = Schema.Struct({
  signalId: Schema.String,
  reason: Schema.String,
});

export const BatchJudgment = Schema.Struct({
  groups: Schema.Array(SignalGroup),
  ignored: Schema.Array(IgnoredSignal),
});
export type BatchJudgment = typeof BatchJudgment.Type;

/**
 * Delimiter after which the signal text is appended verbatim. A test stub keys
 * on this to recover the signal, so prompt boilerplate above it (or the known
 * beliefs listed below) can change without affecting deterministic test
 * classification.
 */
export const SIGNAL_MARKER = "SIGNAL >>> ";

const judgePrompt = (
  signals: ReadonlyArray<StoredSignal>,
  beliefs: ReadonlyArray<Belief>,
  brandContext: string,
): string => {
  const known =
    beliefs.length === 0
      ? "(nenhuma ainda)"
      : beliefs
          .map((belief, index) => `- [${belief.key ?? `legacy:${index}`}] ${belief.statement}`)
          .join("\n");
  const observations = signals
    .map((signal) => {
      const context = [
        signal.mediaCaption ? `post: ${signal.mediaCaption}` : null,
        signal.mediaType ? `tipo: ${signal.mediaType}` : null,
        signal.authorHandle ? `autor: @${signal.authorHandle}` : null,
        signal.syncKind ? `origem: ${signal.syncKind}` : null,
      ]
        .filter((value): value is string => value !== null)
        .join(" | ");
      return `- [${signal.id}] (${signal.source}) ${signal.text}${context ? ` | ${context}` : ""}`;
    })
    .join("\n");
  return (
    `Você mantém a memória de marca de um pequeno negócio. Analise os sinais em conjunto, ` +
    `agrupando evidências semanticamente equivalentes em uma única crença útil e específica. ` +
    `Um grupo pode conter vários signalIds. Para uma crença existente, copie sua chave em ` +
    `beliefKey e preserve seu texto. Para uma crença nova, omita beliefKey. Classifique como ` +
    `ignored sinais vazios, genéricos, autorreferentes ou sem informação estratégica. Não ` +
    `transforme elogios vagos em conclusões genéricas. Escreva crenças, temas e motivos em ` +
    `português do Brasil. Não proponha posts nem ações.\n\n` +
    `Contexto confirmado da marca:\n${brandContext || "(não informado)"}\n\n` +
    `Crenças existentes:\n${known}\n\n` +
    `${SIGNAL_MARKER}\n${observations}`
  );
};

const normalize = (statement: string): string => statement.trim().toLowerCase();

export const evidenceKeyForSignal = (signal: StoredSignal): string => {
  const author = signal.authorHandle?.trim().toLocaleLowerCase("pt-BR");
  if (author !== undefined && signal.mediaExternalId !== undefined)
    return `author:${author}:media:${signal.mediaExternalId}`;
  if (author !== undefined) return `author:${author}`;
  // Meta can return a comment without its author even when the comment itself is
  // visible. The persisted signal is deduplicated by Instagram's comment id, so
  // it is the narrowest reliable evidence identity available in that case.
  return `signal:${signal.id}`;
};

interface JudgedSignal {
  readonly signal: StoredSignal;
  readonly judgment: SignalJudgment;
}

const compact = (text: string): string => text.normalize("NFKC").trim().replace(/\s+/g, " ");

const genericReactions = new Set([
  "adorei",
  "amei",
  "legal",
  "lindo",
  "linda",
  "show",
  "sim",
  "tb",
  "top",
  "toop",
  "que interessante",
]);

export const discardReason = (signal: StoredSignal, now: number): string | undefined => {
  const text = compact(signal.text);
  if (text.length === 0) return "sinal vazio";
  if (signal.isSelf === true) return "comentário da própria marca";
  if (signal.syncKind === "backfill" && now - signal.observedAt > 90 * 24 * 60 * 60 * 1000)
    return "fora da janela histórica de 90 dias";
  const words = text
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
  if (words.length === 0) return "reação sem texto";
  if (genericReactions.has(words.replace(/(.)\1{2,}/g, "$1"))) return "reação genérica";
  return undefined;
};

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
      (belief) =>
        (judgment.beliefKey !== undefined && belief.key === judgment.beliefKey) ||
        normalize(belief.statement) === normalize(judgment.beliefStatement),
    );

    if (idx >= 0) {
      const current = beliefs[idx]!;
      let updated: Belief;
      if (judgment.relation === "contradicts") {
        updated = contradictBelief(current, now, policy);
        contradicted += 1;
      } else {
        updated = reinforceIndependentEvidence(
          current,
          signal.id,
          evidenceKeyForSignal(signal),
          now,
          policy,
        );
        reinforced += 1;
      }
      const keyed =
        current.key === undefined && judgment.beliefKey !== undefined
          ? { ...updated, key: judgment.beliefKey }
          : updated;
      beliefs = beliefs.map((belief, k) => (k === idx ? keyed : belief));
    } else if (judgment.relation !== "contradicts") {
      // A signal that contradicts a belief we don't hold changes nothing.
      const fresh: Belief = {
        accountId,
        key: judgment.beliefKey ?? `belief:${signal.id}`,
        statement: judgment.beliefStatement,
        kind: judgment.kind,
        confidence: 0,
        supportingSignalIds: [],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "retired",
      };
      beliefs = [
        ...beliefs,
        reinforceIndependentEvidence(fresh, signal.id, evidenceKeyForSignal(signal), now, policy),
      ];
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
    `Consolidei ${entries.length} sinal(is): ${created} nova(s), ${reinforced} reforçada(s), ` +
    `${contradicted} contradita(s). Acompanhando ${themes.length} tema(s).`;

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
 * Loads the memory snapshot, asks the model to cluster the signal batch against held
 * beliefs, folds those judgments in
 * (pure), and writes the deltas. A model failure aborts the pass without applying
 * anything, so the signals stay unconsolidated and are retried on the next cycle.
 */
export const consolidate = Effect.fn("pipeline.consolidate")(function* (
  accountId: string,
  signals: ReadonlyArray<StoredSignal>,
) {
  const memory = yield* Memory;
  const brands = yield* BrandContext;
  const snapshot = yield* memory.loadSnapshot(accountId);
  const brand = yield* brands.load(accountId);
  const brandPrompt = renderBrandContext(brand);
  const now = yield* Clock.currentTimeMillis;
  const eligible: Array<StoredSignal> = [];
  const discarded: Array<{
    readonly id: string;
    readonly salience: number;
    readonly discardedReason: string;
  }> = [];
  for (const signal of signals) {
    const reason = discardReason(signal, now);
    if (reason === undefined) eligible.push({ ...signal, text: compact(signal.text) });
    else discarded.push({ id: signal.id, salience: 0, discardedReason: reason });
  }

  let entries: ReadonlyArray<JudgedSignal> = [];
  if (eligible.length > 0) {
    const response = yield* LanguageModel.generateObject({
      prompt: judgePrompt(eligible, snapshot.beliefs, brandPrompt),
      schema: BatchJudgment,
    });
    const byId = new Map(eligible.map((signal) => [signal.id, signal] as const));
    const seen = new Set<string>();
    const grouped: Array<JudgedSignal> = [];
    for (const group of response.value.groups) {
      for (const signalId of group.signalIds) {
        const signal = byId.get(signalId);
        if (signal === undefined || seen.has(signalId)) continue;
        seen.add(signalId);
        const { signalIds: _signalIds, ...judgment } = group;
        grouped.push({ signal, judgment });
      }
    }
    for (const ignored of response.value.ignored) {
      if (!byId.has(ignored.signalId) || seen.has(ignored.signalId)) continue;
      seen.add(ignored.signalId);
      discarded.push({ id: ignored.signalId, salience: 0, discardedReason: ignored.reason });
    }
    for (const signal of eligible) {
      if (!seen.has(signal.id))
        discarded.push({ id: signal.id, salience: 0, discardedReason: "modelo não classificou" });
    }
    entries = grouped;
  }

  const folded = foldConsolidation(accountId, snapshot, entries, now);
  const result: ConsolidationResult = {
    ...folded,
    note: `${folded.note} ${discarded.length} sinal(is) descartado(s).`,
    consumedSignals: [...folded.consumedSignals, ...discarded],
  };
  yield* memory.apply(accountId, result);
  return result;
});
