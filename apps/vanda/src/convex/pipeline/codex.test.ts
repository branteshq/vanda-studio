import { streamText, tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { errorCode, errorMessage } from "../../errors";
import { codexChatModel, codexResponsesText, codexGenerateImage } from "./codex";
import { imageModelOutput } from "../messageImages";

afterEach(() => vi.unstubAllGlobals());

describe("ChatGPT image models", () => {
  it.each(["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])(
    "sends %s through subscription billing",
    async (model) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ data: [{ b64_json: "aGk=" }] }));

      vi.stubGlobal("fetch", request);

      const result = await codexGenerateImage({
        auth: { access: "test-only", accountId: "test-only" },
        model: `openai/${model}`,
        prompt: "A flower",
        aspectRatio: "1:1",
      });

      expect(request).toHaveBeenCalledOnce();
      expect(request.mock.calls[0]?.[0]).toBe(
        "https://chatgpt.com/backend-api/codex/images/generations",
      );
      expect(JSON.parse(z.string().parse(request.mock.calls[0]?.[1]?.body))).toMatchObject({
        model,
      });
      expect(result.costUsd).toBe(0);
    },
  );
});

describe("ChatGPT public errors", () => {
  it("sends image tool outputs as pixels on the actual Responses wire", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 400 }));
    vi.stubGlobal("fetch", request);
    const url = "https://example.com/fixture.png";

    const result = streamText({
      model: codexChatModel(
        { access: "test-only", accountId: "test-only" },
        "openai/gpt-5.6-terra",
      ),
      messages: [
        { role: "user", content: "Revise a imagem" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "inspect-1",
              toolName: "inspect_image",
              input: { imageId: "image-1" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "inspect-1",
              toolName: "inspect_image",
              output: imageModelOutput({ imageId: "image-1", url, mimeType: "image/png" }),
            },
          ],
        },
      ],
      maxRetries: 0,
      onError: () => {},
    });

    await result.consumeStream();
    const body: unknown = JSON.parse(z.string().parse(request.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      input: expect.arrayContaining([
        {
          type: "function_call_output",
          call_id: "inspect-1",
          output: [
            { type: "input_text", text: expect.stringContaining("imageId=image-1") },
            { type: "input_image", image_url: url },
          ],
        },
      ]),
    });
  });

  it("replays our tool_search as a function, not OpenAI native tool search", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 400 }));
    vi.stubGlobal("fetch", request);

    const result = streamText({
      model: codexChatModel(
        { access: "test-only", accountId: "test-only" },
        "openai/gpt-5.6-terra",
      ),
      tools: { tool_search: tool({ inputSchema: z.object({ query: z.string() }) }) },
      messages: [
        { role: "user", content: "Encontre ajuda do produto" },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "search-1",
              toolName: "tool_search",
              input: { query: "product_help" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "search-1",
              toolName: "tool_search",
              output: { type: "json", value: { tools: ["product_help"] } },
            },
          ],
        },
      ],
      maxRetries: 0,
      onError: () => {},
    });

    await result.consumeStream();
    const body: unknown = JSON.parse(z.string().parse(request.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      store: false,
      input: expect.arrayContaining([
        {
          type: "function_call",
          call_id: "search-1",
          name: "tool_search",
          arguments: '{"query":"product_help"}',
        },
        { type: "function_call_output", call_id: "search-1", output: '{"tools":["product_help"]}' },
      ]),
    });
  });

  it("does not send an output token cap to the subscription backend", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 400 }));
    vi.stubGlobal("fetch", request);

    const result = streamText({
      model: codexChatModel(
        { access: "test-only", accountId: "test-only" },
        "openai/gpt-5.6-terra",
      ),
      prompt: "Olá",
      maxOutputTokens: 8192,
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
