import { createTool, type ToolCtx } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { agentIdentity, agentOwner, type AgentCtx } from "../agentContext";
import { recordCapabilityResult } from "../capabilityTools";
import { capabilityResult, capabilityResultSchema, type ThreadResource } from "../resourceRefs";

type ProductCtx = ToolCtx & AgentCtx;

type CapabilityOutput = z.infer<typeof capabilityResultSchema>;

type ModelPreferenceArgs = {
  userId: Id<"users">;
  orchestrator?: string;
  caetano?: string;
  image?: string;
};

const accountInput = z.object({ accountId: z.string().optional() });

export const productTools = {
  list_accounts: createTool({
    description: "Lista os negócios do dono e indica qual está ativo.",
    inputSchema: z.object({}),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: ProductCtx): Promise<CapabilityOutput> =>
      capabilityResult(
        await ctx.runQuery(internal.caetanoData.listAccounts, { userId: await agentOwner(ctx) }),
      ),
  }),
  select_account: createTool({
    description:
      "Troca o negócio ativo do dono. Em conversas vinculadas a uma conta, abra uma conversa da outra conta para trabalhar nela; não mistura negócios na mesma conversa de conta.",
    inputSchema: z.object({ accountId: z.string() }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: ProductCtx, { accountId }, options): Promise<CapabilityOutput> => {
      if (ctx.accountId && ctx.accountId !== accountId)
        throw new Error(
          "Esta conversa pertence a uma conta fixa. Abra uma conversa do outro negócio.",
        );
      // SAFETY: selectAccount checks account ownership and onboarding.
      const typedAccountId = accountId as Id<"accounts">;
      const args = { userId: await agentOwner(ctx), accountId: typedAccountId };
      await ctx.runMutation(internal.caetanoData.selectAccount, args);
      const brandContext = await ctx.runQuery(internal.brandContext.conversation, args);

      if (ctx.accountScope) ctx.accountScope.accountId = typedAccountId;

      const operation: ThreadResource = {
        kind: "operation",
        operation: "account.select",
        accountId: typedAccountId,
        status: "succeeded",
        label: "Negócio ativo atualizado",
      };

      return recordCapabilityResult(
        ctx,
        options,
        capabilityResult(
          {
            ok: true,
            accountId,
            brandContext,
          },
          { resources: [operation], presented: [operation] },
        ),
      );
    },
  }),
  account_status: createTool({
    description:
      "Consulta conexão do Instagram, onboarding, contexto de marca e links de uma conta. Não troca a conta usada pelas ferramentas.",
    inputSchema: accountInput,
    outputSchema: capabilityResultSchema,
    execute: async (ctx: ProductCtx, { accountId }): Promise<CapabilityOutput> => {
      const args = await agentIdentity(ctx, accountId);
      const status = await ctx.runQuery(internal.caetanoData.accountStatus, args);
      const brandContext = await ctx.runQuery(internal.brandContext.conversation, args);

      return capabilityResult({ ...status, brandContext });
    },
  }),
  usage_status: createTool({
    description: "Consulta o plano, percentual de uso e eventual bloqueio do dono.",
    inputSchema: z.object({}),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: ProductCtx): Promise<CapabilityOutput> =>
      capabilityResult(
        await ctx.runQuery(internal.caetanoData.usageStatus, { userId: await agentOwner(ctx) }),
      ),
  }),
  model_preferences: createTool({
    description: "Consulta os modelos atuais da Vanda, do Caetano e de imagem do dono.",
    inputSchema: z.object({}),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: ProductCtx): Promise<CapabilityOutput> =>
      capabilityResult(
        await ctx.runQuery(internal.caetanoData.modelPreferences, {
          userId: await agentOwner(ctx),
        }),
      ),
  }),
  set_model_preferences: createTool({
    description:
      "Altera modelos do dono: orchestrator para Vanda, caetano para Caetano (web e WhatsApp), image para imagens. Use ids do catálogo compatíveis com a conexão. Alterações valem no próximo turno.",
    inputSchema: z
      .object({
        orchestrator: z.string().optional(),
        caetano: z.string().optional(),
        image: z.string().optional(),
      })
      .refine((value) => Object.values(value).some((model) => model !== undefined), {
        message: "informe ao menos um modelo",
      }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: ProductCtx, input, options): Promise<CapabilityOutput> => {
      const args: ModelPreferenceArgs = { userId: await agentOwner(ctx) };

      if (input.orchestrator !== undefined) args.orchestrator = input.orchestrator;

      if (input.caetano !== undefined) args.caetano = input.caetano;

      if (input.image !== undefined) args.image = input.image;
      await ctx.runMutation(internal.caetanoData.setModelPreferences, args);

      const operation: ThreadResource = {
        kind: "operation",
        operation: "models.update",
        status: "succeeded",
        label: "Modelos atualizados",
      };

      return recordCapabilityResult(
        ctx,
        options,
        capabilityResult(
          { ok: true, ...input },
          {
            resources: [operation],
            presented: [operation],
          },
        ),
      );
    },
  }),
  list_vanda_threads: createTool({
    description: "Lista conversas recentes da Vanda para encontrar trabalho anterior.",
    inputSchema: accountInput,
    outputSchema: capabilityResultSchema,
    execute: async (ctx: ProductCtx, { accountId }): Promise<CapabilityOutput> =>
      capabilityResult(
        await ctx.runQuery(
          internal.caetanoData.listVandaThreads,
          await agentIdentity(ctx, accountId),
        ),
      ),
  }),
};
