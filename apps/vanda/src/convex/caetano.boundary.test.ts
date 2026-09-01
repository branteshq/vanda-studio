// @vitest-environment edge-runtime
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  agentComponent.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Ana",
      email: "ana@example.com",
      clerkId: "ana",
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      name: "Café da Ana",
      handle: "cafedaana",
      publisherConnectedAt: now,
      onboardedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(userId, { activeAccountId: accountId });

    const foreignUserId = await ctx.db.insert("users", {
      name: "Bia",
      email: "bia@example.com",
      clerkId: "bia",
      createdAt: now,
      updatedAt: now,
    });
    const foreignAccountId = await ctx.db.insert("accounts", {
      ownerUserId: foreignUserId,
      name: "Loja da Bia",
      onboardedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, accountId, foreignUserId, foreignAccountId };
  });
  return { t, ...ids };
};

describe("Caetano control plane", () => {
  it("sees only the owner's accounts and refuses foreign selection", async () => {
    const { t, userId, accountId, foreignAccountId } = await setup();
    const accounts = await t.query(internal.caetanoData.listAccounts, { userId });
    expect(accounts).toEqual([
      expect.objectContaining({ accountId, name: "Café da Ana", active: true }),
    ]);
    await expect(
      t.mutation(internal.caetanoData.selectAccount, { userId, accountId: foreignAccountId }),
    ).rejects.toThrow("conta não encontrada");
  });

  it("creates and reuses one default Vanda thread for the active account", async () => {
    const { t, userId, accountId } = await setup();
    const first = await t.mutation(internal.caetanoData.prepareVandaTurn, {
      userId,
      request: "Crie um post para amanhã",
    });
    const second = await t.mutation(internal.caetanoData.prepareVandaTurn, {
      userId,
      request: "Agora ajuste a legenda",
    });
    expect(first.accountId).toBe(accountId);
    expect(second.threadId).toBe(first.threadId);

    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account?.caetanoVandaThreadId).toBe(first.threadId);
    const threads = await t.query(internal.caetanoData.listVandaThreads, { userId });
    expect(threads).toEqual([
      expect.objectContaining({ threadId: first.threadId, caetanoDefault: true }),
    ]);
    const activity = await t.run((ctx) =>
      ctx.db
        .query("chatThreadActivity")
        .withIndex("by_thread", (q) => q.eq("threadId", first.threadId))
        .collect(),
    );
    expect(activity).toHaveLength(2);
  });

  it("keeps one canonical user thread and exposes it through the public chat API", async () => {
    const { t } = await setup();
    const owner = t.withIdentity({ subject: "ana" });
    const sent = await owner.mutation(api.caetano.sendMessage, { prompt: "Oi, Caetano" });
    const state = await owner.query(api.caetano.state, {});
    expect(state.threadId).toBe(sent.threadId);
    expect(state.processing).toBe(true);

    const messages = await owner.query(api.caetano.listMessages, {
      threadId: sent.threadId,
      paginationOpts: { cursor: null, numItems: 20 },
    });
    expect(messages.page.some((message) => message.text === "Oi, Caetano")).toBe(true);

    await expect(
      owner.mutation(api.caetano.sendMessage, {
        threadId: sent.threadId,
        prompt: "Outra mensagem",
      }),
    ).rejects.toThrow("Caetano já está trabalhando");
    await owner.mutation(api.caetano.stopGeneration, { threadId: sent.threadId });
    expect((await owner.query(api.caetano.state, {})).processing).toBe(false);
  });
});
