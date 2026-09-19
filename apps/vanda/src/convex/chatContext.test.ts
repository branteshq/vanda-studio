import { describe, expect, it } from "vitest";
import { compactHistory, type ModelMessage } from "./chatContext";

describe("historical model context", () => {
  it("retires old pixels without losing locators, review outcomes or tool pairs", () => {
    const history: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "imageId=original; não altere o rosto" },
          { type: "image", image: "https://example.com/original.png" },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "review",
            toolName: "inspect_image",
            input: { imageId: "draft" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "review",
            toolName: "inspect_image",
            output: {
              type: "content",
              value: [
                { type: "text", text: "imageId=draft" },
                { type: "image-url", url: "https://example.com/draft.png" },
              ],
            },
          },
        ],
      },
      { role: "assistant", content: "Texto cortado; precisa corrigir antes de entregar." },
      { role: "user", content: [{ type: "image", image: "https://example.com/current.png" }] },
    ];
    const original = structuredClone(history);
    const result = compactHistory(history, 4);

    expect(JSON.stringify(result)).not.toContain("https://example.com/original.png");
    expect(JSON.stringify(result)).not.toContain("https://example.com/draft.png");
    expect(JSON.stringify(result)).toContain("imageId=original; não altere o rosto");
    expect(JSON.stringify(result)).toContain("imageId=draft");
    expect(result[1]).toEqual(history[1]);
    expect(result[3]).toEqual(history[3]);
    expect(result[4]).toEqual(history[4]);
    expect(history).toEqual(original);
  });

  it("compacts legacy delegation envelopes and preserves data from unrelated tools", () => {
    const resource = { kind: "link", url: "https://example.com/post", title: "Rascunho" };
    const message: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "a",
          toolName: "ask_vanda",
          output: {
            type: "json",
            value: {
              data: { response: "não publicado", resources: [resource], presented: [resource] },
              resources: [resource],
              presented: [resource],
            },
          },
        },
      ],
    };
    expect(compactHistory([message])).toMatchObject([
      {
        content: [
          { output: { value: { data: { response: "não publicado" }, resources: [resource] } } },
        ],
      },
    ]);
    expect(JSON.stringify(compactHistory([message]))).not.toContain("presented");
    const part = message.content[0]!;
    if (part.type !== "tool-result") throw new Error("invalid fixture");
    const unrelated: ModelMessage = {
      role: "tool",
      content: [{ ...part, toolName: "other" }],
    };
    expect(compactHistory([unrelated])).toEqual([unrelated]);
  });
});
