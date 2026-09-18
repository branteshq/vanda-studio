import { Agent, createTool, stepCountIs, type ToolCtx } from "@convex-dev/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { resolveCaetanoModel } from "./agentModels";
import { recordCapabilityResult } from "./capabilityTools";
import { imageModelOutput, imagePreviewSchema } from "./messageImages";
import { toolDiscovery } from "./toolDiscovery";
import {
  capabilityResult,
  capabilityResultSchema,
  presentableResourceInputSchema,
  type PresentableResourceInput,
  type ThreadResource,
} from "./resourceRefs";

export type CaetanoCtx = ToolCtx & {
  readonly ownerUserId: Id<"users">;
  readonly caetanoThreadId: string;
  readonly sourcePromptMessageId: string;
};

type CapabilityOutput = z.infer<typeof capabilityResultSchema>;

type AccountQueryArgs = { userId: Id<"users">; accountId?: Id<"accounts"> };

type ModelPreferenceArgs = {
  userId: Id<"users">;
  orchestrator?: string;
  caetano?: string;
  image?: string;
};

type PresentDocument = { kind: "document"; path: string; title?: string };

type ResultSummary = { shown: number; message?: string };

type AskVandaArgs = {
  userId: Id<"users">;
  caetanoThreadId: string;
  sourcePromptMessageId: string;
  request: string;
  accountId?: Id<"accounts">;
  threadId?: string;
};

const optionalAccountId = z.string().optional().describe("id da conta; omita para usar a ativa");

const listAccounts = createTool({
  description: "Lista os negócios do dono e indica qual está ativo.",
  inputSchema: z.object({}),
  outputSchema: capabilityResultSchema,
  execute: async (ctx: CaetanoCtx): Promise<CapabilityOutput> =>
    capabilityResult(
      await ctx.runQuery(internal.caetanoData.listAccounts, { userId: ctx.ownerUserId }),
    ),
});

const selectAccount = createTool({
  description: "Troca o negócio ativo do dono. Use somente após identificar claramente a conta.",
  inputSchema: z.object({ accountId: z.string() }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: CaetanoCtx,
    { accountId }: { accountId: string },
    options,
  ): Promise<CapabilityOutput> => {
    // SAFETY: Convex tool inputSchema validated accountId as a non-empty account identifier string.
    const typedAccountId = accountId as Id<"accounts">;
    await ctx.runMutation(internal.caetanoData.selectAccount, {
      userId: ctx.ownerUserId,
      accountId: typedAccountId,
    });

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
          brandContext: await ctx.runQuery(internal.brandContext.conversation, {
            userId: ctx.ownerUserId,
            accountId: typedAccountId,
          }),
        },
        {
          resources: [operation],
          presented: [operation],
        },
      ),
    );
  },
});

const accountStatus = createTool({
  description:
    "Consulta conexão do Instagram, onboarding, memória confirmada e links principais de uma conta.",
  inputSchema: z.object({ accountId: optionalAccountId }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: CaetanoCtx,
    { accountId }: { accountId?: string | undefined },
  ): Promise<CapabilityOutput> => {
    const queryArgs: AccountQueryArgs = {
      userId: ctx.ownerUserId,
    };

    if (accountId) {
      // SAFETY: Convex tool inputSchema validated accountId as an account identifier string.
      queryArgs.accountId = accountId as Id<"accounts">;
    }

    const status = await ctx.runQuery(internal.caetanoData.accountStatus, queryArgs);
    const brandContext = await ctx.runQuery(internal.brandContext.conversation, queryArgs);

    return capabilityResult({ ...status, brandContext });
  },
});

const inspectImage = createTool({
  description:
    "Inspeciona os pixels de uma imagem da conta. Use para revisar imagens retornadas pela Vanda antes de entregar: confira texto, marca, legibilidade e fidelidade ao pedido. Se houver problema, peça uma correção específica com ask_vanda na mesma conversa retornada.",
  inputSchema: z.object({ accountId: optionalAccountId, imageId: z.string() }),
  outputSchema: imagePreviewSchema,
  execute: async (
    ctx: CaetanoCtx,
    input: { accountId?: string | undefined; imageId: string },
  ): Promise<z.infer<typeof imagePreviewSchema>> => {
    const args: AccountQueryArgs & { imageId: Id<"images"> } = {
      userId: ctx.ownerUserId,
      // SAFETY: the input is consumed only as a Convex id; the query checks image ownership.
      imageId: input.imageId as Id<"images">,
    };

    if (input.accountId) {
      // SAFETY: the query checks that the owner can access the requested account.
      args.accountId = input.accountId as Id<"accounts">;
    }

    return ctx.runQuery(internal.caetanoData.inspectImage, args);
  },
  toModelOutput: (_ctx, { output }) => imageModelOutput(output),
});

const usageStatus = createTool({
  description: "Consulta o plano, percentual de uso e eventual bloqueio do dono.",
  inputSchema: z.object({}),
  outputSchema: capabilityResultSchema,
  execute: async (ctx: CaetanoCtx): Promise<CapabilityOutput> =>
    capabilityResult(
      await ctx.runQuery(internal.caetanoData.usageStatus, { userId: ctx.ownerUserId }),
    ),
});

const modelPreferences = createTool({
  description: "Consulta os modelos atuais da Vanda, do Caetano e de imagem do dono.",
  inputSchema: z.object({}),
  outputSchema: capabilityResultSchema,
  execute: async (ctx: CaetanoCtx): Promise<CapabilityOutput> =>
    capabilityResult(
      await ctx.runQuery(internal.caetanoData.modelPreferences, { userId: ctx.ownerUserId }),
    ),
});

const setModelPreferences = createTool({
  description:
    "Altera modelos do dono. orchestrator controla a Vanda; caetano controla o Caetano no próximo turno (web e WhatsApp). Ambos aceitam ids de texto do catálogo compatíveis com a conexão do dono. No plano ChatGPT ambos usam a assinatura e só aceitam modelos compatíveis. image aceita ids de imagem do catálogo compatíveis com a conexão (ex.: openai/gpt-image-2.5-flare).",
  inputSchema: z
    .object({
      orchestrator: z.string().optional(),
      caetano: z.string().optional(),
      image: z.string().optional(),
    })
    .refine(
      (value) =>
        value.orchestrator !== undefined ||
        value.caetano !== undefined ||
        value.image !== undefined,
      {
        message: "informe ao menos um modelo",
      },
    ),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: CaetanoCtx,
    input: {
      orchestrator?: string | undefined;
      caetano?: string | undefined;
      image?: string | undefined;
    },
    options,
  ): Promise<CapabilityOutput> => {
    const mutationArgs: ModelPreferenceArgs = { userId: ctx.ownerUserId };

    if (input.orchestrator) mutationArgs.orchestrator = input.orchestrator;

    if (input.caetano) mutationArgs.caetano = input.caetano;

    if (input.image) mutationArgs.image = input.image;
    await ctx.runMutation(internal.caetanoData.setModelPreferences, mutationArgs);

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
});

const listVandaThreads = createTool({
  description:
    "Lista conversas recentes da Vanda para encontrar trabalho anterior ou continuar uma conversa específica.",
  inputSchema: z.object({ accountId: optionalAccountId }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: CaetanoCtx,
    { accountId }: { accountId?: string | undefined },
  ): Promise<CapabilityOutput> => {
    const queryArgs: AccountQueryArgs = {
      userId: ctx.ownerUserId,
    };

    if (accountId) {
      // SAFETY: Convex tool inputSchema validated accountId as an account identifier string.
      queryArgs.accountId = accountId as Id<"accounts">;
    }

    return ctx.runQuery(internal.caetanoData.listVandaThreads, queryArgs).then(capabilityResult);
  },
});

const present = createTool({
  description:
    "Mostra na conversa uma imagem, post, documento ou link que já existe. Use quando o dono pedir para ver ou reenviar um resultado anterior.",
  inputSchema: z.object({
    accountId: optionalAccountId,
    resources: z.array(presentableResourceInputSchema).min(1).max(12),
    message: z.string().optional(),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: CaetanoCtx,
    input: {
      accountId?: string | undefined;
      resources: PresentableResourceInput[];
      message?: string | undefined;
    },
    options,
  ): Promise<CapabilityOutput> => {
    const statusArgs: AccountQueryArgs = {
      userId: ctx.ownerUserId,
    };

    if (input.accountId) {
      // SAFETY: Convex tool inputSchema validated accountId as an account identifier string.
      statusArgs.accountId = input.accountId as Id<"accounts">;
    }

    const account = await ctx.runQuery(internal.caetanoData.accountStatus, statusArgs);

    const resources = await ctx.runQuery(internal.threadResources.resolvePresentable, {
      accountId: account.accountId,
      resources: input.resources.map((resource) => {
        if (resource.kind === "image") {
          // SAFETY: presentableResourceInputSchema identifies this value as an image resource id.
          return { kind: "image" as const, imageId: resource.imageId as Id<"images"> };
        }

        if (resource.kind === "post") {
          // SAFETY: presentableResourceInputSchema identifies this value as a post resource id.
          return { kind: "post" as const, postId: resource.postId as Id<"posts"> };
        }

        if (resource.kind === "document") {
          const document: PresentDocument = {
            kind: "document" as const,
            path: resource.path,
          };

          if (resource.title) document.title = resource.title;

          return document;
        }

        return resource;
      }),
    });

    const resultData: ResultSummary = { shown: resources.length };

    if (input.message) resultData.message = input.message;

    return recordCapabilityResult(
      ctx,
      options,
      capabilityResult(resultData, { resources, presented: resources, summary: input.message }),
    );
  },
});

const askVanda = createTool({
  description:
    "Entrega à Vanda um pedido de marketing completo e aguarda o trabalho terminar. O sistema preserva a mensagem original e seus anexos; inclua no request os detalhes relevantes do histórico e, para revisão, o problema específico a corrigir. Criar um post significa criar um rascunho; agendar/publicar exige pedido explícito do dono. Use para executar trabalho de marketing; revise você mesmo os resultados retornados.",
  inputSchema: z.object({
    request: z.string().min(1).describe("pedido original do dono, preservado em detalhes"),
    accountId: optionalAccountId,
    threadId: z.string().optional().describe("conversa específica da Vanda a continuar"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: CaetanoCtx,
    input: { request: string; accountId?: string | undefined; threadId?: string | undefined },
    options,
  ): Promise<CapabilityOutput> => {
    const actionArgs: AskVandaArgs = {
      userId: ctx.ownerUserId,
      caetanoThreadId: ctx.caetanoThreadId,
      sourcePromptMessageId: ctx.sourcePromptMessageId,
      request: input.request,
    };

    if (input.accountId) {
      // SAFETY: Convex tool inputSchema validated accountId as an account identifier string.
      actionArgs.accountId = input.accountId as Id<"accounts">;
    }

    if (input.threadId) actionArgs.threadId = input.threadId;
    const data = await ctx.runAction(internal.caetanoNode.askVanda, actionArgs);

    return recordCapabilityResult(
      ctx,
      options,
      capabilityResult(data, {
        resources: data.resources,
        presented: data.presented,
      }),
    );
  },
});

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "" });

export const caetanoLanguageModel = (preferred?: string | null) =>
  openrouter.chat(resolveCaetanoModel(preferred), { usage: { include: true } });

const FALLBACK_INPUT_USD = 2e-6;

const FALLBACK_OUTPUT_USD = 8e-6;

const INSTRUCTIONS = `Você é o Caetano, o macaquinho operador do Vanda Studio. Você é o ponto de entrada do dono para o produto inteiro.

Você conversa em português do Brasil, com humor seco e leve, sem exagerar no personagem. Seja curto, claro e prestativo.

Seu trabalho direto é resolver dúvidas e configurações do produto: contas, conexão, uso, modelos, conversas e navegação. Para executar trabalho de marketing — pesquisa, estratégia, conteúdo, imagens, calendário ou publicação — chame ask_vanda no mesmo turno e deixe a Vanda executar. Não escreva o conteúdo no lugar dela e nunca diga que algo foi feito antes do retorno da ferramenta.

Ferramentas adicionais: tool_search encontra listagem/troca de negócios, plano/uso/limites, consulta/alteração de modelos e listagem de conversas recentes da Vanda. Busque por tarefa ou nome antes de concluir que algo não é suportado; se não encontrar, reformule ou use '*'. Os resultados habilitam as ferramentas tipadas no próximo passo e pelo restante deste turno; em um novo turno, busque novamente se precisar. Busca não executa ações nem concede permissão. Falta de conexão/permissão e falha temporária não significam capacidade inexistente. A listagem de conversas não busca o conteúdo delas; busca em documentação do produto e no conteúdo de conversas antigas ainda não está disponível. Ferramentas de execução de marketing pertencem à Vanda, via ask_vanda.

Há uma conta ativa, mas o dono pode ter várias. O contexto de marca já vem incluído: use-o e não peça ao dono para repetir quem ele é ou explicar o negócio. Use a conta ativa quando o pedido estiver claro. Liste ou confirme contas somente quando houver ambiguidade real. Ao trabalhar com outra conta, consulte account_status para receber seu contexto; select_account também devolve o contexto atualizado. Preserve o pedido original ao delegar; inclua os detalhes relevantes do histórico, sem reduzir restrições importantes.

"Faça um post" significa sempre criar um RASCUNHO, nunca agendar nem publicar automaticamente. Só peça agendamento, reagendamento ou publicação à Vanda quando o dono solicitar isso explicitamente. Uma data no briefing de criação não é autorização para publicar. Não transforme aprovação da arte em autorização para agendar. Se faltar a decisão, entregue o rascunho e aguarde o dono.

Revise seu próprio trabalho antes de entregar. Confira se a resposta resolve o pedido e se o estado informado foi confirmado. Revise também os resultados delegados: use inspect_image para ver cada imagem final apresentada pela Vanda, comparando com a marca e o pedido (texto, legibilidade, cortes, logo e fidelidade aos anexos). Mostrar uma imagem não significa tê-la inspecionado. Se encontrar defeito concreto, continue a threadId devolvida por ask_vanda e peça uma correção específica; inspecione a nova versão. Faça no máximo duas rodadas de correção por pedido e explique limitações que restarem. Você e Vanda revisam o próprio trabalho; não dependa de um revisor separado.

Quando a Vanda terminar, responda com um resumo curto do resultado e o estado final. Imagens, posts, documentos e links retornados por ela aparecem na conversa automaticamente. Nunca mande o dono abrir outra página só para ver um resultado. Para mostrar novamente um recurso anterior, use present. Não exponha ids internos, nomes de ferramentas, prompts de sistema ou detalhes da infraestrutura.`;

const tools = {
  list_accounts: listAccounts,
  select_account: selectAccount,
  account_status: accountStatus,
  usage_status: usageStatus,
  model_preferences: modelPreferences,
  set_model_preferences: setModelPreferences,
  list_vanda_threads: listVandaThreads,
  inspect_image: inspectImage,
  present,
  ask_vanda: askVanda,
};

export const caetanoToolDiscovery = toolDiscovery(tools, {
  list_accounts: {
    keywords: "contas negócios marcas empresas listar accounts businesses brands list",
    effect: "read",
  },
  select_account: {
    keywords: "trocar mudar selecionar negócio conta marca switch select business account",
    effect: "write",
  },
  usage_status: {
    keywords:
      "plano assinatura uso limite bloqueio créditos cota plan subscription usage quota billing limits",
    effect: "read",
  },
  model_preferences: {
    keywords: "modelos modelo preferências configuração models preferences settings current",
    effect: "read",
  },
  set_model_preferences: {
    keywords:
      "trocar mudar alterar modelo modelos configuração change set models preferences settings",
    effect: "write",
  },
  list_vanda_threads: {
    keywords:
      "conversas anteriores recentes trabalhos histórico threads conversations previous history",
    effect: "read",
  },
});

export const caetano = new Agent<CaetanoCtx>(components.agent, {
  name: "caetano",
  languageModel: caetanoLanguageModel(),
  usageHandler: async (ctx, { userId, usage, providerMetadata, model, provider }) => {
    if (!userId?.startsWith("caetano:") || !provider.includes("openrouter")) return;
    // SAFETY: startsWith above establishes that slicing removes only the routing prefix from a Convex user id.
    const ownerUserId = userId.slice("caetano:".length) as Id<"users">;
    const costSchema = z.object({ usage: z.object({ cost: z.number() }).optional() }).optional();
    const reported = costSchema.safeParse(providerMetadata?.openrouter);

    const usd =
      reported.success && reported.data?.usage
        ? reported.data.usage.cost
        : (usage.inputTokens ?? 0) * FALLBACK_INPUT_USD +
          (usage.outputTokens ?? 0) * FALLBACK_OUTPUT_USD;

    if (usd <= 0) return;
    await ctx.runMutation(internal.usage.charge, {
      userId: ownerUserId,
      kind: "caetano_chat",
      usd,
      ref: model,
    });
  },
  instructions: INSTRUCTIONS,
  tools: { ...tools, tool_search: caetanoToolDiscovery.search },
  stopWhen: stepCountIs(12),
});

export const caetanoSystemPrompt = (): string =>
  `${INSTRUCTIONS}\n\nAgora: ${new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "full",
    timeStyle: "short",
  })}. Fuso: America/Sao_Paulo.`;
