import { streamText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCode, errorMessage } from "../../errors";
import { codexChatModel, codexResponsesText } from "./codex";

afterEach(() => vi.unstubAllGlobals());

describe("ChatGPT public errors", () => {
  it.each([
    [429, "PROVIDER_LIMIT"],
    [401, "RECONNECT_REQUIRED"],
  ] as const)(
    "preserves the safe code for HTTP %i through the streaming SDK",
    async (status, code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("private provider diagnostic", { status })),
      );
      let error: unknown;

      const result = streamText({
        model: codexChatModel(
          { access: "test-only", accountId: "test-only" },
          "openai/gpt-5.6-terra",
        ),
        prompt: "Olá",
        maxRetries: 0,
        onError: (event) => {
          error = event.error;
        },
      });

      await result.consumeStream();
      expect(errorCode(error)).toBe(code);
      expect(errorMessage(error)).not.toContain("private provider diagnostic");
      await expect(
        codexResponsesText({
          auth: { access: "test-only", accountId: "test-only" },
          model: "openai/gpt-5.6-terra",
          system: "test",
          prompt: "Olá",
        }),
      ).rejects.toMatchObject({ data: { kind: "vanda-error", code } });
    },
  );
});
