// @vitest-environment edge-runtime
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { caetano } from "./caetanoAgent";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type StreamResult = Awaited<ReturnType<typeof caetano.streamText>>;

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
  it("persists a separate owner-scoped model, including on the ChatGPT plan", async () => {
    const { t, userId, foreignUserId } = await setup();
    const owner = t.withIdentity({ subject: "ana" });
    expect(await owner.query(api.users.modelPreferences)).toMatchObject({
      caetano: "openai/gpt-5.6-terra",
      orchestrator: "anthropic/claude-opus-5",
    });
    await t.run((ctx) =>
      ctx.db.patch(userId, { planId: "conectado", openaiAccessCiphertext: "test-token" }),
    );

    for (const mutation of [api.users.setCaetanoModel, api.users.setAgentModel]) {
      await expect(
        owner.mutation(mutation, { modelId: "anthropic/claude-opus-5" }),
      ).rejects.toThrow("ChatGPT");
    }

    for (const field of ["caetano", "orchestrator"] as const) {
      await expect(
        t.mutation(internal.caetanoData.setModelPreferences, {
          userId,
          [field]: "anthropic/claude-opus-5",
        }),
      ).rejects.toThrow("ChatGPT");
    }

    // Preferences saved before a plan change must resolve to a supported model.
    await t.run((ctx) => ctx.db.patch(userId, { caetanoModel: "anthropic/claude-opus-5" }));
    expect(await owner.query(api.users.modelPreferences)).toMatchObject({
      caetano: "openai/gpt-5.6-terra",
      orchestrator: "openai/gpt-5.6-terra",
      conectado: true,
    });
    expect(await t.query(internal.caetanoData.modelPreferences, { userId })).toMatchObject({
      caetano: "openai/gpt-5.6-terra",
    });
    expect((await t.run((ctx) => ctx.db.get(foreignUserId)))?.caetanoModel).toBeUndefined();
    await expect(owner.mutation(api.users.setCaetanoModel, { modelId: "unknown" })).rejects.toThrow(
      "modelo desconhecido",
    );
    await expect(
      t.mutation(api.users.setCaetanoModel, { modelId: "openai/gpt-5.6-sol" }),
    ).rejects.toThrow();
    await t.mutation(internal.caetanoData.setModelPreferences, {
      userId,
      caetano: "openai/gpt-5.6-sol",
    });
    expect((await owner.query(api.users.modelPreferences))?.caetano).toBe("openai/gpt-5.6-sol");
    await expect(
      t.mutation(internal.caetanoData.setModelPreferences, { userId, caetano: "unknown" }),
    ).rejects.toThrow("modelo desconhecido");
    await t.run((ctx) => ctx.db.patch(userId, { caetanoModel: "retired/model" }));
    expect((await owner.query(api.users.modelPreferences))?.caetano).toBe("openai/gpt-5.6-terra");
    expect((await t.query(internal.caetanoData.modelPreferences, { userId })).caetano).toBe(
      "openai/gpt-5.6-terra",
    );
  });

  it.each([
    { channel: "web", connected: false },
    { channel: "whatsapp", connected: false },
    { channel: "web", connected: true },
    { channel: "whatsapp", connected: true },
  ] as const)(
    "routes each $channel turn with connected=$connected",
    async ({ channel, connected }) => {
      const { t, userId } = await setup();

      const streamResult: Partial<StreamResult> & Pick<StreamResult, "consumeStream" | "text"> = {
        consumeStream: async () => {},
        text: Promise.resolve("Feito"),
      };

      // SAFETY: generateResponse reads only consumeStream and text from this stream-result test double.
      const stream = vi
        .spyOn(caetano, "streamText")
        .mockResolvedValue(streamResult as StreamResult);

      try {
        if (connected) {
          vi.stubEnv("OPENAI_TOKEN_ENCRYPTION_KEY", "test-only-encryption-key");
          await t.action(internal.openaiSubNode.encryptAndStore, {
            clerkId: "ana",
            access: "test-access",
            refresh: "test-refresh",
            expiresAt: Date.now() + 3_600_000,
            accountId: "test-chatgpt-account",
          });
          await t.run(async (ctx) => {
            await ctx.db.patch(userId, { planId: "conectado" });
            await ctx.db.insert("usagePeriods", {
              userId,
              periodKey: "trial",
              spentMicroUsd: 1_000_000_000,
              updatedAt: Date.now(),
            });
          });
          expect((await t.query(internal.usage.budget, { userId })).ok).toBe(false);
          await t.withIdentity({ subject: "ana" }).mutation(api.caetano.sendMessage, {
            prompt: "Oi",
          });
        }

        for (const modelId of ["openai/gpt-5.6-sol", "anthropic/claude-sonnet-5"]) {
          // Exercise legacy preferences from before a subscription plan switch.
          await t.run((ctx) => ctx.db.patch(userId, { caetanoModel: modelId }));

          const turn = await t.run(async (ctx) => {
            const base = { userId, threadId: "test-thread", promptMessageId: "test-prompt" };

            const inboxId = await ctx.db.insert("caetanoInbox", {
              ...base,
              channel,
              status: "running",
            });

            const activityId = await ctx.db.insert("caetanoThreadActivity", {
              ...base,
              inboxId,
              startedAt: Date.now(),
            });

            return { ...base, activityId };
          });

          expect(await t.action(internal.caetano.generateResponse, turn)).toBe("Feito");
          expect(stream).toHaveBeenLastCalledWith(
            expect.objectContaining({ ownerUserId: userId }),
            { threadId: "test-thread" },
            expect.objectContaining({
              model: expect.objectContaining({
                modelId: connected
                  ? modelId.startsWith("openai/")
                    ? "gpt-5.6-sol"
                    : "gpt-5.6-terra"
                  : modelId,
                provider: connected ? "openai.responses" : expect.stringContaining("openrouter"),
              }),
              promptMessageId: "test-prompt",
            }),
            { saveStreamDeltas: true },
          );
          expect(stream.mock.calls.at(-1)?.[2]).not.toHaveProperty("maxOutputTokens");
        }
      } finally {
        stream.mockRestore();
        vi.unstubAllEnvs();
      }
    },
  );

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
    ).resolves.toHaveProperty("threadId", sent.threadId);
    await owner.mutation(api.caetano.stopGeneration, { threadId: sent.threadId });
    expect((await owner.query(api.caetano.state, {})).processing).toBe(false);
  });

  it("accepts an owned image-only message and exposes the image in the transcript", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "ana" });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["image"])));

    const uploaded = await owner.mutation(api.imageUploads.addImage, {
      accountId,
      storageId,
      mimeType: "image/png",
      width: 800,
      height: 600,
    });

    const sent = await owner.mutation(api.caetano.sendMessage, {
      prompt: "",
      imageIds: [uploaded.imageId],
    });

    const messages = await owner.query(api.caetano.listMessages, {
      threadId: sent.threadId,
      paginationOpts: { cursor: null, numItems: 20 },
    });

    expect(
      messages.page.some((message) => message.parts.some((part) => part.type === "file")),
    ).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(uploaded.imageId)))?.lastAttachedAt).toEqual(
      expect.any(Number),
    );
  });

  it("refuses an image from another account", async () => {
    const { t, foreignAccountId } = await setup();

    const foreignImageId = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["foreign-image"]));

      return ctx.db.insert("images", {
        accountId: foreignAccountId,
        origin: "uploaded",
        purpose: "post",
        storageId,
        mimeType: "image/png",
        createdAt: Date.now(),
      });
    });

    await expect(
      t.withIdentity({ subject: "ana" }).mutation(api.caetano.sendMessage, {
        prompt: "descreva",
        imageIds: [foreignImageId],
      }),
    ).rejects.toThrow("image not found");
  });
});
