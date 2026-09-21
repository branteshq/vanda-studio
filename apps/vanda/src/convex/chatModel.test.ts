import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateText } from "ai";
import { openrouterChatModel, TURN_CONTEXT } from "./chatModel";

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter prompt caching", () => {
  it("records a failed provider attempt before an SDK retry succeeds", async () => {
    let requests = 0;
    const failures = vi.fn(async () => {});
    vi.stubGlobal("fetch", async () => {
      if (++requests === 1)
        return Response.json({ error: { message: "busy", code: 503 } }, { status: 503 });

      return Response.json({
        id: "gen-retry",
        model: "anthropic/claude-opus-5",
        created: 1,
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 1,
          total_tokens: 101,
          cost: 0.001,
          prompt_tokens_details: { cached_tokens: 70, cache_write_tokens: 20 },
        },
      });
    });

    const result = await generateText({
      model: openrouterChatModel("anthropic/claude-opus-5", failures),
      prompt: "test",
      maxOutputTokens: 4096,
      maxRetries: 1,
    });

    expect(result.text).toBe("ok");
    expect(result.usage.inputTokenDetails).toMatchObject({
      cacheReadTokens: 70,
      cacheWriteTokens: 20,
    });
    expect(requests).toBe(2);
    expect(failures).toHaveBeenCalledTimes(1);
  });

  it.each(["anthropic/claude-opus-5", "openai/gpt-5.6-terra", "meta/muse-spark-1.3-contributor"])(
    "serializes cache boundaries only for Claude (%s)",
    async (modelId) => {
      const bodies: string[] = [];
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        bodies.push(z.string().parse(init.body));

        return Response.json({
          id: "gen-test",
          model: modelId,
          created: 1,
          choices: [
            { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 5000, completion_tokens: 1, total_tokens: 5001 },
        });
      });
      const model = openrouterChatModel(modelId);

      for (const time of ["12:00", "12:01"]) {
        await model.doGenerate({
          prompt: [
            { role: "system", content: "Instructions and complete brand knowledge" },
            { role: "user", content: [{ type: "text", text: "Keep the logo blue" }] },
            { role: "assistant", content: [{ type: "text", text: "Saved" }] },
            { role: "user", content: [{ type: "text", text: `${TURN_CONTEXT}${time}` }] },
            { role: "user", content: [{ type: "text", text: "Continue" }] },
          ],
          providerOptions: { openrouter: { session_id: "thread-1" } },
          maxOutputTokens: 4096,
        });
      }

      const schema = z.object({
        model: z.string(),
        messages: z.array(z.json()),
        session_id: z.string(),
        max_tokens: z.number(),
      });

      const first = schema.parse(JSON.parse(bodies[0]!));
      const second = schema.parse(JSON.parse(bodies[1]!));
      expect(first.model).toBe(modelId);
      expect(first.session_id).toBe("thread-1");
      expect(first.max_tokens).toBe(4096);
      expect(first.messages.slice(0, 3)).toEqual(second.messages.slice(0, 3));
      expect(first.messages[3]).not.toEqual(second.messages[3]);

      if (modelId.startsWith("anthropic/")) {
        expect(first.messages[0]).toMatchObject({
          content: [{ cache_control: { type: "ephemeral" } }],
        });
        expect(first.messages[2]).toMatchObject({ cache_control: { type: "ephemeral" } });
        expect(first.messages[4]).toMatchObject({
          content: [{ cache_control: { type: "ephemeral" } }],
        });
        expect((bodies[0]!.match(/cache_control/g) ?? []).length).toBe(3);
      } else {
        expect(bodies[0]).not.toContain("cache_control");
      }
    },
  );
});
