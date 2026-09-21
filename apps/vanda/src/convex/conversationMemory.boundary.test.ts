// @vitest-environment edge-runtime
import { Agent, createThread, saveMessage, type ContextHandler } from "@convex-dev/agent";
import agentComponent from "@convex-dev/agent/test";
import { MockLanguageModelV3 } from "ai/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { components, internal } from "./_generated/api";
import {
  conversationContext,
  estimatedHistoryTokens,
  HISTORY_HIGH_WATER_TOKENS,
  summaryBoundary,
} from "./conversationContext";
import { type ModelMessage } from "./chatContext";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const emptyContext: Parameters<ContextHandler>[1] = {
  allMessages: [],
  search: [],
  recent: [],
  inputMessages: [],
  inputPrompt: [{ role: "user", content: "Continue corrigindo a logo, preserve o rosto" }],
  existingResponses: [],
  userId: undefined,
  threadId: undefined,
};

async function setup(turns: number, textSize: number, stalePending = false) {
  const t = convexTest(schema, modules);
  agentComponent.register(t);

  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Ana",
      email: "ana@example.com",
      clerkId: "ana",
    });

    const ownerKey = `caetano:${userId}`;
    const threadId = await createThread(ctx, components.agent, { userId: ownerKey });
    const prompts: string[] = [];
    const replies: string[] = [];

    for (let i = 0; i < turns; i++) {
      const { messageId } = await saveMessage(ctx, components.agent, {
        threadId,
        message: {
          role: "user",
          content: `Pedido ${i}. Nunca altere o rosto. ${"Detalhe. ".repeat(textSize)}`,
        },
      });

      prompts.push(messageId);

      if (stalePending && i === 2) {
        await saveMessage(ctx, components.agent, {
          threadId,
          promptMessageId: messageId,
          message: { role: "assistant", content: "" },
          metadata: { status: "pending" },
        });
      }

      const reply = await saveMessage(ctx, components.agent, {
        threadId,
        promptMessageId: messageId,
        message: {
          role: "assistant",
          content:
            stalePending && i === 2
              ? "Não foi possível concluir a tempo. Seu pedido foi salvo; tente novamente."
              : `Resultado ${i}; rascunho não publicado. Correção da logo pendente.`,
        },
      });

      replies.push(reply.messageId);
    }

    const current = await saveMessage(ctx, components.agent, {
      threadId,
      message: { role: "user", content: "Continue corrigindo a logo, preserve o rosto" },
    });

    return { userId, ownerKey, threadId, promptMessageId: current.messageId, prompts, replies };
  });

  return { t, ...ids };
}

function summarizer(truncated = false) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [
        {
          type: "text",
          text: "Fatos e restrições: nunca altere o rosto. Trabalho pendente: corrigir logo. Rascunho, sem autorização de publicação.",
        },
      ],
      finishReason: { unified: truncated ? "length" : "stop", raw: undefined },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 30, text: 30, reasoning: 0 },
      },
      warnings: [],
      providerMetadata: { openrouter: { usage: { cost: 0.001 } } },
    }),
  });
}

describe("durable conversation context", () => {
  it("assembles the real Agent request without duplicating the prompt or losing its system", async () => {
    const { t, ...turn } = await setup(3, 1);
    const model = summarizer();

    const agent = new Agent(components.agent, {
      name: "test",
      languageModel: model,
      instructions: "Stable brand",
    });

    await t.action(async (ctx) => {
      await agent.generateText(
        ctx,
        { threadId: turn.threadId },
        { promptMessageId: turn.promptMessageId },
        {
          contextOptions: { recentMessages: 0 },
          contextHandler: conversationContext("clock", { ...turn, summaryModel: model }),
        },
      );
    });
    const prompt = model.doGenerateCalls[0]!.prompt;
    expect(prompt[0]).toMatchObject({ role: "system", content: "Stable brand" });
    expect(JSON.stringify(prompt)).toContain("Pedido 0.");
    expect(JSON.stringify(prompt).match(/Continue corrigindo/g)).toHaveLength(1);
    expect(prompt.at(-2)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "clock" }],
    });
  });

  it("never crosses a pending exchange even beyond the retain budget", async () => {
    const { t, ...turn } = await setup(10, 1100);

    const rows = await t.run((ctx) =>
      ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: turn.prompts.flatMap((id, i) => [id, turn.replies[i]!]),
      }),
    );

    const history = rows.flatMap((row) => (row ? [row] : []));
    expect(summaryBoundary(history)).toBe(8);
    expect(
      summaryBoundary(
        history.map((row) => (row._id === turn.replies[2] ? { ...row, status: "pending" } : row)),
      ),
    ).toBe(2);
    expect(summaryBoundary(history.filter((row) => row._id !== turn.replies[3]))).toBe(3);
  });

  it("compacts past stale pending rows followed by a terminal response in the same turn", async () => {
    const { t, ...turn } = await setup(10, 1100, true);
    const model = summarizer();
    const context = conversationContext("clock", { ...turn, summaryModel: model });
    const messages = await t.action(async (ctx) => context(ctx, emptyContext));
    const checkpoints = await t.run((ctx) => ctx.db.query("conversationSummaries").collect());

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.throughOrder).toBe(7);
    expect(JSON.stringify(model.doGenerateCalls.map((call) => call.prompt))).toContain(
      "Não foi possível concluir a tempo",
    );
    expect(JSON.stringify(messages)).not.toContain("Pedido 0.");
    expect(JSON.stringify(messages)).toContain("Pedido 8.");
    expect(estimatedHistoryTokens(messages)).toBeLessThan(HISTORY_HIGH_WATER_TOKENS);

    const original = await t.run((ctx) =>
      ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
        threadId: turn.threadId,
        order: "asc",
        paginationOpts: { cursor: null, numItems: 100 },
      }),
    );

    expect(original.page.some((row) => row.order === 2 && row.status === "pending")).toBe(true);
    expect(original.page.some((row) => row.text?.includes("Pedido 0."))).toBe(true);
  });

  it("reads beyond 100 rows without sliding away the first exchange", async () => {
    const { t, ...turn } = await setup(55, 1);
    const model = summarizer();
    const context = conversationContext("clock", { ...turn, summaryModel: model });
    let messages: ModelMessage[] = [];
    await t.action(async (ctx) => {
      messages = await context(ctx, emptyContext);
    });
    expect(JSON.stringify(messages)).toContain("Pedido 0.");
    expect(JSON.stringify(messages)).toContain("Resultado 54");
    expect(messages.at(-1)).toMatchObject({
      role: "user",
      content: "Continue corrigindo a logo, preserve o rosto",
    });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it.each([false, true])(
    "checkpoints only complete summaries (truncated=%s)",
    async (truncated) => {
      const { t, ...turn } = await setup(10, 1100);
      const model = summarizer(truncated);
      const context = conversationContext("clock", { ...turn, summaryModel: model });
      let messages: ModelMessage[] = [];

      if (truncated) {
        await expect(t.action(async (ctx) => context(ctx, emptyContext))).rejects.toThrow(
          "UNAVAILABLE",
        );
      } else {
        messages = await t.action(async (ctx) => context(ctx, emptyContext));
      }

      const checkpoints = await t.run((ctx) => ctx.db.query("conversationSummaries").collect());
      expect(model.doGenerateCalls.length).toBeGreaterThan(0);
      expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).toContain("Nunca altere o rosto");

      if (truncated) {
        expect(checkpoints).toHaveLength(0);
      } else {
        expect(JSON.stringify(messages)).toContain("Pedido 8.");
        expect(JSON.stringify(messages)).toContain("Pedido 9.");
        expect(JSON.stringify(messages)).toContain("preserve o rosto");
        expect(checkpoints).toHaveLength(1);
        expect(checkpoints[0]!.throughOrder).toBe(7);
        expect(estimatedHistoryTokens(messages)).toBeLessThan(HISTORY_HIGH_WATER_TOKENS);
        expect(JSON.stringify(messages)).toContain("sem autorização de publicação");
        expect(JSON.stringify(messages)).not.toContain("Pedido 0.");
        const calls = model.doGenerateCalls.length;
        await t.action(async (ctx) => {
          expect(await context(ctx, emptyContext)).toEqual(messages);
        });
        expect(model.doGenerateCalls).toHaveLength(calls);

        const [original] = await t.run((ctx) =>
          ctx.runQuery(components.agent.messages.getMessagesByIds, {
            messageIds: [turn.prompts[0]!],
          }),
        );

        expect(original?.text).toContain("Pedido 0.");
      }
    },
  );

  it.each(["summary failure", "oversized recent turn", "pending turn"])(
    "never calls the primary model with oversized history after %s",
    async (failure) => {
      const { t, ...turn } = await setup(failure === "oversized recent turn" ? 1 : 10, 9000);
      const model = summarizer();

      const summaryModel = new MockLanguageModelV3({
        doGenerate: async () => {
          throw new Error("summary provider unavailable");
        },
      });

      if (failure === "pending turn") {
        await t.run((ctx) =>
          saveMessage(ctx, components.agent, {
            threadId: turn.threadId,
            promptMessageId: turn.prompts[0]!,
            message: { role: "assistant", content: "" },
            metadata: { status: "pending" },
          }),
        );
      }

      const agent = new Agent(components.agent, {
        name: "test",
        languageModel: model,
        instructions: "Stable brand",
      });

      await expect(
        t.action(async (ctx) => {
          await agent.generateText(
            ctx,
            { threadId: turn.threadId },
            { promptMessageId: turn.promptMessageId },
            {
              contextOptions: { recentMessages: 0 },
              contextHandler: conversationContext("clock", { ...turn, summaryModel }),
            },
          );
        }),
      ).rejects.toThrow("UNAVAILABLE");
      expect(model.doGenerateCalls).toHaveLength(0);
      expect(summaryModel.doGenerateCalls.length > 0).toBe(failure === "summary failure");
      expect(await t.run((ctx) => ctx.db.query("conversationSummaries").collect())).toEqual([]);

      const [original] = await t.run((ctx) =>
        ctx.runQuery(components.agent.messages.getMessagesByIds, {
          messageIds: [turn.prompts[0]!],
        }),
      );

      expect(original?.text).toContain("Pedido 0.");
    },
  );

  it("isolates checkpoints by owner and prompt boundary", async () => {
    const { t, ...turn } = await setup(4, 1);

    const identity = {
      threadId: turn.threadId,
      ownerKey: turn.ownerKey,
      promptMessageId: turn.promptMessageId,
    };

    await t.mutation(internal.conversationMemory.save, {
      ...identity,
      throughMessageId: turn.replies[2]!,
      summary: "Never change the face",
    });
    await expect(
      t.query(internal.conversationMemory.checkpoint, { ...identity, ownerKey: "someone-else" }),
    ).rejects.toThrow("conversa não encontrada");
    expect(
      (
        await t.query(internal.conversationMemory.checkpoint, {
          ...identity,
          promptMessageId: turn.prompts[1]!,
        })
      ).summary,
    ).toBeNull();
    await expect(
      t.mutation(internal.conversationMemory.save, {
        ...identity,
        throughMessageId: turn.promptMessageId,
        summary: "future",
      }),
    ).rejects.toThrow("invalid summary boundary");
  });
});
