import * as fs from "node:fs";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import {
  type Cassette,
  type CassetteEntry,
  makeCassetteLanguageModel,
  makeRecordingLanguageModel,
} from "./cassette";
import { consolidate } from "./consolidate";
import { makeMemoryRecorder } from "./consolidate.testing";
import type { StoredSignal } from "./domain";
import { languageModelLayer } from "./liveModel";
import { plan } from "./plan";
import { makeSuggestionsRecorder } from "./plan.testing";

// VCR: replay the recorded cassette in CI (deterministic, fast, free). Re-record
// against the real model with `RECORD_CASSETTES=1 OPENROUTER_API_KEY=… vitest`.
const RECORD = process.env.RECORD_CASSETTES === "1";
const CASSETTE = path.join(import.meta.dirname, "cassettes", "golden-retriever.json");

const dogSignals: ReadonlyArray<StoredSignal> = [
  {
    id: "g1",
    source: "comments",
    text: "your golden retriever is the cutest, i come to this cafe just to see the dog",
    observedAt: 1,
  },
  {
    id: "g2",
    source: "comments",
    text: "please give the golden retriever a treat from me next time!",
    observedAt: 2,
  },
  {
    id: "g3",
    source: "mentions",
    text: "tagged you — the resident golden retriever totally made my day at the cafe",
    observedAt: 3,
  },
  {
    id: "g4",
    source: "comments",
    text: "the golden retriever at this cafe is adorable, bring him to the front more",
    observedAt: 4,
  },
];
describe("golden retriever — consolidate → plan executable spec", () => {
  it(
    "turns a stream of dog signals into a grounded dog-post suggestion",
    async () => {
      const sink: Array<CassetteEntry> = [];
      const lm = RECORD
        ? makeRecordingLanguageModel(sink)(languageModelLayer(process.env.OPENROUTER_API_KEY ?? ""))
        : makeCassetteLanguageModel(JSON.parse(fs.readFileSync(CASSETTE, "utf8")) as Cassette);

      const memory = makeMemoryRecorder({ mode: "auto" });
      const suggestions = makeSuggestionsRecorder();

      // Perception: each signal in its own pass, so cross-pass reinforcement accrues
      // evidence on the same belief (the model reuses the belief's wording).
      for (const signal of dogSignals) {
        await Effect.runPromise(
          consolidate("acct_golden", [signal]).pipe(
            Effect.provide(memory.layer),
            Effect.provide(lm),
          ),
        );
      }

      // Deliberation: plan proposes, critiques, and persists suggestions.
      await Effect.runPromise(
        plan("acct_golden").pipe(
          Effect.provide(memory.layer),
          Effect.provide(suggestions.layer),
          Effect.provide(lm),
        ),
      );

      if (RECORD) {
        fs.mkdirSync(path.dirname(CASSETTE), { recursive: true });
        fs.writeFileSync(CASSETTE, `${JSON.stringify(sink, null, 2)}\n`);
        return; // recording captured; assertions run deterministically on replay
      }

      // Perception accrued: cross-pass reinforcement built a well-evidenced belief
      // (>= minEvidence) from the stream of related signals.
      const evidenced = memory.snapshot().beliefs.find((b) => b.supportingSignalIds.length >= 3);
      expect(evidenced, "consolidate should form a well-evidenced belief").toBeDefined();

      // Deliberation produced a grounded suggestion whose provenance traces
      // idea → belief → the very signals we fed in (the golden-retriever thesis).
      const fromSignals = new Set(dogSignals.map((s) => s.id));
      const grounded = suggestions.saved.find(
        (s) =>
          s.beliefStatements.length > 0 &&
          s.signalIds.length > 0 &&
          s.signalIds.every((id) => fromSignals.has(id)),
      );
      expect(grounded, "a grounded, provenance-traced suggestion should be present").toBeDefined();
      expect(["approved", "needs_you", "suggestion", "rejected"]).toContain(grounded!.status);
    },
    RECORD ? 120_000 : 10_000,
  );
});
