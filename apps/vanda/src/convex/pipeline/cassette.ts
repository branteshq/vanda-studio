import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import { makeStubLanguageModel } from "./testLanguageModel";

/** One recorded LM exchange: the exact prompt and the structured value returned. */
export interface CassetteEntry {
  readonly prompt: string;
  readonly value: unknown;
}
export type Cassette = ReadonlyArray<CassetteEntry>;

const promptOf = (prompt: unknown): string =>
  typeof prompt === "string" ? prompt : JSON.stringify(prompt);

/**
 * Replay `LanguageModel`: returns the recorded value for each exact prompt. A
 * miss dies loudly (re-record with RECORD_CASSETTES=1) rather than fabricating
 * output — the VCR contract that keeps CI deterministic, fast, and free.
 */
export const makeCassetteLanguageModel = (cassette: Cassette) => {
  const byPrompt = new Map(cassette.map((entry) => [entry.prompt, entry.value] as const));
  return makeStubLanguageModel((prompt) => {
    if (!byPrompt.has(prompt)) {
      throw new Error(
        `cassette miss — re-record with RECORD_CASSETTES=1.\n--- prompt ---\n${prompt}`,
      );
    }
    return byPrompt.get(prompt);
  });
};

/**
 * Record `LanguageModel`: decorate a real LM layer so every `generateObject`
 * exchange is captured into `sink`, which is then serialized to a cassette file.
 */
export const makeRecordingLanguageModel =
  (sink: Array<CassetteEntry>) =>
  (realLM: Layer.Layer<LanguageModel.LanguageModel>): Layer.Layer<LanguageModel.LanguageModel> =>
    Layer.effect(
      LanguageModel.LanguageModel,
      Effect.map(LanguageModel.LanguageModel, (real) => {
        const realGen = real.generateObject.bind(real) as unknown as (o: {
          readonly prompt: unknown;
        }) => Effect.Effect<{ readonly value: unknown }>;
        const generateObject = (options: { readonly prompt: unknown }) =>
          realGen(options).pipe(
            Effect.tap((response) =>
              Effect.sync(() => {
                sink.push({ prompt: promptOf(options.prompt), value: response.value });
              }),
            ),
          );
        return { ...real, generateObject } as unknown as LanguageModel.Service;
      }),
    ).pipe(Layer.provide(realLM));
