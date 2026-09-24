import { describe, expect, it } from "vitest";
import { systemPrompt } from "./vanda";

describe("Vanda routing prompt", () => {
  it("checks matching skills before falling back to paint", () => {
    const prompt = systemPrompt();

    const skillPriority = prompt.indexOf(
      "Antes de escolher paint ou run_code, compare o formato pedido com as habilidades disponíveis.",
    );

    const paintFallback = prompt.indexOf("Arte nova sem habilidade aplicável:");

    expect(skillPriority).toBeGreaterThan(-1);
    expect(paintFallback).toBeGreaterThan(skillPriority);
    expect(prompt).toContain("mito x verdade");
    expect(prompt).toContain("mesmo sem mencionar ‘template’");
  });
});
