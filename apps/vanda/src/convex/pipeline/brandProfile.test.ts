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

const analyze = (analyst: Parameters<typeof makeStubAnalyst>[0]) =>
  Effect.runPromise(proposeBrandProfile(corpus).pipe(Effect.provide(makeStubAnalyst(analyst))));

describe("proposeBrandProfile", () => {
  it("returns the model's structured text analysis", async () => {
    expect(await analyze(() => cafeLumiarAnalysis)).toEqual(cafeLumiarAnalysis);
  });

  it("feeds the profile, bio, captions, and comments into the prompt", async () => {
    let seen = "";
    await analyze((prompt) => {
      seen = prompt;

      return cafeLumiarAnalysis;
    });
    expect(seen).toContain("Café Lumiar");
    expect(seen).toContain("@cafelumiar");
    expect(seen).toContain("Bio: Cafeteria pet-friendly em Pinheiros");
    expect(seen).toContain("Total de publicações: 1248");
    expect(seen).toContain("Seguidores: 420");
    expect(seen).toContain("Alcance recente: 2400");
    expect(seen).toContain("Combo de inverno chegando");
    expect(seen).toContain("amo esse lugar");
    expect(seen).toContain("- audience:");
    expect(seen).toContain("- offers:");
  });
});
