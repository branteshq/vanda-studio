import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { UsageHandler } from "@convex-dev/agent";
import { wrapLanguageModel } from "ai";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { modelCharge } from "./usageDetails";

export const failedModelAttempt = async (
  ctx: Parameters<UsageHandler>[0],
  turn: {
    kind: string;
    requestId: string;
    threadId: string;
    model: string;
    accountId?: Id<"accounts">;
    userId?: Id<"users">;
  },
) => {
  const { model, ...identity } = turn;
  await ctx.runMutation(internal.usage.charge, {
    ...identity,
    kind: `${turn.kind}_failed_attempt`,
    usd: 0,
    modelUsage: { model, provider: "openrouter", costSource: "unknown" },
  });
};

export const chatUsageHandler =
  (kind: "chat" | "caetano_chat", requestId?: string): UsageHandler =>
  async (ctx, { userId, threadId, usage, providerMetadata, model, provider }) => {
    if (!userId) return;
    const charge = { kind, ref: model, ...modelCharge(model, provider, usage, providerMetadata) };

    if (kind === "caetano_chat") {
      if (!userId.startsWith("caetano:")) return;
      // SAFETY: Caetano's authenticated thread owner is stored with this routing prefix.
      Object.assign(charge, { userId: userId.slice("caetano:".length) as Id<"users"> });
    } else {
      // SAFETY: Vanda's authenticated thread owner is an account id.
      Object.assign(charge, { accountId: userId as Id<"accounts"> });
    }

    if (requestId) Object.assign(charge, { requestId });

    if (threadId) Object.assign(charge, { threadId });
    await ctx.runMutation(internal.usage.charge, charge);
  };

/** Kept after reusable history, never inside the cached system/brand prefix. */
export const TURN_CONTEXT = "<current_turn_context>";

export const turnClock = () =>
  `${TURN_CONTEXT}\nAgora: ${new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "full",
    timeStyle: "short",
  })}. Fuso America/Sao_Paulo, UTC-03:00. Use offset -03:00 em datas ISO.\n</current_turn_context>`;

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "" });

export const openrouterChatModel = (modelId: string, onFailedAttempt?: () => Promise<void>) =>
  wrapLanguageModel({
    model: openrouter.chat(modelId, { usage: { include: true } }),
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ doGenerate }) => {
        try {
          return await doGenerate();
        } catch (error) {
          await onFailedAttempt?.();
          throw error;
        }
      },
      wrapStream: async ({ doStream }) => {
        try {
          return await doStream();
        } catch (error) {
          await onFailedAttempt?.();
          throw error;
        }
      },
      transformParams: async ({ params }) => {
        if (!modelId.startsWith("anthropic/")) return params;

        const clock = params.prompt.findIndex(
          (message) =>
            message.role === "user" &&
            message.content.some(
              (part) => part.type === "text" && part.text.startsWith(TURN_CONTEXT),
            ),
        );

        // Three breakpoints: brand/instructions, reusable history, growing tool loop.
        // Explicit markers work across Anthropic, Bedrock and Vertex via OpenRouter.
        const boundaries = new Set([0, params.prompt.length - 1]);

        if (clock > 0) boundaries.add(clock - 1);

        return {
          ...params,
          prompt: params.prompt.map((message, index) =>
            boundaries.has(index)
              ? {
                  ...message,
                  providerOptions: {
                    ...message.providerOptions,
                    openrouter: {
                      ...message.providerOptions?.openrouter,
                      cacheControl: { type: "ephemeral" },
                    },
                  },
                }
              : message,
          ),
        };
      },
    },
  });
