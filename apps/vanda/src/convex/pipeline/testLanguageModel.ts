import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";

/**
 * A test `LanguageModel` whose `generateObject` returns `respond(prompt)`. The
 * pipeline only ever calls `generateObject`; `generateText`/`streamText` fail
 * loudly (deferred Effect/Stream failures) so a stage can't silently depend on
 * them.
 *
 * The single cast bridges our concrete `generateObject` to the provider's fully
 * generic `Service` signature — unavoidable for a double of a generic provider
 * interface, confined to test helpers.
 */
export const stubLanguageModelLayer = (respond: (prompt: string) => object) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (options) =>
        Effect.succeed([
          {
            type: "text",
            text: JSON.stringify(respond(JSON.stringify(options.prompt))),
          },
        ]),
      streamText: () => Stream.die("stub LanguageModel: streamText is not supported"),
    }),
  );
