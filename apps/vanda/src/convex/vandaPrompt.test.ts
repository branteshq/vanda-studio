import { describe, expect, it } from "vitest";
import { systemPrompt } from "./vanda";

describe("Vanda routing prompt", () => {
  it("checks matching skills before falling back to paint", () => {
    const prompt = systemPrompt();

    const skillPriority = prompt.indexOf(
      "Uma habilidade aplicável tem precedência sobre os caminhos padrão abaixo.",
    );

    const paintFallback = prompt.indexOf("Arte nova sem habilidade aplicável:");

    expect(skillPriority).toBeGreaterThan(-1);
    expect(paintFallback).toBeGreaterThan(skillPriority);
    expect(prompt).toContain("Antes de agir, compare o pedido com todas as descrições.");
    expect(prompt).not.toContain("S04.py");
  });
});
