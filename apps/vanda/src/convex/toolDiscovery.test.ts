import { stepCountIs, streamText, tool, type JSONValue } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { caetano, caetanoToolDiscovery } from "./caetanoAgent";
import { vanda, vandaToolDiscovery } from "./vanda";
import { toolDiscovery } from "./toolDiscovery";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const call = (name: string, input: JSONValue, id = name) => ({
  stream: convertArrayToReadableStream([
    { type: "stream-start" as const, warnings: [] },
    { type: "tool-call" as const, toolCallId: id, toolName: name, input: JSON.stringify(input) },
    {
      type: "finish" as const,
      finishReason: { unified: "tool-calls" as const, raw: undefined },
      usage,
    },
  ]),
});

const done = () => ({
  stream: convertArrayToReadableStream([
    { type: "stream-start" as const, warnings: [] },
    { type: "text-start" as const, id: "text" },
    { type: "text-delta" as const, id: "text", delta: "Feito" },
    { type: "text-end" as const, id: "text" },
    { type: "finish" as const, finishReason: { unified: "stop" as const, raw: undefined }, usage },
  ]),
});

const modelTools = (model: MockLanguageModelV3, step: number) =>
  model.doStreamCalls[step]!.tools!.map((definition) => definition.name).sort();

const scriptedModel = (responses: Array<Awaited<ReturnType<MockLanguageModelV3["doStream"]>>>) => {
  let next = 0;

  return new MockLanguageModelV3({
    doStream: async () => {
      const response = responses[next++];

      if (!response) throw new Error("Unexpected model call");

      return response;
    },
  });
};

const setup = () => {
  const execute = vi.fn(async ({ value }: { value: string }) => ({ saved: value }));

  const tools = {
    read: tool({ inputSchema: z.object({}), execute: async () => "workspace" }),
    save: tool({
      description: "Save a preference",
      inputSchema: z.object({ value: z.string() }),
      execute,
      toModelOutput: ({ output }) => ({ type: "text", value: `Saved: ${output.saved}` }),
    }),
    metrics: tool({
      description: "Read analytics",
      inputSchema: z.object({}),
      execute: async () => ({ reach: 43 }),
    }),
  };

  const discovery = toolDiscovery(tools, {
    save: { keywords: "guardar preferência", effect: "write" },
    metrics: { keywords: "alcance", effect: "read" },
  });

  return { tools: { ...tools, tool_search: discovery.search }, discovery, execute };
};

describe("role-specific discovery", () => {
  it.each([
    {
      name: "Vanda",
      tools: vanda.options.tools!,
      discovery: vandaToolDiscovery,
      core: ["create_post", "list", "paint", "present", "read", "run_code", "tool_search", "write"],
      deferred: [
        "cancel_schedule",
        "delete_post",
        "read_instagram_comments",
        "read_instagram_metrics",
        "read_instagram_post",
        "read_instagram_posts",
        "read_instagram_profile",
        "schedule_post",
        "search_instagram_profiles",
      ],
    },
    {
      name: "Caetano",
      tools: caetano.options.tools!,
      discovery: caetanoToolDiscovery,
      core: ["account_status", "ask_vanda", "inspect_image", "present", "tool_search"],
      deferred: [
        "list_accounts",
        "list_vanda_threads",
        "model_preferences",
        "select_account",
        "set_model_preferences",
        "usage_status",
      ],
    },
  ])(
    "exposes only $name's core initially, then its own catalog",
    async ({ tools, discovery, core, deferred }) => {
      const model = scriptedModel([call("tool_search", { query: "*" }), done()]);

      const result = streamText({
        model,
        tools,
        prompt: "Quais ferramentas existem?",
        prepareStep: discovery.prepareStep,
        stopWhen: stepCountIs(3),
      });

      await result.consumeStream();

      expect(await result.text).toBe("Feito");
      expect(modelTools(model, 0)).toEqual(core);
      expect(modelTools(model, 1)).toEqual([...core, ...deferred].toSorted());
    },
  );

  it.each([
    ["vanda", "Quero pesquisar concorrentes", "search_instagram_profiles", "read"],
    ["vanda", "MÉTRICAS de alcance", "read_instagram_metrics", "read"],
    ["vanda", "reschedule", "schedule_post", "write"],
    ["vanda", "cancel_schedule", "cancel_schedule", "write"],
    ["caetano", "mudar de negócio", "select_account", "write"],
    ["caetano", "usage quota", "usage_status", "read"],
    ["caetano", "conversas anteriores", "list_vanda_threads", "read"],
    ["caetano", "model_preferences", "model_preferences", "read"],
  ] as const)("finds %s / %s", async (role, query, name, effect) => {
    const discovery = role === "vanda" ? vandaToolDiscovery : caetanoToolDiscovery;

    const result = await discovery.search.execute!(
      { query },
      { toolCallId: "search", messages: [] },
    );

    expect(result).toHaveProperty("tools.0", expect.objectContaining({ name, effect }));

    if (query === name) expect(result).toHaveProperty("tools.length", 1);
  });

  it.each([vandaToolDiscovery, caetanoToolDiscovery])(
    "reports no match without inventing tools",
    async (discovery) => {
      const result = await discovery.search.execute!(
        { query: "xyzzy" },
        { toolCallId: "search", messages: [] },
      );

      expect(result).toMatchObject({ tools: [], message: expect.stringContaining("'*'") });
    },
  );
});

describe("discovery execution", () => {
  it("loads typed tools, accumulates discoveries and preserves output conversion without executing searches", async () => {
    const { tools, discovery, execute } = setup();

    const model = scriptedModel([
      call("tool_search", { query: "guardar preferência" }, "search-save"),
      call("save", { value: "sem descontos" }),
      call("tool_search", { query: "alcance" }, "search-metrics"),
      done(),
    ]);

    const result = streamText({
      model,
      tools,
      prompt: "Guarde minha preferência",
      prepareStep: discovery.prepareStep,
      stopWhen: stepCountIs(5),
    });

    await result.consumeStream();

    expect(await result.text).toBe("Feito");
    expect(modelTools(model, 0)).toEqual(["read", "tool_search"]);
    expect(modelTools(model, 1)).toEqual(["read", "save", "tool_search"]);
    expect(modelTools(model, 2)).toEqual(["read", "save", "tool_search"]);
    expect(modelTools(model, 3)).toEqual(["metrics", "read", "save", "tool_search"]);
    expect(model.doStreamCalls[1]!.tools).toContainEqual(
      expect.objectContaining({
        name: "save",
        inputSchema: expect.objectContaining({ required: ["value"] }),
      }),
    );
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual({ value: "sem descontos" });
    expect(model.doStreamCalls[2]!.prompt).toContainEqual(
      expect.objectContaining({
        role: "tool",
        content: expect.arrayContaining([
          expect.objectContaining({
            toolName: "save",
            output: { type: "text", value: "Saved: sem descontos" },
          }),
        ]),
      }),
    );

    // The same discovery instance and old messages must not unlock a new turn.
    const freshModel = scriptedModel([done()]);

    const fresh = streamText({
      model: freshModel,
      tools,
      messages: [
        { role: "user", content: "Primeiro pedido" },
        ...(await result.response).messages,
        { role: "user", content: "Novo pedido" },
      ],
      prepareStep: discovery.prepareStep,
    });

    await fresh.consumeStream();
    expect(modelTools(freshModel, 0)).toEqual(["read", "tool_search"]);
  });

  it.each([false, true])(
    "does not execute invalid or undiscovered calls (searched=%s)",
    async (searched) => {
      const { tools, discovery, execute } = setup();

      const model = scriptedModel([
        ...(searched ? [call("tool_search", { query: "save" })] : []),
        call("save", searched ? { value: 123 } : { value: "not discovered" }),
        done(),
      ]);

      const result = streamText({
        model,
        tools,
        prompt: "test",
        prepareStep: discovery.prepareStep,
        stopWhen: stepCountIs(4),
      });

      await result.consumeStream();
      expect(await result.text).toBe("Feito");
      expect(execute).not.toHaveBeenCalled();
      expect(
        (await result.steps)
          .flatMap((step) => step.content)
          .some((part) => part.type === "tool-error"),
      ).toBe(true);
    },
  );
});
