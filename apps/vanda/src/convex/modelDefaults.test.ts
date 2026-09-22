import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODEX_ORCHESTRATOR_MODEL,
  DEFAULT_ORCHESTRATOR_MODEL,
  requireTextModel,
  resolveOrchestratorModel,
} from "./agentModels";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  CONECTADO_IMAGE_MODELS,
  resolveConnectedImageModel,
  isKnownImageModel,
  imageModelLabel,
  modelResolutions,
} from "./imageModels";

describe("model defaults", () => {
  it("offers GPT-6 Luna and Sol on both transports and Opus 5.5 only on OpenRouter", () => {
    for (const id of ["openai/gpt-6-luna", "openai/gpt-6-sol"]) {
      for (const conectado of [true, false]) {
        expect(requireTextModel(id, conectado).maker).toBe("OpenAI");
        expect(resolveOrchestratorModel(id, { conectado })).toBe(id);
      }
    }

    const opus = "anthropic/claude-opus-5.5";
    expect(requireTextModel(opus, false).maker).toBe("Anthropic");
    expect(resolveOrchestratorModel(opus, { conectado: false })).toBe(opus);
    expect(() => requireTextModel(opus, true)).toThrow("assinatura conectada");
    expect(resolveOrchestratorModel(opus, { conectado: true })).toBe(
      DEFAULT_CODEX_ORCHESTRATOR_MODEL,
    );
  });

  it("offers Astra on both text transports and all subscription image options", () => {
    for (const conectado of [true, false]) {
      expect(resolveOrchestratorModel("openai/gpt-6-astra", { conectado })).toBe(
        "openai/gpt-6-astra",
      );
    }

    expect(CONECTADO_IMAGE_MODELS.map((model) => model.id)).toEqual([
      "openai/gpt-image-2.5-flare",
      "openai/gpt-image-2.5-sunburst",
      "openai/gpt-image-2",
    ]);
    expect(resolveConnectedImageModel("openai/gpt-image-2")).toBe("openai/gpt-image-2");
    expect(resolveConnectedImageModel("openai/gpt-image-2.5-sunburst")).toBe(
      "openai/gpt-image-2.5-sunburst",
    );
    expect(resolveConnectedImageModel("google/gemini-3-pro-image")).toBe(DEFAULT_IMAGE_MODEL);
  });

  it("uses Opus 5 and GPT Image 2.5 Flare by default", () => {
    expect(DEFAULT_ORCHESTRATOR_MODEL).toBe("anthropic/claude-opus-5");
    expect(DEFAULT_IMAGE_MODEL).toBe("openai/gpt-image-2.5-flare");
    expect(resolveOrchestratorModel(undefined, { conectado: false })).toBe(
      DEFAULT_ORCHESTRATOR_MODEL,
    );
  });

  it("offers GPT Image 2 alongside both 2.5 variants in the shared picker catalog", () => {
    expect(isKnownImageModel("openai/gpt-image-2")).toBe(true);
    expect(imageModelLabel("openai/gpt-image-2")).toBe("GPT Image 2");
    expect(modelResolutions("openai/gpt-image-2")).toEqual(["1K"]);

    for (const id of ["openai/gpt-image-2.5-flare", "openai/gpt-image-2.5-sunburst"]) {
      expect(isKnownImageModel(id)).toBe(true);
      expect(IMAGE_MODELS.find((model) => model.id === id)?.label).toContain("GPT Image 2.5");
      expect(modelResolutions(id)).toEqual(["1K"]);
    }
  });

  it("keeps Conectado on a model its OpenAI transport can serve", () => {
    expect(DEFAULT_CODEX_ORCHESTRATOR_MODEL).toBe("openai/gpt-5.6-terra");
    expect(resolveOrchestratorModel(undefined, { conectado: true })).toBe(
      DEFAULT_CODEX_ORCHESTRATOR_MODEL,
    );
    expect(resolveOrchestratorModel("anthropic/claude-opus-5", { conectado: true })).toBe(
      DEFAULT_CODEX_ORCHESTRATOR_MODEL,
    );
  });
});
