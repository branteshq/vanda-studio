import { createTool, type ToolCtx } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { agentIdentity, agentOwner, type AgentCtx } from "../agentContext";
import { recordCapabilityResult } from "../capabilityTools";
import { capabilityResult, capabilityResultSchema, type ThreadResource } from "../resourceRefs";
import { findSetting } from "../settings/catalog";

type ProductCtx = ToolCtx & AgentCtx;

type CapabilityOutput = z.infer<typeof capabilityResultSchema>;

type SettingsGetArgs = { userId: Id<"users">; id?: string };

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
      const scope = ctx.accountScope;
      const previousSelection = scope?.selection;

      let selection!: Promise<unknown>;
      selection = (async () => {
        // Explicit selections are ordered, but a failed one must not prevent a later retry.
        if (previousSelection) await previousSelection.catch(() => undefined);

        const args = { userId: await agentOwner(ctx), accountId: typedAccountId };
        await ctx.runMutation(internal.caetanoData.selectAccount, args);
        const brandContext = await ctx.runQuery(internal.brandContext.conversation, args);

        // A newer selection owns the scope until it settles.
        if (scope?.selection === selection) scope.accountId = typedAccountId;

        return brandContext;
      })();

      // Register before yielding so subsequently-started account tools cannot observe the old scope.
      if (scope) scope.selection = selection;
      const brandContext = await selection;

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
  settings_get: createTool({
    description:
      "Lê as configurações da plataforma do dono: plano e uso, modelos da Vanda, do Caetano e de imagem, negócio ativo e negócios, conexões (Instagram, OpenAI, WhatsApp) e o piloto automático (se está ligado e a programação semanal). Sem id ou com '*', devolve todos os valores atuais de uma vez. Com um id, devolve descrição, onde fica no app, opções válidas e como mudar.",
    inputSchema: z.object({ id: z.string().optional() }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: ProductCtx, { id }): Promise<CapabilityOutput> => {
      const args: SettingsGetArgs = { userId: await agentOwner(ctx) };

      if (id) args.id = id;

      return capabilityResult(await ctx.runQuery(internal.settingsData.get, args));
    },
  }),
  settings_set: createTool({
    description:
      "Altera uma configuração alterável quando o dono pedir, pelo mesmo caminho do Perfil. value aceita o id ou o nome da opção (por exemplo 'GPT-6.1 Sol'); o piloto automático liga com autopilot.enabled = ligado/desligado e a cadência com autopilot.cadence = 'ter 18h carrossel 2; qui 18h imagem'. Devolve o valor anterior, para desfazer se o dono pedir. Plano, pagamento e conexões não são alteráveis por aqui: o resultado explica onde o dono muda.",
    inputSchema: z.object({ id: z.string(), value: z.string() }),
    outputSchema: capabilityResultSchema,
    execute: async (ctx: ProductCtx, { id, value }, options): Promise<CapabilityOutput> => {
      const result = await ctx.runMutation(internal.settingsData.set, {
        userId: await agentOwner(ctx),
        id,
        value,
      });

      const operation: ThreadResource = {
        kind: "operation",
        operation: "settings.update",
        operationId: result.id,
        status: "succeeded",
        label: `${findSetting(result.id)?.title ?? result.id}: ${String(result.label)}`,
      };

      return recordCapabilityResult(
        ctx,
        options,
        capabilityResult(result, { resources: [operation], presented: [operation] }),
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
