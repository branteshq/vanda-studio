// @vitest-environment edge-runtime
import { createThread, listUIMessages } from "@convex-dev/agent";
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const failureText = "Não consegui concluir esta resposta por uma falha temporária";

describe("agent generation failures", () => {
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
      const activityId = await ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId,
        promptMessageId: "prompt",
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

  it("leaves a visible message when a Caetano turn fails", async () => {
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
      const activityId = await ctx.db.insert("caetanoThreadActivity", {
        userId,
        threadId,
        promptMessageId: "prompt",
        startedAt: now,
      });
      return { userId, threadId, activityId };
    });

    expect(await t.mutation(internal.caetano.recordGenerationFailure, setup)).toBe(true);
    const messages = await t.run((ctx) =>
      listUIMessages(ctx, components.agent, {
        threadId: setup.threadId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    );
    expect(messages.page.at(-1)?.text).toContain(failureText);
    expect(await t.run((ctx) => ctx.db.get(setup.activityId))).toBeNull();
  });
});
