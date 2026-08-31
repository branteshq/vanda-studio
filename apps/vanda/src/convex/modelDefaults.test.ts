import { describe, expect, it } from "vitest";
import {
  DEFAULT_CODEX_ORCHESTRATOR_MODEL,
  DEFAULT_ORCHESTRATOR_MODEL,
  resolveOrchestratorModel,
} from "./agentModels";
import { DEFAULT_IMAGE_MODEL } from "./imageModels";

describe("model defaults", () => {
  it("uses Opus 5 and GPT Image 2 by default", () => {
    expect(DEFAULT_ORCHESTRATOR_MODEL).toBe("anthropic/claude-opus-5");
    expect(DEFAULT_IMAGE_MODEL).toBe("openai/gpt-image-2");
    expect(resolveOrchestratorModel(undefined, { conectado: false })).toBe(
      DEFAULT_ORCHESTRATOR_MODEL,
    );
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
