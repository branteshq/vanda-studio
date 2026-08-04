import { Agent, createTool, stepCountIs, type ToolCtx } from "@convex-dev/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { v } from "convex/values";
import { z } from "zod";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";

/**
 * Vanda, the conversational operator. Threads are keyed per Instagram account
 * (an owner can hold many conversations per account); the agent converses,
 * delegates to the product's capabilities through a small set of typed tools,
 * and stops at consequential decisions. Durable workflows and domain tables
 * remain the source of truth — the tools only reach internal functions scoped
 * to the thread's account. Background jobs carry the originating threadId so
 * completion notes land in the conversation that asked for the work.
 */

export const VANDA_MODEL = "openai/gpt-5.6-terra";

/** Every agent turn carries the account the thread belongs to. */
type VandaCtx = { accountId: Id<"accounts"> };
type VandaToolCtx = ToolCtx & VandaCtx;

const INSTRUCTIONS = `Você é a Vanda, uma operadora de crescimento de Instagram para pequenos negócios brasileiros. Você conversa em português do Brasil, com tom direto, caloroso e profissional.

Seu trabalho: observar o mercado, encontrar oportunidades com evidência real, criar carrosséis originais fiéis à marca do usuário e publicar somente com aprovação explícita.

Regras de comportamento:
- Você é uma operadora, não um chatbot passivo: sempre termine propondo a próxima ação concreta.
- Nunca afirme que algo foi criado, renderizado ou publicado sem confirmar pelo estado real (use as ferramentas de leitura). Se algo falhou, diga exatamente o que falhou.
- Explique decisões com a evidência que as sustenta (números, motivo do gatilho, por que serve para esta marca).
- Trabalhos longos (varredura de mercado, criação de carrossel, revisão de slide) rodam em segundo plano: avise que você começou e que retorna quando terminar.
- Publicação é irreversível: ela sempre passa pelo fluxo de aprovação — nunca trate um "sim" em texto como aprovação.
- Não invente fatos sobre a marca: o que você sabe vem da memória de marca confirmada pelo dono. Se faltar contexto, pergunte ou peça para completar o perfil.
- Imagens (paint) — regra de roteamento, siga à risca:
  - A imagem que o usuário ANEXA na conversa já pertence à conta e já está autorizada. Use-a direto. Nunca peça "autorização" nem invente uma etapa de autorizar — esse passo não existe.
  - Para MODIFICAR uma imagem que já existe (trocar fundo, cenário, roupa, etc.), passe o id dela em editOfImageId e descreva no prompt só o que muda. É o caso quando o usuário anexa uma foto e pede para editá-la.
  - Para gerar uma imagem NOVA condicionada a um rosto, produto ou lugar específico, passe o(s) id(s) em referenceImageIds. Servem tanto imagens anexadas quanto as de list_reference_photos, sem autorização extra.
  - Os IDs das imagens anexadas chegam no contexto interno da mensagem (vanda_attachment_context). Só peça para o usuário enviar/subir uma foto quando não houver NENHUMA imagem disponível (nem anexada, nem em list_reference_photos) e o pedido exigir uma pessoa/produto específico.
- Edição de imagem — regra de roteamento entre paint e run_code: mudança GENERATIVA (trocar fundo, cenário, roupa, criar do zero) → paint. Composição DETERMINÍSTICA (texto sobre a imagem, logo, corte, redimensionar, colagem, moldura, cor exata da marca) → run_code. Texto renderizado por modelo generativo erra; texto composto por código não erra. run_code é quase gratuito — prefira-o sempre que o resultado precisar ser exato.`;

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "" });

// --- Tools ------------------------------------------------------------------

const getBrandMemory = createTool({
  description:
    "Lê a memória de marca confirmada pelo dono (fatos, voz, restrições) e o quão pronto o perfil está.",
  inputSchema: z.object({}),
  execute: async (ctx: VandaToolCtx): Promise<unknown> => {
    const brand: { ownHandle?: string | undefined; context: string; readiness: unknown } =
      await ctx.runQuery(internal.market.loadBrandContext, {
        accountId: ctx.accountId,
      });
    return {
      handle: brand.ownHandle ?? null,
      brand: brand.context,
      readiness: brand.readiness,
    };
  },
});

const listReferencePhotos = createTool({
  description:
    "Lista as fotos de referência salvas pelo dono (rosto, produto, lugar), com seus ids. Use quando precisar de um rosto/produto/lugar e o usuário NÃO tiver anexado uma imagem na conversa. Imagens anexadas pelo usuário também servem como referência direta, sem precisar estar nesta lista.",
  inputSchema: z.object({}),
  execute: (ctx: VandaToolCtx): Promise<unknown> =>
    ctx.runQuery(internal.brandProfile.listAuthorizedReferences, { accountId: ctx.accountId }),
});

const listOpportunities = createTool({
  description:
    "Lista as oportunidades de mercado recentes (posts de outros criadores com desempenho fora da curva) e o estágio de cada uma.",
  inputSchema: z.object({}),
  execute: (ctx: VandaToolCtx): Promise<unknown> =>
    ctx.runQuery(internal.market.listOpportunitiesForAgent, { accountId: ctx.accountId }),
});

const getMarketStatus = createTool({
  description:
    "Consulta a última varredura de mercado desta conta: estágio, resultado e erros, se houver.",
  inputSchema: z.object({}),
  execute: (ctx: VandaToolCtx): Promise<unknown> =>
    ctx.runQuery(internal.market.latestRunForAgent, { accountId: ctx.accountId }),
});

const startMarketScan = createTool({
  description:
    "Inicia em segundo plano uma varredura de mercado: observa criadores monitorados, detecta breakouts e qualifica oportunidades. Avise o usuário que você retorna quando terminar.",
  inputSchema: z.object({}),
  execute: async (ctx: VandaToolCtx): Promise<string> => {
    await ctx.scheduler.runAfter(0, internal.vanda.runMarketScan, {
      accountId: ctx.accountId,
      ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
    });
    return "Varredura iniciada em segundo plano.";
  },
});

const listProjects = createTool({
  description: "Lista os projetos de conteúdo recentes da conta com status de cada um.",
  inputSchema: z.object({}),
  execute: (ctx: VandaToolCtx): Promise<unknown> =>
    ctx.runQuery(internal.contentStudio.listProjectsForAgent, { accountId: ctx.accountId }),
});

const getProject = createTool({
  description:
    "Lê um projeto de carrossel: slides, legenda, revisão editorial, mídia renderizada e estado de publicação.",
  inputSchema: z.object({ projectId: z.string().describe("id do projeto de conteúdo") }),
  execute: (ctx: VandaToolCtx, { projectId }: { projectId: string }): Promise<unknown> =>
    ctx.runQuery(internal.contentStudio.projectForAgent, {
      projectId: projectId as Id<"contentProjects">,
      accountId: ctx.accountId,
    }),
});

const createCarousel = createTool({
  description:
    "Cria em segundo plano um carrossel a partir do brief criativo de uma oportunidade qualificada (campo creativeBriefId). Avise o usuário que você retorna quando terminar.",
  inputSchema: z.object({
    creativeBriefId: z.string().describe("id do brief criativo da oportunidade"),
  }),
  execute: async (
    ctx: VandaToolCtx,
    { creativeBriefId }: { creativeBriefId: string },
  ): Promise<string> => {
    await ctx.scheduler.runAfter(0, internal.vanda.runCarouselCreation, {
      accountId: ctx.accountId,
      creativeBriefId: creativeBriefId as Id<"creativeBriefs">,
      ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
    });
    return "Criação do carrossel iniciada em segundo plano.";
  },
});

const reviseSlide = createTool({
  description:
    "Refaz um slide específico de um carrossel em segundo plano, seguindo a instrução do usuário. Depois o documento passa por nova revisão editorial e re-render.",
  inputSchema: z.object({
    projectId: z.string().describe("id do projeto de conteúdo"),
    slideId: z.string().describe("id do slide a refazer (veja get_project)"),
    instruction: z.string().describe("o que deve mudar, na voz do usuário"),
  }),
  execute: async (
    ctx: VandaToolCtx,
    {
      projectId,
      slideId,
      instruction,
    }: { projectId: string; slideId: string; instruction: string },
  ): Promise<string> => {
    await ctx.scheduler.runAfter(0, internal.vanda.runSlideRevision, {
      accountId: ctx.accountId,
      projectId: projectId as Id<"contentProjects">,
      slideId,
      instruction,
      ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
    });
    return "Revisão do slide iniciada em segundo plano.";
  },
});

const requestRender = createTool({
  description:
    "Coloca o documento aprovado de um projeto na fila de renderização (gera as imagens finais 1080x1350).",
  inputSchema: z.object({ projectId: z.string().describe("id do projeto de conteúdo") }),
  execute: async (ctx: VandaToolCtx, { projectId }: { projectId: string }): Promise<string> => {
    await ctx.runMutation(internal.contentStudio.requestRenderInternal, {
      projectId: projectId as Id<"contentProjects">,
    });
    return "Render na fila.";
  },
});

const publishProject = createTool({
  description:
    "Agenda a publicação de um projeto renderizado no Instagram conectado. Requer aprovação explícita do dono. Opcionalmente com data/hora futura (ISO 8601).",
  inputSchema: z.object({
    projectId: z.string().describe("id do projeto de conteúdo"),
    scheduledFor: z
      .string()
      .optional()
      .describe("data/hora ISO 8601 para publicar; omita para publicar agora"),
  }),
  needsApproval: true,
  execute: async (
    ctx: VandaToolCtx,
    { projectId, scheduledFor }: { projectId: string; scheduledFor?: string | undefined },
  ): Promise<unknown> => {
    const at = scheduledFor ? Date.parse(scheduledFor) : undefined;
    if (scheduledFor && Number.isNaN(at)) throw new Error("data de agendamento inválida");
    const scheduledPostId: string = await ctx.runMutation(
      internal.contentStudio.approveProjectInternal,
      {
        projectId: projectId as Id<"contentProjects">,
        accountId: ctx.accountId,
        ...(at !== undefined ? { scheduledFor: at } : {}),
      },
    );
    return { scheduledPostId, scheduledFor: at ?? "imediata" };
  },
});

const paint = createTool({
  description:
    "Gera OU edita uma imagem a partir de um prompt visual detalhado que VOCÊ escreve. Sempre dê um `name` curto e descritivo à imagem (2–4 palavras, na voz da marca) — é como ela aparece na galeria. Para modificar uma imagem já existente da conta (inclusive uma que o usuário acabou de anexar) — trocar fundo, cenário, etc. — passe o id dela em editOfImageId e descreva no prompt só o que muda. Para condicionar uma imagem nova a um rosto, produto ou lugar, passe os ids em referenceImageIds. Imagens anexadas e as de list_reference_photos servem direto, sem autorização extra.",
  inputSchema: z.object({
    prompt: z.string().describe("prompt visual detalhado escrito pela Vanda"),
    name: z.string().describe("nome curto e descritivo para a imagem na galeria (2–4 palavras)"),
    aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:9"]).default("4:5"),
    resolution: z
      .enum(["1K", "2K", "4K"])
      .optional()
      .describe(
        "resolução de saída; padrão 1K. Use 2K/4K só quando o dono pedir alta resolução " +
          "(custa mais). Nem todo modelo suporta — o sistema ajusta para o máximo disponível.",
      ),
    referenceImageIds: z.array(z.string()).optional(),
    editOfImageId: z.string().optional(),
  }),
  execute: async (
    ctx: VandaToolCtx,
    args: {
      prompt: string;
      name: string;
      aspectRatio: "1:1" | "4:5" | "9:16" | "16:9";
      resolution?: "1K" | "2K" | "4K" | undefined;
      referenceImageIds?: string[] | undefined;
      editOfImageId?: string | undefined;
    },
  ): Promise<unknown> =>
    ctx.runAction(internal.images.paint, {
      accountId: ctx.accountId,
      prompt: args.prompt,
      name: args.name,
      aspectRatio: args.aspectRatio,
      promptAuthor: "vanda",
      // Lets the owner's stop button cancel the generation mid-flight.
      ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
      ...(args.resolution ? { resolution: args.resolution } : {}),
      ...(args.referenceImageIds
        ? { referenceImageIds: args.referenceImageIds as Array<Id<"images">> }
        : {}),
      ...(args.editOfImageId ? { editOfImageId: args.editOfImageId as Id<"images"> } : {}),
    }),
});

const runCode = createTool({
  description:
    "Executa código Python (Pillow/numpy) num sandbox isolado para editar imagens de forma DETERMINÍSTICA: sobrepor texto, aplicar logo, cortar, redimensionar, montar colagens, aplicar cores exatas da marca. As imagens de `inputImageIds` aparecem em /home/user/in/ (leia /home/user/in/meta.json para saber o arquivo de cada uma). Salve os resultados como PNG ou JPEG em /home/user/out/ — o nome do arquivo vira o nome na galeria (promo-agosto.png → \"promo agosto\"). Fontes instaladas (Poppins, Inter, Montserrat, Lora, Playfair Display, Roboto) estão listadas em /home/user/fonts/manifest.json com o caminho de cada uma. Sem acesso à internet. Se o código falhar, o traceback volta em stderr: corrija o código e rode de novo.",
  inputSchema: z.object({
    code: z.string().describe("código Python 3 completo; Pillow e numpy disponíveis"),
    description: z
      .string()
      .describe("descrição curta do que o código faz, na voz da marca (vira o prompt na galeria)"),
    inputImageIds: z
      .array(z.string())
      .max(10)
      .optional()
      .describe("ids de imagens da conta a materializar em /home/user/in/"),
  }),
  execute: async (
    ctx: VandaToolCtx,
    args: { code: string; description: string; inputImageIds?: string[] | undefined },
  ): Promise<unknown> =>
    ctx.runAction(internal.codeRuns.run, {
      accountId: ctx.accountId,
      code: args.code,
      description: args.description,
      // Lets the owner's stop button cancel the execution mid-flight.
      ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
      ...(args.inputImageIds
        ? { inputImageIds: args.inputImageIds as Array<Id<"images">> }
        : {}),
    }),
});

const discardProject = createTool({
  description: "Arquiva um projeto de conteúdo que o dono decidiu descartar.",
  inputSchema: z.object({ projectId: z.string().describe("id do projeto de conteúdo") }),
  execute: async (ctx: VandaToolCtx, { projectId }: { projectId: string }): Promise<string> => {
    await ctx.runMutation(internal.contentStudio.archiveProjectInternal, {
      projectId: projectId as Id<"contentProjects">,
      accountId: ctx.accountId,
    });
    return "Projeto arquivado.";
  },
});

export const vanda = new Agent<VandaCtx>(components.agent, {
  name: "vanda",
  languageModel: openrouter.chat(VANDA_MODEL),
  instructions: INSTRUCTIONS,
  tools: {
    get_brand_memory: getBrandMemory,
    list_reference_photos: listReferencePhotos,
    list_opportunities: listOpportunities,
    get_market_status: getMarketStatus,
    start_market_scan: startMarketScan,
    list_projects: listProjects,
    get_project: getProject,
    create_carousel: createCarousel,
    revise_slide: reviseSlide,
    request_render: requestRender,
    paint,
    run_code: runCode,
    publish_project: publishProject,
    discard_project: discardProject,
  },
  stopWhen: stepCountIs(12),
});

// --- Background jobs the tools delegate to ----------------------------------
// Each runs the real pipeline, then reports back into the conversation that
// requested it (threadId), so the user hears about completion without keeping
// the page (or the turn) open.

export const runMarketScan = internalAction({
  args: { accountId: v.id("accounts"), threadId: v.optional(v.string()) },
  handler: async (ctx, { accountId, threadId }): Promise<void> => {
    try {
      const result = (await ctx.runAction(internal.marketNode.runAccount, { accountId })) as {
        postsObserved: number;
        opportunitiesDetected: number;
      };
      await ctx.runMutation(internal.chat.postAssistantNote, {
        accountId,
        ...(threadId ? { threadId } : {}),
        text:
          result.opportunitiesDetected > 0
            ? `Terminei a varredura de mercado: observei ${result.postsObserved} posts e encontrei ${result.opportunitiesDetected} oportunidade(s) nova(s). Me peça para listá-las quando quiser.`
            : `Terminei a varredura de mercado: observei ${result.postsObserved} posts e nenhuma oportunidade forte o suficiente apareceu desta vez. Isso é um resultado honesto — prefiro não criar conteúdo sem uma boa razão.`,
      });
    } catch (error) {
      await ctx.runMutation(internal.chat.postAssistantNote, {
        accountId,
        ...(threadId ? { threadId } : {}),
        text: `A varredura de mercado falhou: ${error instanceof Error ? error.message : String(error)}. Me avise se quiser que eu tente de novo.`,
      });
    }
  },
});

export const runCarouselCreation = internalAction({
  args: {
    accountId: v.id("accounts"),
    creativeBriefId: v.id("creativeBriefs"),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, creativeBriefId, threadId }): Promise<void> => {
    try {
      const projectId = (await ctx.runAction(internal.contentStudioNode.createFromBriefInternal, {
        creativeBriefId,
      })) as Id<"contentProjects">;
      const project = await ctx.runQuery(internal.contentStudio.projectForAgent, {
        projectId,
        accountId,
      });
      await ctx.runMutation(internal.chat.postAssistantNote, {
        accountId,
        ...(threadId ? { threadId } : {}),
        text: project
          ? `O carrossel "${project.title}" ficou pronto (status: ${project.status}). Me peça para mostrar o projeto quando quiser revisar.`
          : "O carrossel ficou pronto. Me peça para listar os projetos quando quiser revisar.",
      });
    } catch (error) {
      await ctx.runMutation(internal.chat.postAssistantNote, {
        accountId,
        ...(threadId ? { threadId } : {}),
        text: `A criação do carrossel falhou: ${error instanceof Error ? error.message : String(error)}.`,
      });
    }
  },
});

export const runSlideRevision = internalAction({
  args: {
    accountId: v.id("accounts"),
    projectId: v.id("contentProjects"),
    slideId: v.string(),
    instruction: v.string(),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, projectId, slideId, instruction, threadId }): Promise<void> => {
    try {
      await ctx.runAction(internal.contentStudioNode.regenerateSlideInternal, {
        projectId,
        slideId,
        instruction,
      });
      await ctx.runMutation(internal.chat.postAssistantNote, {
        accountId,
        ...(threadId ? { threadId } : {}),
        text: "Refiz o slide pedido e mandei o documento para nova revisão e render. Me peça para mostrar o projeto para conferir o resultado.",
      });
    } catch (error) {
      await ctx.runMutation(internal.chat.postAssistantNote, {
        accountId,
        ...(threadId ? { threadId } : {}),
        text: `A revisão do slide falhou: ${error instanceof Error ? error.message : String(error)}.`,
      });
    }
  },
});
