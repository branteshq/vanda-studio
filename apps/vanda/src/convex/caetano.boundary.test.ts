// @vitest-environment edge-runtime
import { createThread, saveMessage } from "@convex-dev/agent";
import agentComponent from "@convex-dev/agent/test";
import { convertArrayToReadableStream, MockLanguageModelV3 } from "ai/test";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import { caetano, caetanoToolDiscovery } from "./caetanoAgent";
import { failedModelAttempt } from "./chatModel";
import { vanda, vandaToolDiscovery } from "./vanda";
import { capabilityResult } from "./resourceRefs";
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
  it("persists Muse for both agents on OpenRouter but not the ChatGPT transport", async () => {
    const { t, userId } = await setup();
    const owner = t.withIdentity({ subject: "ana" });
    const modelId = "meta/muse-spark-1.3-contributor";

    for (const mutation of [api.users.setCaetanoModel, api.users.setAgentModel]) {
      await owner.mutation(mutation, { modelId });
    }

    expect(await owner.query(api.users.modelPreferences)).toMatchObject({
      caetano: modelId,
      orchestrator: modelId,
      conectado: false,
    });
    expect(await t.query(internal.caetanoData.modelPreferences, { userId })).toMatchObject({
      caetano: modelId,
      orchestrator: modelId,
    });

    await t.run((ctx) =>
      ctx.db.patch(userId, { planId: "conectado", openaiAccessCiphertext: "test-token" }),
    );

    for (const mutation of [api.users.setCaetanoModel, api.users.setAgentModel]) {
      await expect(owner.mutation(mutation, { modelId })).rejects.toThrow("ChatGPT");
    }

    expect(await owner.query(api.users.modelPreferences)).toMatchObject({
      caetano: "openai/gpt-5.6-terra",
      orchestrator: "openai/gpt-5.6-terra",
      conectado: true,
    });
  });

  it("sends delegation locators once while retaining presentation metadata", async () => {
    const link = { kind: "link" as const, url: "https://example.com/draft", title: "Rascunho" };
    const other = { kind: "link" as const, url: "https://example.com/source", title: "Fonte" };

    const output = capabilityResult(
      { response: "Rascunho pronto; não publicado", threadId: "vanda-thread" },
      { resources: [link, other], presented: [link] },
    );

    const projected = await caetano.options.tools.ask_vanda.toModelOutput!({
      toolCallId: "delegation",
      input: { request: "Crie um rascunho" },
      output,
    });

    expect(projected).toEqual({
      type: "json",
      value: { data: output.data, resources: [link, other] },
    });
    expect(output.presented).toEqual([link]);
  });

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
              maxOutputTokens: 4096,
              system: expect.stringContaining("Café da Ana"),
              prepareStep: caetanoToolDiscovery.prepareStep,
            }),
            expect.objectContaining({
              saveStreamDeltas: true,
              contextHandler: expect.any(Function),
            }),
          );
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

  it("preserves the exact request and only its attachments through delegation", async () => {
    const { t, userId, accountId, foreignUserId } = await setup();
    const owner = t.withIdentity({ subject: "ana" });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["product-photo"])));

    const { imageId } = await owner.mutation(api.imageUploads.addImage, {
      accountId,
      storageId,
      mimeType: "image/png",
      width: 800,
      height: 600,
    });

    const original = "Troque SÓ o fundo. Preserve o rótulo ‘Café 42’, sem desconto e sem publicar.";

    const sent = await owner.mutation(api.caetano.sendMessage, {
      prompt: original,
      imageIds: [imageId],
    });

    const next = await owner.mutation(api.caetano.sendMessage, { prompt: "Explique os planos" });

    const delegated = await t.mutation(internal.caetanoData.prepareVandaTurn, {
      userId,
      request: "Melhore a foto",
      caetanoThreadId: sent.threadId,
      sourcePromptMessageId: sent.messageId,
    });

    const [message] = await t.run((ctx) =>
      ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: [delegated.promptMessageId],
      }),
    );

    expect(message?.text).toContain(original);
    expect(message?.text).toContain(`imageId=${imageId}`);
    expect(message?.text).toContain("Melhore a foto");
    expect(message?.message?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          image: await t.run((ctx) => ctx.storage.getUrl(storageId)),
        }),
      ]),
    );

    const textOnly = await t.mutation(internal.caetanoData.prepareVandaTurn, {
      userId,
      request: "Planos",
      caetanoThreadId: next.threadId,
      sourcePromptMessageId: next.messageId,
    });

    const [plain] = await t.run((ctx) =>
      ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: [textOnly.promptMessageId],
      }),
    );

    expect(plain?.text).toContain("Explique os planos");
    expect(plain?.text).not.toContain(imageId);
    expect(plain?.message?.content).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "image" })]),
    );

    await expect(
      t.mutation(internal.caetanoData.prepareVandaTurn, {
        userId: foreignUserId,
        request: "Use a foto",
        caetanoThreadId: sent.threadId,
        sourcePromptMessageId: sent.messageId,
        accountId: (await t.query(internal.caetanoData.listAccounts, { userId: foreignUserId }))[0]!
          .accountId,
      }),
    ).rejects.toThrow("mensagem de origem");

    const otherAccount = await t.run((ctx) =>
      ctx.db.insert("accounts", {
        ownerUserId: userId,
        name: "Outro negócio",
        onboardedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(
      t.mutation(internal.caetanoData.prepareVandaTurn, {
        userId,
        accountId: otherAccount,
        request: "Use a foto",
        caetanoThreadId: sent.threadId,
        sourcePromptMessageId: sent.messageId,
      }),
    ).rejects.toThrow("image not found");
  });

  it("includes brand facts, kit and preferences but not foreign data or the media archive", async () => {
    const { t, userId, accountId, foreignAccountId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("brandCanon", {
        accountId,
        kind: "restriction",
        text: "Não anunciar bebidas alcoólicas",
        confirmedByOwner: true,
        createdAt: 1,
      });
      await ctx.db.insert("brandCanon", {
        accountId,
        kind: "offer",
        text: "Hipótese ainda não confirmada",
        confirmedByOwner: false,
        createdAt: 1,
      });
    });
    await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/brand/notes.md",
      content: "Somente café de origem local",
    });
    await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/brand/kit.json",
      content: JSON.stringify({
        colors: [{ hex: "#123456", name: "azul" }],
        fonts: [],
        tagline: "Café com calma",
      }),
    });
    await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/memory/preferencias.md",
      content: "Nunca prometa entrega grátis",
    });
    await t.mutation(internal.workspaceData.write, {
      accountId: foreignAccountId,
      path: "/memory/segredo.md",
      content: "informação exclusiva da Bia",
    });
    await t.run((ctx) =>
      ctx.db.insert("images", {
        accountId,
        origin: "uploaded",
        purpose: "reference",
        externalUrl: "https://example.com/not-in-context.png",
        createdAt: 1,
      }),
    );
    const context = await t.query(internal.brandContext.conversation, { userId });

    for (const value of [
      "Café da Ana",
      "cafedaana",
      "Somente café de origem local",
      "#123456",
      "Café com calma",
      "Nunca prometa entrega grátis",
      "Não anunciar bebidas alcoólicas",
    ])
      expect(context).toContain(value);
    expect(context).not.toContain("Hipótese ainda não confirmada");
    expect(context).not.toContain("informação exclusiva da Bia");
    expect(context).not.toContain("not-in-context.png");
    await expect(
      t.query(internal.brandContext.conversation, { userId, accountId: foreignAccountId }),
    ).rejects.toThrow("conta não encontrada");
    await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/brand/notes.md",
      content: "Agora servimos chá também",
    });
    const refreshed = await t.query(internal.brandContext.conversation, { userId });
    expect(refreshed).toContain("Agora servimos chá também");
    expect(refreshed).not.toContain("Somente café de origem local");
    await t.run((ctx) => ctx.db.patch(userId, { activeAccountId: undefined }));
    expect(await t.query(internal.brandContext.conversation, { userId })).toContain(
      "Nenhum negócio ativo",
    );
  });

  it("passes brand context into a Vanda turn without model-driven retrieval", async () => {
    const { t, userId, accountId } = await setup();

    // Seed the delegation source without scheduling an unrelated live Caetano turn.
    const sent = await t.run(async (ctx) => {
      const threadId = await createThread(ctx, components.agent, { userId: `caetano:${userId}` });

      const { messageId } = await saveMessage(ctx, components.agent, {
        threadId,
        message: { role: "user", content: "Faça um post sem falar de desconto" },
      });

      return { threadId, messageId };
    });

    // A request can contain Caetano attempts before the delegated Vanda charge.
    await t.action((ctx) =>
      failedModelAttempt(ctx, {
        userId,
        threadId: sent.threadId,
        requestId: sent.messageId,
        model: "openai/gpt-5.6-terra",
        kind: "caetano_chat",
      }),
    );

    type VandaStreamResult = Awaited<ReturnType<typeof vanda.streamText>>;

    const result: Pick<VandaStreamResult, "consumeStream" | "text"> = {
      consumeStream: async () => {},
      text: Promise.resolve("Rascunho pronto"),
    };

    // SAFETY: generateResponse only consumes the stream and reads its text in this test.
    const stream = vi.spyOn(vanda, "streamText").mockResolvedValue(result as VandaStreamResult);

    try {
      const result = await t.action(internal.caetanoNode.askVanda, {
        userId,
        caetanoThreadId: sent.threadId,
        sourcePromptMessageId: sent.messageId,
        request: "Faça um post",
      });

      expect(result.response).toBe("Rascunho pronto");
      expect(stream.mock.calls[0]?.[0]).toMatchObject({ accountId });
      expect(stream.mock.calls[0]?.[2].system).toContain("Café da Ana");
      expect(stream.mock.calls[0]?.[2].maxOutputTokens).toBe(8192);
      expect(stream.mock.calls[0]?.[2].prepareStep).toBe(vandaToolDiscovery.prepareStep);
      const usageHandler = stream.mock.calls[0]![3]!.usageHandler!;
      await t.action(async (ctx) =>
        usageHandler(ctx, {
          userId: accountId,
          threadId: result.threadId,
          agentName: "vanda",
          model: "anthropic/claude-opus-5",
          provider: "openrouter.chat",
          providerMetadata: { openrouter: { usage: { cost: 0.01 } } },
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            totalTokens: 110,
            inputTokenDetails: { noCacheTokens: 50, cacheReadTokens: 50, cacheWriteTokens: 0 },
            outputTokenDetails: { textTokens: 10, reasoningTokens: 0 },
          },
        }),
      );

      const costs = await t.query(internal.usage.requestCosts, {
        userId,
        requestId: sent.messageId,
      });

      expect(costs.microUsd).toBe(10_000);
      expect(costs.events).toHaveLength(2);
      expect(costs.events.find((event) => event.kind === "chat")).toMatchObject({
        threadId: result.threadId,
        microUsd: 10_000,
      });

      const [message] = await t.run((ctx) =>
        ctx.runQuery(components.agent.messages.getMessagesByIds, {
          messageIds: [stream.mock.calls[0]![2].promptMessageId!],
        }),
      );

      expect(message?.text).toContain("Faça um post sem falar de desconto");
    } finally {
      stream.mockRestore();
    }
  });

  it.each([false, true])(
    "preserves ownership and resource recording after discovery (foreign=%s)",
    async (foreign) => {
      const { t, userId, accountId, foreignAccountId } = await setup();

      const secondAccountId = await t.run((ctx) =>
        ctx.db.insert("accounts", {
          ownerUserId: userId,
          name: "Padaria da Ana",
          onboardedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        }),
      );

      const target = foreign ? foreignAccountId : secondAccountId;

      const sent = await t
        .withIdentity({ subject: "ana" })
        .mutation(api.caetano.sendMessage, { prompt: "Troque de negócio" });

      const calls = [
        { name: "tool_search", input: { query: "select_account" } },
        { name: "select_account", input: { accountId: target } },
      ];

      let step = 0;

      const model = new MockLanguageModelV3({
        doStream: async () => {
          const next = calls[step++];

          return {
            stream: convertArrayToReadableStream([
              { type: "stream-start" as const, warnings: [] },
              ...(next
                ? [
                    {
                      type: "tool-call" as const,
                      toolCallId: `call-${step}`,
                      toolName: next.name,
                      input: JSON.stringify(next.input),
                    },
                  ]
                : []),
              {
                type: "finish" as const,
                finishReason: {
                  unified: next ? ("tool-calls" as const) : ("stop" as const),
                  raw: undefined,
                },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              },
            ]),
          };
        },
      });

      let steps: Awaited<StreamResult["steps"]> = [];

      await t.action(async (ctx) => {
        const result = await caetano.streamText(
          {
            ...ctx,
            ownerUserId: userId,
            caetanoThreadId: sent.threadId,
            sourcePromptMessageId: sent.messageId,
          },
          { threadId: sent.threadId },
          { promptMessageId: sent.messageId, model, prepareStep: caetanoToolDiscovery.prepareStep },
        );

        await result.consumeStream();

        steps = await result.steps;
      });

      expect(model.doStreamCalls).toHaveLength(3);
      expect(model.doStreamCalls[0]!.tools!.map((tool) => tool.name)).not.toContain(
        "select_account",
      );
      expect(model.doStreamCalls[1]!.tools!.map((tool) => tool.name)).toContain("select_account");
      expect((await t.run((ctx) => ctx.db.get(userId)))?.activeAccountId).toBe(
        foreign ? accountId : secondAccountId,
      );
      const manifests = await t.run((ctx) => ctx.db.query("threadResourceManifests").collect());

      if (foreign) {
        expect(steps.flatMap((step) => step.content)).toContainEqual(
          expect.objectContaining({ type: "tool-error", toolName: "select_account" }),
        );
        expect(manifests).toEqual([]);
      } else {
        expect(steps[1]!.toolResults).toContainEqual(
          expect.objectContaining({
            toolName: "select_account",
            output: expect.objectContaining({
              data: expect.objectContaining({
                accountId: secondAccountId,
                brandContext: expect.stringContaining("Padaria da Ana"),
              }),
            }),
          }),
        );
        expect(manifests).toContainEqual(
          expect.objectContaining({
            threadId: sent.threadId,
            toolCallId: "call-2",
            resources: [
              expect.objectContaining({ operation: "account.select", accountId: secondAccountId }),
            ],
          }),
        );
      }
    },
  );

  it("lets Caetano inspect owned images and rejects foreign images and accounts", async () => {
    const { t, userId, accountId, foreignAccountId } = await setup();

    const imageId = await t.run((ctx) =>
      ctx.db.insert("images", {
        accountId,
        origin: "generated",
        purpose: "post",
        externalUrl: "https://example.com/result.png",
        mimeType: "image/png",
        createdAt: 1,
      }),
    );

    expect(await t.query(internal.caetanoData.inspectImage, { userId, imageId })).toEqual({
      imageId,
      url: "https://example.com/result.png",
      mimeType: "image/png",
    });
    await expect(
      t.query(internal.caetanoData.inspectImage, {
        userId,
        accountId: foreignAccountId,
        imageId,
      }),
    ).rejects.toThrow("conta não encontrada");

    const foreignImage = await t.run((ctx) =>
      ctx.db.insert("images", {
        accountId: foreignAccountId,
        origin: "uploaded",
        purpose: "post",
        externalUrl: "https://example.com/foreign.png",
        createdAt: 1,
      }),
    );

    await expect(
      t.query(internal.caetanoData.inspectImage, { userId, imageId: foreignImage }),
    ).rejects.toThrow("image not found");
  });

  it("gives generated code images an exact readable locator instead of a guessed filename", async () => {
    const ctx = {
      accountId: "test-account",
      runAction: vi.fn().mockResolvedValue({
        ok: true,
        stdout: "",
        stderr: "",
        artifacts: [],
        images: [{ imageId: "image-123", name: "Peça com espaços", width: 1080, height: 1350 }],
      }),
    };

    const run = Object.assign({}, vanda.options.tools!.run_code, { ctx });

    const result = await run.execute(
      { code: "print('test')", description: "test" },
      { toolCallId: "code", messages: [] },
    );

    expect(result).toHaveProperty("data.images.0.path", "/images/image-123");
    expect(result).toHaveProperty("resources.0.imageId", "image-123");
  });

  it("returns image pixels to both agents instead of only JSON metadata", async () => {
    const image = {
      imageId: "test-image",
      url: "https://example.com/review.png",
      mimeType: "image/png",
    };

    const paint = Object.assign({}, vanda.options.tools!.paint, { ctx: {} });
    const inspect = Object.assign({}, caetano.options.tools!.inspect_image, { ctx: {} });

    const expected = {
      type: "content",
      value: [
        { type: "text", text: expect.stringContaining("imageId=test-image") },
        {
          type: "image-url",
          url: "https://example.com/review.png",
        },
      ],
    };

    expect(
      await paint.toModelOutput({
        toolCallId: "paint",
        input: {},
        output: capabilityResult(image),
      }),
    ).toEqual(expected);
    expect(
      await inspect.toModelOutput({ toolCallId: "inspect", input: {}, output: image }),
    ).toEqual(expected);
  });
});
