import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { BrandCorpus } from "./brand";
import { proposeBrandProfile } from "./brandProfile";
import { cafeLumiarAnalysis, makeStubAnalyst } from "./brandProfile.testing";

const corpus: BrandCorpus = {
  profile: {
    name: "Café Lumiar",
    username: "cafelumiar",
    biography: "Cafeteria pet-friendly em Pinheiros",
    accountType: "BUSINESS",
    mediaCount: 1248,
    followers: 420,
    reach: 2400,
    views: 3200,
  },
  captions: ["Combo de inverno chegando ☕️", "Nosso golden favorito de novo"],
  comments: ["amo esse lugar", "o cachorro é lindo demais"],
};

describe("proposeBrandProfile", () => {
  it("returns the model's structured analysis", async () => {
    const result = await Effect.runPromise(
      proposeBrandProfile(corpus).pipe(Effect.provide(makeStubAnalyst(() => cafeLumiarAnalysis))),
    );
    expect(result).toEqual(cafeLumiarAnalysis);
  });

  it("feeds the profile, captions, and comments into the prompt", async () => {
    let seen = "";
    await Effect.runPromise(
      proposeBrandProfile(corpus).pipe(
        Effect.provide(
          makeStubAnalyst((prompt) => {
            seen = prompt;
            return cafeLumiarAnalysis;
          }),
        ),
      ),
    );
    expect(seen).toContain("Café Lumiar");
    expect(seen).toContain("@cafelumiar");
    expect(seen).toContain("Total de publicações: 1248");
    expect(seen).toContain("Seguidores: 420");
    expect(seen).toContain("Alcance recente: 2400");
    expect(seen).toContain("Combo de inverno chegando");
    expect(seen).toContain("amo esse lugar");
  });
});
