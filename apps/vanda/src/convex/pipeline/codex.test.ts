import { streamText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { errorCode, errorMessage } from "../../errors";
import { codexChatModel, codexResponsesText, codexGenerateImage } from "./codex";

afterEach(() => vi.unstubAllGlobals());

describe("ChatGPT image models", () => {
  it.each(["flare", "sunburst"])("sends %s through subscription billing", async (variant) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [{ b64_json: "aGk=" }] }));

    vi.stubGlobal("fetch", request);

    const result = await codexGenerateImage({
      auth: { access: "test-only", accountId: "test-only" },
      model: `openai/gpt-image-2.5-${variant}`,
      prompt: "A flower",
      aspectRatio: "1:1",
    });

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toBe(
      "https://chatgpt.com/backend-api/codex/images/generations",
    );
    expect(JSON.parse(z.string().parse(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: `gpt-image-2.5-${variant}`,
    });
    expect(result.costUsd).toBe(0);
  });
});

describe("ChatGPT public errors", () => {
  it("does not send an output token cap to the subscription backend", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 400 }));
    vi.stubGlobal("fetch", request);

    const result = streamText({
      model: codexChatModel(
        { access: "test-only", accountId: "test-only" },
        "openai/gpt-5.6-terra",
      ),
      prompt: "Olá",
      maxRetries: 0,
      onError: () => {},
    });

    await result.consumeStream();
    expect(request).toHaveBeenCalledOnce();
    const encodedBody = z.string().parse(request.mock.calls[0]?.[1]?.body);
    const body: unknown = JSON.parse(encodedBody);
    expect(body).toMatchObject({ model: "gpt-5.6-terra", store: false });
    expect(body).not.toHaveProperty("max_output_tokens");
  });

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
