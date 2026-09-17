// @vitest-environment edge-runtime
import { createThread, listUIMessages, listStreams, saveMessage } from "@convex-dev/agent";
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const failureText = "Algo deu errado. Tente novamente em instantes.";

describe("agent generation failures", () => {
  it("clears broken references without blocking valid records in the same sweep", async () => {
    const t = convexTest(schema, modules);
    agentComponent.register(t);
    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", { createdAt: now, updatedAt: now });
      const rows = [];
      for (const kind of ["missing-prompt", "missing-thread", "foreign-thread", "valid"]) {
        const threadId = await createThread(ctx, components.agent, {
          userId: kind === "foreign-thread" ? "someone-else" : String(accountId),
        });
        const { messageId } = await saveMessage(ctx, components.agent, { threadId, prompt: kind });
        const activityId = await ctx.db.insert("chatThreadActivity", {
          accountId,
          threadId,
          promptMessageId: messageId,
          startedAt: now - 20 * 60_000,
        });
        if (kind === "missing-prompt")
          await ctx.runMutation(components.agent.messages.deleteByIds, { messageIds: [messageId] });
        rows.push({ kind, threadId, activityId });
      }
      return rows;
    });
    await t.action(components.agent.threads.deleteAllForThreadIdSync, {
      threadId: setup[1]!.threadId,
    });
    await t.mutation(internal.chat.expireStaleActivities, {});
    expect(await t.run((ctx) => ctx.db.query("chatThreadActivity").collect())).toEqual([]);
    for (const row of [setup[2]!, setup[3]!]) {
      const messages = await t.run((ctx) =>
        listUIMessages(ctx, components.agent, {
          threadId: row.threadId,
          paginationOpts: { cursor: null, numItems: 10 },
        }),
      );
      expect(messages.page.filter((message) => message.role === "assistant")).toHaveLength(
        row.kind === "valid" ? 1 : 0,
      );
    }
    await t.mutation(internal.chat.expireStaleActivities, {});
    expect(await t.run((ctx) => ctx.db.query("chatThreadActivity").collect())).toEqual([]);
  });

  it("leaves a visible message when a Vanda turn fails", async () => {
    const t = convexTest(schema, modules);
    agentComponent.register(t);
    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        clerkId: "owner",
        name: "Dono",
        email: "dono@example.com",
        createdAt: now,
        updatedAt: now,
      });
      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
      const threadId = await createThread(ctx, components.agent, {
        userId: String(accountId),
      });
      const { messageId } = await saveMessage(ctx, components.agent, { threadId, prompt: "Olá" });
      const activityId = await ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId,
        promptMessageId: messageId,
        startedAt: now,
      });
      return { accountId, threadId, activityId };
    });

    expect(await t.mutation(internal.chat.recordGenerationFailure, setup)).toBe(true);
    const messages = await t.run((ctx) =>
      listUIMessages(ctx, components.agent, {
        threadId: setup.threadId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    );
    expect(messages.page.at(-1)?.text).toContain(failureText);
    expect(await t.run((ctx) => ctx.db.get(setup.activityId))).toBeNull();
    expect(
      await t.mutation(internal.chat.expireThreadActivity, { activityId: setup.activityId }),
    ).toBe(false);
  });

  it("does not turn a user-requested stop into an error message", async () => {
    const t = convexTest(schema, modules);
    agentComponent.register(t);
    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        clerkId: "owner",
        name: "Dono",
        email: "dono@example.com",
      });
      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
      const threadId = await createThread(ctx, components.agent, {
        userId: String(accountId),
      });
      const activityId = await ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId,
        promptMessageId: "prompt",
        startedAt: now,
      });
      await ctx.db.delete(activityId);
      return { accountId, threadId, activityId };
    });

    expect(await t.mutation(internal.chat.recordGenerationFailure, setup)).toBe(false);
    const messages = await t.run((ctx) =>
      listUIMessages(ctx, components.agent, {
        threadId: setup.threadId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    );
    expect(messages.page).toHaveLength(0);
  });

  it("expires only the matching Vanda activity and persists safe timeout copy", async () => {
    const t = convexTest(schema, modules);
    agentComponent.register(t);
    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        clerkId: "owner",
        name: "Dono",
        email: "dono@example.com",
      });
      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
      const threadId = await createThread(ctx, components.agent, { userId: String(accountId) });
      const old = await saveMessage(ctx, components.agent, { threadId, prompt: "Primeiro pedido" });
      const oldId = await ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId,
        promptMessageId: old.messageId,
        startedAt: now - 15 * 60_000,
      });
      const newer = await saveMessage(ctx, components.agent, {
        threadId,
        prompt: "Segundo pedido",
      });
      const newerId = await ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId,
        promptMessageId: newer.messageId,
        startedAt: now - 15 * 60_000 + 60_000,
      });
      await ctx.runMutation(components.agent.streams.create, {
        threadId,
        order: 0,
        stepOrder: 1,
        format: "UIMessageChunk",
      });
      await ctx.runMutation(components.agent.streams.create, {
        threadId,
        order: 1,
        stepOrder: 1,
        format: "UIMessageChunk",
      });
      return { oldId, newerId, threadId };
    });
    await t.mutation(internal.chat.expireStaleActivities, {});
    expect(await t.run((ctx) => ctx.db.get(setup.oldId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(setup.newerId))).not.toBeNull();
    const messages = await t.run((ctx) =>
      listUIMessages(ctx, components.agent, {
        threadId: setup.threadId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    );
    expect(messages.page.find((message) => message.role === "assistant")?.text).toBe(
      "Não foi possível concluir a tempo. Seu pedido foi salvo; tente novamente.",
    );
    expect(messages.page.find((message) => message.role === "assistant")?.order).toBe(0);
    const streams = await t.run((ctx) =>
      listStreams(ctx, components.agent, {
        threadId: setup.threadId,
        includeStatuses: ["streaming", "aborted"],
      }),
    );
    expect(streams.find((stream) => stream.order === 0)?.status).toBe("aborted");
    expect(streams.find((stream) => stream.order === 1)?.status).toBe("streaming");
    expect(await t.mutation(internal.chat.expireThreadActivity, { activityId: setup.oldId })).toBe(
      false,
    );
  });

  it.each(["failure", "timeout"])("leaves a visible message for Caetano %s", async (kind) => {
    const t = convexTest(schema, modules);
    agentComponent.register(t);
    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        clerkId: "owner",
        name: "Dono",
        email: "dono@example.com",
      });
      const threadId = await createThread(ctx, components.agent, {
        userId: `caetano:${userId}`,
      });
      const { messageId } = await saveMessage(ctx, components.agent, { threadId, prompt: "Olá" });
      const activityId = await ctx.db.insert("caetanoThreadActivity", {
        userId,
        threadId,
        promptMessageId: messageId,
        startedAt: now,
      });
      return { userId, threadId, activityId };
    });

    expect(
      kind === "failure"
        ? await t.mutation(internal.caetano.recordGenerationFailure, setup)
        : await t.mutation(internal.caetano.expireTurn, { activityId: setup.activityId }),
    ).toBe(true);
    const messages = await t.run((ctx) =>
      listUIMessages(ctx, components.agent, {
        threadId: setup.threadId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    );
    expect(messages.page.at(-1)?.text).toBe(
      kind === "failure"
        ? failureText
        : "Não foi possível concluir a tempo. Seu pedido foi salvo; tente novamente.",
    );
    expect(await t.run((ctx) => ctx.db.get(setup.activityId))).toBeNull();
    expect(await t.mutation(internal.caetano.expireTurn, { activityId: setup.activityId })).toBe(
      false,
    );
  });
});
