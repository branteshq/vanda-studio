import {
  createThread,
  getThreadMetadata,
  saveMessage,
  updateThreadMetadata,
} from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireTextModel, resolveCaetanoModel, resolveOrchestratorModel } from "./agentModels";
import {
  DEFAULT_IMAGE_MODEL,
  isKnownImageModel,
  isConnectedImageModel,
  resolveConnectedImageModel,
} from "./imageModels";
import { isConnectedSubscriber } from "./openaiSub";
import { budgetOf } from "./usage";
import { publicError } from "../errors";
import { messageWithImages, resolveMessageImages } from "./messageImages";

const accountThreadKey = (accountId: Id<"accounts">): string => String(accountId);

const ownedAccount = async (
  ctx: QueryCtx | MutationCtx,
  user: Doc<"users">,
  requested?: Id<"accounts"> | undefined,
): Promise<Doc<"accounts">> => {
  const accountId = requested ?? user.activeAccountId;

  if (!accountId) throw new Error("nenhuma conta ativa");
  const account = await ctx.db.get(accountId);

  if (!account || account.ownerUserId !== user._id) throw new Error("conta não encontrada");

  return account;
};

export const listAccounts = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
      .collect();

    const rows = accounts.map((account) => ({
      accountId: account._id,
      name: account.name ?? account.handle ?? "Novo negócio",
      handle: account.handle ?? null,
      connected: account.publisherConnectedAt !== undefined,
      onboarded: account.onboardedAt !== undefined,
      active: account._id === user.activeAccountId,
    }));

    const active = rows.find((account) => account.active);

    return active ? [active, ...rows.filter((account) => !account.active)] : rows;
  },
});

export const accountStatus = internalQuery({
  args: { userId: v.id("users"), accountId: v.optional(v.id("accounts")) },
  handler: async (ctx, { userId, accountId }) => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");
    const account = await ownedAccount(ctx, user, accountId);

    const facts = await ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();

    return {
      accountId: account._id,
      name: account.name ?? account.handle ?? "Novo negócio",
      handle: account.handle ?? null,
      instagramConnected: account.publisherConnectedAt !== undefined,
      onboardingComplete: account.onboardedAt !== undefined,
      brandFacts: facts.length,
      kind: account.kind ?? null,
      links: {
        conversation: "/conversa",
        gallery: "/galeria",
        calendar: "/calendario",
        profile: "/perfil",
      },
    };
  },
});

export const inspectImage = internalQuery({
  args: {
    userId: v.id("users"),
    accountId: v.optional(v.id("accounts")),
    imageId: v.id("images"),
  },
  handler: async (ctx, { userId, accountId, imageId }) => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");
    const account = await ownedAccount(ctx, user, accountId);
    const [image] = await resolveMessageImages(ctx, account._id, [imageId]);

    return image!;
  },
});

export const selectAccount = internalMutation({
  args: { userId: v.id("users"), accountId: v.id("accounts") },
  handler: async (ctx, { userId, accountId }): Promise<void> => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");
    const account = await ownedAccount(ctx, user, accountId);

    if (account.onboardedAt === undefined) throw new Error("conta ainda não concluiu o onboarding");
    await ctx.db.patch(userId, { activeAccountId: accountId, updatedAt: Date.now() });
  },
});

export const usageStatus = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");
    const state = await budgetOf(ctx, user);

    const usedPct =
      state.allowanceMicroUsd > 0
        ? Math.min(100, Math.round((state.spentMicroUsd / state.allowanceMicroUsd) * 100))
        : 100;

    return {
      plan: user.planId ?? "trial",
      usedPct,
      limited: !state.ok,
      renewsAt: user.billingPeriodEnd ?? null,
    };
  },
});

export const modelPreferences = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");
    const conectado = isConnectedSubscriber(user);

    return {
      orchestrator: resolveOrchestratorModel(user.orchestratorModel, { conectado }),
      caetano: resolveCaetanoModel(user.caetanoModel, { conectado }),
      image: conectado
        ? resolveConnectedImageModel(user.imageModel)
        : user.imageModel && isKnownImageModel(user.imageModel)
          ? user.imageModel
          : DEFAULT_IMAGE_MODEL,
      conectado,
    };
  },
});

interface ModelPreferencesPatch {
  orchestratorModel?: string;
  caetanoModel?: string;
  imageModel?: string;
  updatedAt: number;
}

export const setModelPreferences = internalMutation({
  args: {
    userId: v.id("users"),
    orchestrator: v.optional(v.string()),
    caetano: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, { userId, orchestrator, caetano, image }): Promise<void> => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");
    const conectado = isConnectedSubscriber(user);

    const patch: ModelPreferencesPatch = {
      updatedAt: Date.now(),
    };

    if (orchestrator !== undefined) {
      const selected = requireTextModel(orchestrator, conectado);

      patch.orchestratorModel = selected.id;
    }

    if (caetano !== undefined) {
      const selected = requireTextModel(caetano, conectado);
      patch.caetanoModel = selected.id;
    }

    if (image !== undefined) {
      if (!isKnownImageModel(image)) throw new Error("modelo de imagem desconhecido");

      if (conectado && !isConnectedImageModel(image))
        throw new Error("modelo indisponível pela assinatura do ChatGPT");
      patch.imageModel = image;
    }

    await ctx.db.patch(userId, patch);
  },
});

export const listVandaThreads = internalQuery({
  args: { userId: v.id("users"), accountId: v.optional(v.id("accounts")) },
  handler: async (ctx, { userId, accountId }) => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");
    const account = await ownedAccount(ctx, user, accountId);

    const threads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: accountThreadKey(account._id),
      order: "desc",
      paginationOpts: { cursor: null, numItems: 20 },
    });

    return threads.page
      .filter((thread) => thread.status === "active")
      .map((thread) => ({
        threadId: thread._id,
        title: thread.title ?? "Nova conversa",
        createdAt: thread._creationTime,
        caetanoDefault: thread._id === account.caetanoVandaThreadId,
        link: `/conversa?t=${encodeURIComponent(thread._id)}`,
      }));
  },
});

export interface PreparedVandaTurn {
  readonly accountId: Id<"accounts">;
  readonly threadId: string;
  readonly promptMessageId: string;
  readonly activityId: Id<"chatThreadActivity">;
}

export const prepareVandaTurn = internalMutation({
  args: {
    userId: v.id("users"),
    accountId: v.optional(v.id("accounts")),
    threadId: v.optional(v.string()),
    request: v.string(),
    sourcePromptMessageId: v.optional(v.string()),
    caetanoThreadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { userId, accountId, threadId, request, sourcePromptMessageId, caetanoThreadId },
  ): Promise<PreparedVandaTurn> => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");

    if (!isConnectedSubscriber(user) && !(await budgetOf(ctx, user)).ok)
      throw publicError("USAGE_LIMIT");
    const account = await ownedAccount(ctx, user, accountId);

    if (account.onboardedAt === undefined) throw new Error("conta ainda não concluiu o onboarding");

    let originalText = "";
    let images: Awaited<ReturnType<typeof resolveMessageImages>> = [];

    if (sourcePromptMessageId) {
      if (!caetanoThreadId) throw new Error("conversa de origem não informada");

      const sourceThread = await getThreadMetadata(ctx, components.agent, {
        threadId: caetanoThreadId,
      });

      const [source] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: [sourcePromptMessageId],
      });

      if (
        sourceThread.userId !== `caetano:${userId}` ||
        source?.threadId !== caetanoThreadId ||
        source.message?.role !== "user"
      )
        throw new Error("mensagem de origem não encontrada");
      originalText = source.text ?? "";

      const attachments = await ctx.db
        .query("threadResourceManifests")
        .withIndex("by_thread_tool", (q) =>
          q
            .eq("threadId", caetanoThreadId)
            .eq("toolCallId", `attachments:${sourcePromptMessageId}`),
        )
        .unique();

      images = await resolveMessageImages(
        ctx,
        account._id,
        (attachments?.resources ?? []).flatMap((resource) =>
          resource.kind === "image" ? [resource.imageId] : [],
        ),
      );
    }

    let target = threadId ?? account.caetanoVandaThreadId;

    if (target) {
      const meta = await getThreadMetadata(ctx, components.agent, { threadId: target }).catch(
        () => null,
      );

      if (!meta || meta.userId !== accountThreadKey(account._id) || meta.status !== "active") {
        if (threadId) throw new Error("conversa da Vanda não encontrada");
        target = undefined;
      }
    }

    if (!target) {
      target = await createThread(ctx, components.agent, { userId: accountThreadKey(account._id) });
      await updateThreadMetadata(ctx, components.agent, {
        threadId: target,
        patch: { title: `Caetano · ${account.name ?? account.handle ?? "Vanda"}`.slice(0, 80) },
      });
      await ctx.db.patch(account._id, { caetanoVandaThreadId: target, updatedAt: Date.now() });
    }

    const prompt = [
      ...(sourcePromptMessageId
        ? [`Mensagem original do dono (preservada pelo sistema):\n${originalText}`]
        : []),
      `Pedido e contexto adicional do Caetano:\n${request.trim()}`,
      "Preserve as restrições do pedido original. Crie rascunhos; não agende nem publique sem pedido explícito do dono. Revise o resultado antes de entregar e explique o estado final.",
    ].join("\n\n");

    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: target,
      message: { role: "user", content: messageWithImages(prompt, images) },
    });

    const activityId = await ctx.db.insert("chatThreadActivity", {
      accountId: account._id,
      threadId: target,
      promptMessageId: messageId,
      startedAt: Date.now(),
    });

    return { accountId: account._id, threadId: target, promptMessageId: messageId, activityId };
  },
});

export const setActiveVandaThread = internalMutation({
  args: { userId: v.id("users"), caetanoThreadId: v.string(), vandaThreadId: v.string() },
  handler: async (ctx, { userId, caetanoThreadId, vandaThreadId }): Promise<void> => {
    const rows = await ctx.db
      .query("caetanoThreadActivity")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const row = rows.find((candidate) => candidate.threadId === caetanoThreadId);

    if (row) await ctx.db.patch(row._id, { activeVandaThreadId: vandaThreadId });
  },
});
