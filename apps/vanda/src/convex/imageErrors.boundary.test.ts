// @vitest-environment edge-runtime
import { createThread } from "@convex-dev/agent";
import agentComponent from "@convex-dev/agent/test";
import { MockLanguageModelV3 } from "ai/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Jimp } from "jimp";
import * as Effect from "effect/Effect";
import { ImageAssetGenerator, openRouterImageGeneratorLayer } from "./pipeline/imageGeneration";
import { errorMessage, errorCopy } from "../errors";
import { components, internal } from "./_generated/api";
import schema from "./schema";
import { vanda } from "./vanda";

const modules = import.meta.glob("./**/*.ts");

const secret = "sk-provider-private-fixture";

const privateUrl = "https://internal.example/private?token=secret-fixture";

const rejection = {
  error: {
    message: `No provider supports requested parameters. OpenAI: aspect_ratio: not supported. Accepted: 1:1, 3:4, 16:9, 9:16, auto, ${secret}, ${privateUrl}`,
    metadata: { authorization: secret, url: privateUrl },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function setup() {
  vi.stubEnv("OPENROUTER_API_KEY", secret);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  agentComponent.register(t);

  const accountId = await t.run((ctx) =>
    ctx.db.insert("accounts", { createdAt: Date.now(), updatedAt: Date.now() }),
  );

  return { t, accountId };
}

describe("image tool recovery errors", () => {
  it.each([
    ["openai/gpt-image-2.5-sunburst", undefined, "1024x1280"],
    ["openai/gpt-image-2.5-flare", "4:5", "1024x1280"],
    ["openai/gpt-image-2.5-sunburst", "3:4", undefined],
    ["openai/gpt-image-2.5-flare", "16:9", undefined],
    ["google/gemini-3.1-flash-image", "4:5", undefined],
  ])("serializes %s ratio %s without conflicting dimensions", async (model, aspectRatio, size) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [{ b64_json: "aGk=", media_type: "image/png" }] }));

    vi.stubGlobal("fetch", request);
    await Effect.runPromise(
      Effect.flatMap(ImageAssetGenerator, (generator) =>
        generator.generate({
          prompt: "portrait",
          aspectRatio,
          referenceUrls: ["https://example.com/reference.png"],
        }),
      ).pipe(Effect.provide(openRouterImageGeneratorLayer({ apiKey: secret, model: model! }))),
    );
    const payload = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(payload.size).toBe(size);
    expect(payload.aspect_ratio).toBe(size ? undefined : aspectRatio);
    expect(payload.resolution).toBeUndefined();
    expect(payload.input_references).toEqual([
      { type: "image_url", image_url: { url: "https://example.com/reference.png" } },
    ]);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each(["4:5", "3:4"])(
    "passes safe recovery for %s through the real agent tool loop and accepts a corrected ratio",
    async (aspectRatio) => {
      const { t, accountId } = await setup();

      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(rejection), { status: 400 }));

      vi.stubGlobal("fetch", fetchMock);
      let call = 0;

      const model = new MockLanguageModelV3({
        doGenerate: async () => ({
          content:
            call++ === 0
              ? [
                  {
                    type: "tool-call",
                    toolCallId: "paint-1",
                    toolName: "paint",
                    input: JSON.stringify({
                      prompt: "portrait",
                      name: "Portrait",
                      aspectRatio,
                    }),
                  },
                ]
              : [{ type: "text", text: "Vou corrigir a proporção solicitada." }],
          finishReason: { unified: call === 1 ? "tool-calls" : "stop", raw: undefined },
          usage: {
            inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 20, text: 20, reasoning: 0 },
          },
          warnings: [],
        }),
      });

      await t.action(async (ctx) => {
        const threadId = await createThread(ctx, components.agent, { userId: String(accountId) });
        await vanda.generateText(
          { ...ctx, accountId },
          { threadId },
          { prompt: "Create a portrait", model },
        );
      });
      expect(model.doGenerateCalls).toHaveLength(2);
      const transcript = JSON.stringify(model.doGenerateCalls[1]!.prompt);

      expect(transcript).toContain("unsupported_aspect_ratio");
      expect(transcript).toContain("retryableWithoutChanges");
      expect(transcript).toContain("3:4");
      expect(transcript).not.toContain(secret);
      expect(transcript).not.toContain(privateUrl);
      expect(transcript).not.toContain("No provider supports requested parameters");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // The corrected portrait must survive validation and storage unchanged.
      const portrait = await new Jimp({ width: 96, height: 128, color: 0xffffffff }).getBuffer(
        "image/png",
      );

      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                b64_json: Buffer.from(portrait).toString("base64"),
                media_type: "image/png",
              },
            ],
          }),
          { status: 200 },
        ),
      );

      const result = await t.action(internal.images.paint, {
        accountId,
        prompt: "portrait",
        aspectRatio: "3:4",
      });

      expect(result).toMatchObject({ width: 96, height: 128, mimeType: "image/png" });
      expect(JSON.parse(fetchMock.mock.calls[1]![1].body).aspect_ratio).toBe("3:4");
    },
  );

  it.each([
    [400, "invalid_image_request", false, "INVALID_INPUT"],
    [402, "image_provider_credit_limit", false, "UNAVAILABLE"],
    [403, "image_provider_access_denied", false, "UNAVAILABLE"],
    [429, "image_rate_limited", true, "UNAVAILABLE"],
    [503, "image_provider_unavailable", true, "UNAVAILABLE"],
  ] as const)(
    "classifies HTTP %s without exposing provider text to the agent or UI",
    async (status, error, retryableWithoutChanges, code) => {
      const { t, accountId } = await setup();

      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(`<html>${secret} ${privateUrl}</html>`, { status }));

      vi.stubGlobal("fetch", fetchMock);
      let caught: unknown;

      try {
        await t.action(internal.images.paint, {
          accountId,
          prompt: "portrait",
          aspectRatio: "4:5",
        });
      } catch (cause) {
        caught = cause;
      }

      expect(caught).toMatchObject({
        data: {
          kind: "vanda-error",
          code,
          recovery: { error, httpStatus: status, retryableWithoutChanges },
        },
      });
      expect(String(caught)).not.toContain(secret);
      expect(String(caught)).not.toContain(privateUrl);
      expect(errorMessage(caught)).toBe(errorCopy[code].message);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(await t.run((ctx) => ctx.db.query("images").collect())).toEqual([]);
    },
  );
});
