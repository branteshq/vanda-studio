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

Workspace: cada conta tem um sistema de arquivos somente-leitura que você explora com list e read. /brand (memória de marca em memory.md e fotos de referência em references/), /images (galeria da conta), /projects (carrosséis: status.json, slides.md, caption.md, renders/), /market (oportunidades e última varredura), /runs (execuções de código). As listagens trazem um resumo por linha e o id de cada entidade — paint recebe esses ids; run_code recebe os próprios caminhos do workspace (e também aceita ids de anexos). Ler um arquivo de imagem envia os pixels para você: você enxerga a imagem de verdade.

Regras de comportamento:
- Você é uma operadora, não um chatbot passivo: sempre termine propondo a próxima ação concreta.
- Nunca afirme que algo foi criado, renderizado ou publicado sem confirmar pelo estado real — leia o arquivo correspondente no workspace (ex.: /projects/<projeto>/status.json). Se algo falhou, diga exatamente o que falhou.
- Explique decisões com a evidência que as sustenta (números, motivo do gatilho, por que serve para esta marca).
- Trabalhos longos (varredura de mercado, criação de carrossel, revisão de slide) rodam em segundo plano: avise que você começou e que retorna quando terminar.
- Publicação é irreversível: ela sempre passa pelo fluxo de aprovação — nunca trate um "sim" em texto como aprovação. Antes de propor publicar, leia os renders do projeto e avalie visualmente.
- Não invente fatos sobre a marca: o que você sabe vem de /brand/memory.md. Se faltar contexto, pergunte ou peça para completar o perfil.
- Imagens (paint) — regra de roteamento, siga à risca:
  - A imagem que o usuário ANEXA na conversa já pertence à conta e já está autorizada. Use-a direto. Nunca peça "autorização" nem invente uma etapa de autorizar — esse passo não existe.
  - Para MODIFICAR uma imagem que já existe (trocar fundo, cenário, roupa, etc.), passe o id dela em editOfImageId e descreva no prompt só o que muda. É o caso quando o usuário anexa uma foto e pede para editá-la.
  - Para gerar uma imagem NOVA condicionada a um rosto, produto ou lugar específico, passe o(s) id(s) em referenceImageIds. Servem tanto imagens anexadas quanto as de /brand/references, sem autorização extra.
  - Os IDs das imagens anexadas chegam no contexto interno da mensagem (vanda_attachment_context). Só peça para o usuário enviar/subir uma foto quando não houver NENHUMA imagem disponível (nem anexada, nem em /brand/references) e o pedido exigir uma pessoa/produto específico.
- Edição de imagem — regra de roteamento entre paint e run_code: mudança GENERATIVA (trocar fundo, cenário, roupa, criar do zero) → paint. Composição DETERMINÍSTICA (texto sobre a imagem, logo, corte, redimensionar, colagem, moldura, cor exata da marca) → run_code. Texto renderizado por modelo generativo erra; texto composto por código não erra. run_code é quase gratuito — prefira-o sempre que o resultado precisar ser exato.`;

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "" });

// --- Tools ------------------------------------------------------------------

type WorkspaceToolEntry = { name: string; kind: "dir" | "file"; summary?: string | undefined };
type WorkspaceToolResult =
  | { ok: true; path: string; entries?: WorkspaceToolEntry[]; file?: WorkspaceToolFile }
  | { ok: false; error: string; nearest: string; entries: WorkspaceToolEntry[] };
type WorkspaceToolFile =
  | { kind: "text"; text: string }
  | { kind: "image"; header: string; url: string; mimeType: string };

const renderEntries = (entries: WorkspaceToolEntry[]): string =>
  entries
    .map(
      (entry) =>
        `${entry.kind === "dir" ? `${entry.name}/` : entry.name}${entry.summary ? `  — ${entry.summary}` : ""}`,
    )
    .join("\n") || "(vazio)";

const renderMiss = (result: { error: string; nearest: string; entries: WorkspaceToolEntry[] }) =>
  `${result.error}\nConteúdo de ${result.nearest}:\n${renderEntries(result.entries)}`;

const listFiles = createTool({
  description:
    "Lista um diretório do workspace da conta. A raiz / contém: /brand (memória de marca e referências), /images (galeria), /projects (carrosséis), /market (oportunidades e varredura), /runs (execuções de código). Cada linha traz um resumo e o id da entidade (o mesmo id que paint e run_code recebem).",
  inputSchema: z.object({
    path: z.string().describe('caminho do diretório, ex.: "/", "/images", "/projects/<nome>"'),
  }),
  execute: (ctx: VandaToolCtx, { path }: { path: string }): Promise<unknown> =>
    ctx.runQuery(internal.workspaceData.list, { accountId: ctx.accountId, path }),
  toModelOutput: (_ctx, { output }) => {
    const result = output as WorkspaceToolResult;
    if (!result.ok) return { type: "text", value: renderMiss(result) };
    return { type: "text", value: `${result.path}\n${renderEntries(result.entries ?? [])}` };
  },
});

const readFile = createTool({
  description:
    "Lê um arquivo do workspace. Texto (.md/.json) volta direto — use offset/limit em arquivos longos. Ler uma IMAGEM (.jpg/.png) envia os pixels: você enxerga a imagem de verdade — use quando precisar avaliar visualmente (o header traz o imageId para paint/run_code). Para só escolher entre muitas imagens, comece pela listagem, que é mais barata.",
  inputSchema: z.object({
    path: z.string().describe("caminho do arquivo, ex.: /brand/memory.md"),
    offset: z.number().optional().describe("linha inicial (1-indexada), só para texto"),
    limit: z.number().optional().describe("máximo de linhas, só para texto"),
  }),
  execute: (
    ctx: VandaToolCtx,
    { path, offset, limit }: { path: string; offset?: number | undefined; limit?: number | undefined },
  ): Promise<unknown> =>
    ctx.runQuery(internal.workspaceData.read, {
      accountId: ctx.accountId,
      path,
      ...(offset !== undefined ? { offset } : {}),
      ...(limit !== undefined ? { limit } : {}),
    }),
  toModelOutput: (_ctx, { output }) => {
    const result = output as WorkspaceToolResult;
    if (!result.ok) return { type: "text", value: renderMiss(result) };
    const file = result.file!;
    if (file.kind === "image") {
      return {
        type: "content",
        value: [
          { type: "text", text: `${result.path}\n${file.header}` },
          { type: "file", data: { type: "url", url: new URL(file.url) }, mediaType: file.mimeType },
        ],
      };
    }
    return { type: "text", value: `${result.path}\n---\n${file.text}` };
  },
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
    "Gera OU edita uma imagem a partir de um prompt visual detalhado que VOCÊ escreve. Sempre dê um `name` curto e descritivo à imagem (2–4 palavras, na voz da marca) — é como ela aparece na galeria. Para modificar uma imagem já existente da conta (inclusive uma que o usuário acabou de anexar) — trocar fundo, cenário, etc. — passe o id dela em editOfImageId e descreva no prompt só o que muda. Para condicionar uma imagem nova a um rosto, produto ou lugar, passe os ids em referenceImageIds. Imagens anexadas e as de /brand/references servem direto, sem autorização extra.",
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
    "Executa código Python (Pillow/numpy) num sandbox isolado para editar imagens de forma DETERMINÍSTICA: sobrepor texto, aplicar logo, cortar, redimensionar, montar colagens, aplicar cores exatas da marca. As imagens de `inputPaths` aparecem no sandbox no MESMO caminho do workspace, sob /home/user (ex.: /images/promo-x1y2z3.jpg → /home/user/images/promo-x1y2z3.jpg); /home/user/meta.json lista todas com dimensões e imageId. Salve os resultados como PNG ou JPEG em /home/user/out/ — o nome do arquivo vira o nome na galeria (promo-agosto.png → \"promo agosto\"). Fontes instaladas (Poppins, Inter, Montserrat, Lora, Playfair Display, Roboto) estão listadas em /home/user/fonts/manifest.json com o caminho de cada uma. Sem acesso à internet. Se o código falhar, o traceback volta em stderr: corrija o código e rode de novo.",
  inputSchema: z.object({
    code: z.string().describe("código Python 3 completo; Pillow e numpy disponíveis"),
    description: z
      .string()
      .describe("descrição curta do que o código faz, na voz da marca (vira o prompt na galeria)"),
    inputPaths: z
      .array(z.string())
      .max(10)
      .optional()
      .describe(
        "caminhos do workspace (/images/…, /brand/references/…, /projects/<p>/renders/NN) ou imageIds diretos (anexos)",
      ),
  }),
  execute: async (
    ctx: VandaToolCtx,
    args: { code: string; description: string; inputPaths?: string[] | undefined },
  ): Promise<unknown> =>
    ctx.runAction(internal.codeRuns.run, {
      accountId: ctx.accountId,
      code: args.code,
      description: args.description,
      // Lets the owner's stop button cancel the execution mid-flight.
      ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
      ...(args.inputPaths ? { inputPaths: args.inputPaths } : {}),
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
    list: listFiles,
    read: readFile,
    start_market_scan: startMarketScan,
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
