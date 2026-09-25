import { describe, expect, it } from "vitest";
import { caetano } from "./caetanoAgent";
import { systemPrompt, vanda } from "./vanda";

describe("Vanda routing prompt", () => {
  it.each(["vanda", "caetano"] as const)("routes %s to the image-only skill", (role) => {
    const prompt = systemPrompt(role);
    expect(prompt).toContain("leia /skills/creating-carousel-images/SKILL.md");
    expect(prompt).toContain("produção visual é exclusivamente por paint");
    expect(prompt).toContain("Antes de agir, compare o pedido com todas as descrições.");
    expect(prompt).not.toMatch(/run_code|\/templates|post-instagram-template|prompt-foto-fiel/);
  });

  it("does not expose code execution in either agent's tool catalog", () => {
    for (const agent of [vanda, caetano]) {
      expect(agent.options.tools).not.toHaveProperty("run_code");
      expect(agent.options.tools).toHaveProperty("paint");
    }
  });
});
