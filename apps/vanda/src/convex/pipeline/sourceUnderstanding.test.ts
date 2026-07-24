import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { SourceEvidence } from "./sourceUnderstanding";

describe("SourceEvidence", () => {
  it("accepts timestamped multimodal evidence", () => {
    const evidence = Schema.decodeUnknownSync(SourceEvidence)({
      transcript: "",
      language: "pt-BR",
      transcriptConfidence: 0,
      contentType: "visual",
      visualDescription: "Uma demonstração visual sem fala.",
      visualConfidence: 0.9,
      frameEvidence: [
        {
          timestampMs: 0,
          description: "Produto sobre uma mesa.",
          onScreenText: "Antes",
        },
      ],
    });
    expect(evidence.contentType).toBe("visual");
    expect(evidence.frameEvidence[0]?.onScreenText).toBe("Antes");
  });

  it("rejects an unsupported content type", () => {
    expect(() =>
      Schema.decodeUnknownSync(SourceEvidence)({
        transcript: "texto",
        language: "pt-BR",
        transcriptConfidence: 1,
        contentType: "guess",
        visualDescription: "descrição",
        visualConfidence: 1,
        frameEvidence: [],
      }),
    ).toThrow();
  });
});
