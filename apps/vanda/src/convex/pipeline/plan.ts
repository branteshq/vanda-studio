import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import { isThemeSaturated, meetsEvidenceThreshold } from "./discernment";
import {
  type AccountMode,
  type Belief,
  PostType,
  type Suggestion,
  type SuggestionStatus,
  type Theme,
} from "./memory";
import { Memory, type MemorySnapshot } from "./memoryStore";
import { type PlanResult, Suggestions } from "./suggestions";

/** A candidate post idea the model proposes, grounded in held beliefs. */
export const Idea = Schema.Struct({
  title: Schema.String,
  /** A format hint; plan is format-agnostic (create decides), so the model may omit it. */
  format: Schema.optionalKey(PostType),
  themeName: Schema.String,
  /** The EXACT statements of the held beliefs this idea draws on (its provenance). */
  beliefStatements: Schema.Array(Schema.String),
  rationale: Schema.String,
});
export type Idea = typeof Idea.Type;

/** The ideate phase output (generateObject yields one object, so ideas are wrapped). */
export const Ideas = Schema.Struct({ ideas: Schema.Array(Idea) });

/** The critique phase's skeptical verdict on one idea, judged in fresh context. */
export const Critique = Schema.Struct({
  verdict: Schema.Literals(["accept", "reject"]),
  reason: Schema.String,
  /** Touches negative sentiment / a competitor / other risk → needs human approval. */
  sensitive: Schema.Boolean,
});
export type Critique = typeof Critique.Type;

const PLAN_CONCURRENCY = 4;

const normalize = (statement: string): string => statement.trim().toLowerCase();

const fmtPct = (n: number): string => `${Math.round(n * 100)}%`;

const ideatePrompt = (beliefs: ReadonlyArray<Belief>, themes: ReadonlyArray<Theme>): string => {
  const beliefLines = beliefs
    .map((b) => `- [${b.kind}] ${b.statement} (confidence ${fmtPct(b.confidence)})`)
    .join("\n");
  const themeLines =
    themes.length === 0 ? "(none)" : themes.map((t) => `- ${t.name} (${t.momentum})`).join("\n");
  return (
    `You are a brand's social-media strategist. From the well-evidenced beliefs ` +
    `below, propose up to 3 concrete Instagram post ideas this brand should make. ` +
    `Ground each idea in one or more of the listed beliefs (reuse their EXACT ` +
    `wording in beliefStatements), choose a format (feed, reel, story, tweet, ` +
    `image), name the theme it serves, and give a one-sentence rationale. Propose ` +
    `nothing that isn't supported by a listed belief.\n\n` +
    `Beliefs:\n${beliefLines}\n\nThemes:\n${themeLines}`
  );
};

const critiquePrompt = (idea: Idea): string =>
  `You are a skeptical editor reviewing ONE proposed Instagram post for a small ` +
  `business. Reject it if it is off-brand, generic, unsupported, or risky; accept ` +
  `only when it is specific and clearly worth posting. Flag it sensitive if it ` +
  `touches negative sentiment, a competitor, or anything needing owner sign-off.\n\n` +
  `Title: ${idea.title}\nTheme: ${idea.themeName}\n` +
  `Rationale: ${idea.rationale}`;

// --- Pure deliberation helpers --------------------------------------------

/** The held beliefs an idea names (by exact, normalized statement). */
const citedBeliefs = (idea: Idea, snapshot: MemorySnapshot): ReadonlyArray<Belief> =>
  idea.beliefStatements
    .map((statement) =>
      snapshot.beliefs.find((b) => normalize(b.statement) === normalize(statement)),
    )
    .filter((b): b is Belief => b !== undefined);

const provenanceSignals = (cited: ReadonlyArray<Belief>): ReadonlyArray<string> => [
  ...new Set(cited.flatMap((b) => b.supportingSignalIds)),
];

/**
 * The deterministic playbook gate, run before spending a critique call: an idea
 * must be grounded in an actionable belief and its theme must not be saturated.
 * Returns a rejection reason, or `undefined` when the idea passes.
 */
const gateIdea = (idea: Idea, snapshot: MemorySnapshot, now: number): string | undefined => {
  const cited = citedBeliefs(idea, snapshot);
  if (cited.length === 0) return "not grounded in any held belief";
  if (!cited.some((b) => meetsEvidenceThreshold(b, snapshot.policy)))
    return "grounding beliefs are below the evidence threshold";
  const theme = snapshot.themes.find((t) => normalize(t.name) === normalize(idea.themeName));
  if (theme !== undefined && isThemeSaturated(theme, now, snapshot.policy))
    return `theme "${theme.name}" was posted within the cadence window`;
  return undefined;
};

/** Initial control status from the account mode + the critique's sensitivity flag. */
const controlStatus = (
  mode: AccountMode,
  sensitive: boolean,
): { readonly status: SuggestionStatus; readonly requiresApproval: boolean } => {
  const requiresApproval = sensitive || mode === "needs_approval";
  const status: SuggestionStatus = requiresApproval
    ? "needs_you"
    : mode === "auto"
      ? "approved"
      : "suggestion";
  return { status, requiresApproval };
};

/** The fields every suggestion shares; the model's format hint is carried only when present. */
const baseSuggestion = (
  idea: Idea,
  snapshot: MemorySnapshot,
  accountId: string,
  now: number,
): Omit<Suggestion, "status" | "requiresApproval" | "rejectionReason"> => {
  const base = {
    accountId,
    title: idea.title,
    rationale: idea.rationale,
    themeName: idea.themeName,
    beliefStatements: idea.beliefStatements,
    signalIds: provenanceSignals(citedBeliefs(idea, snapshot)),
    createdAt: now,
  };
  return idea.format === undefined ? base : { ...base, format: idea.format };
};

const acceptedSuggestion = (
  idea: Idea,
  snapshot: MemorySnapshot,
  accountId: string,
  sensitive: boolean,
  now: number,
): Suggestion => ({
  ...baseSuggestion(idea, snapshot, accountId, now),
  ...controlStatus(snapshot.mode, sensitive),
});

const rejectedSuggestion = (
  idea: Idea,
  snapshot: MemorySnapshot,
  accountId: string,
  reason: string,
  now: number,
): Suggestion => ({
  ...baseSuggestion(idea, snapshot, accountId, now),
  status: "rejected",
  requiresApproval: false,
  rejectionReason: reason,
});

/**
 * The plan stage: deliberate over consolidated memory. Generate candidate ideas
 * from the well-evidenced beliefs (ideate), drop any that fail the deterministic
 * playbook gate, then put each survivor through a separate skeptical critique (so
 * the model isn't rationalizing its own ideas). Accepted ideas become suggestions
 * with a control status; rejected candidates are kept with a reason. Plan never
 * publishes — it only proposes.
 */
export const plan = Effect.fn("pipeline.plan")(function* (accountId: string) {
  const memory = yield* Memory;
  const suggestions = yield* Suggestions;
  const snapshot = yield* memory.loadSnapshot(accountId);
  const now = yield* Clock.currentTimeMillis;
  const actionable = snapshot.beliefs.filter((b) => meetsEvidenceThreshold(b, snapshot.policy));

  let drafts: ReadonlyArray<Suggestion> = [];
  if (actionable.length > 0) {
    const ideated = yield* LanguageModel.generateObject({
      prompt: ideatePrompt(actionable, snapshot.themes),
      schema: Ideas,
    });
    drafts = yield* Effect.forEach(
      ideated.value.ideas,
      (idea) =>
        Effect.gen(function* () {
          const rejection = gateIdea(idea, snapshot, now);
          if (rejection !== undefined)
            return rejectedSuggestion(idea, snapshot, accountId, rejection, now);
          const critique = yield* LanguageModel.generateObject({
            prompt: critiquePrompt(idea),
            schema: Critique,
          });
          return critique.value.verdict === "reject"
            ? rejectedSuggestion(idea, snapshot, accountId, critique.value.reason, now)
            : acceptedSuggestion(idea, snapshot, accountId, critique.value.sensitive, now);
        }),
      { concurrency: PLAN_CONCURRENCY },
    );
  }

  const result: PlanResult = { suggestions: drafts };
  yield* suggestions.save(accountId, result);
  return result;
});
