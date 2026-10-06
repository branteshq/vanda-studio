import { describe, expect, it } from "vitest";
import { brandFileFacts, factOrigin } from "./brandFileText";

describe("factOrigin", () => {
  it("splits each origin off the item's text", () => {
    expect(factOrigin("Sem gírias (dono)")).toEqual({
      text: "Sem gírias",
      origin: "dono",
      detail: null,
    });
    expect(factOrigin("Carrossel rende 3× (observado: 7 posts, 10/2026)")).toEqual({
      text: "Carrossel rende 3×",
      origin: "observado",
      detail: "7 posts, 10/2026",
    });
    expect(factOrigin("Tom leve (Vanda)").origin).toBe("vanda");
    expect(factOrigin("Sem origem")).toEqual({ text: "Sem origem", origin: null, detail: null });
  });
});

describe("brandFileFacts", () => {
  it("reads items under their section, skipping the legend", () => {
    const facts = brandFileFacts(
      "# Marca\n\n- legenda (dono)\n\n## Público\n\n- Empresas (dono)\n\n## Nunca fazer\n\n- Prometer prazo (dono)\n",
    );

    expect(facts.map((fact) => [fact.kind, fact.text])).toEqual([
      ["Público", "Empresas (dono)"],
      ["Nunca fazer", "Prometer prazo (dono)"],
    ]);
  });
});
