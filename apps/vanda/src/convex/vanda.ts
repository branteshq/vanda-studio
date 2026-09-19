import { Agent, createTool, stepCountIs, type ToolCtx } from "@convex-dev/agent";
import { chatUsageHandler, openrouterChatModel } from "./chatModel";

export { openrouterChatModel } from "./chatModel";

import { z } from "zod";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_ORCHESTRATOR_MODEL } from "./agentModels";
import { recordCapabilityResult } from "./capabilityTools";
import { imageModelOutput, imagePreviewSchema } from "./messageImages";
import { toolDiscovery } from "./toolDiscovery";
import { previousWorkTools } from "./tools/previousWork";
import { productHelp } from "./productHelp";
import { compactInstagramHistory } from "./instagram/toolSummary";
import {
  capabilityResult,
  capabilityResultSchema,
  presentableResourceInputSchema,
  type PresentableResourceInput,
  type ThreadResource,
} from "./resourceRefs";
import { formatSkillsForSystemPrompt } from "./skills/catalog";
import * as InstagramToolFactory from "./tools/instagram";

/**
 * Vanda, the conversational operator. Threads are keyed per Instagram account
 * (an owner can hold many conversations per account); the agent converses,
 * delegates to the product's capabilities through a small set of typed tools,
 * and stops at consequential decisions. Durable workflows and domain tables
 * remain the source of truth — the tools only reach internal functions scoped
 * to the thread's account. Background jobs carry the originating threadId so
 * completion notes land in the conversation that asked for the work.
 */

export const VANDA_MODEL = DEFAULT_ORCHESTRATOR_MODEL;

/** Every agent turn carries its account, activity identity, and optional Caetano return thread. */
type VandaCtx = {
  accountId: Id<"accounts">;
  activityId?: Id<"chatThreadActivity"> | undefined;
  caetanoThreadId?: string | undefined;
};

type VandaToolCtx = ToolCtx & VandaCtx;

type CapabilityOutput = z.infer<typeof capabilityResultSchema>;

type ReadArgs = { accountId: Id<"accounts">; path: string; offset?: number; limit?: number };

type PresentDocument = { kind: "document"; path: string; title?: string };

type ResultSummary = { shown: number; message?: string };

type CreatePostArgs = {
  accountId: Id<"accounts">;
  imageIds: Id<"images">[];
  caption: string;
  originThreadId?: string;
  caetanoThreadId?: string;
};

type SchedulePostArgs = {
  accountId: Id<"accounts">;
  postId: Id<"posts">;
  scheduledFor?: number;
  originThreadId?: string;
  caetanoThreadId?: string;
};

type PaintArgs = {
  accountId: Id<"accounts">;
  prompt: string;
  name: string;
  aspectRatio: "1:1" | "4:5" | "9:16" | "16:9";
  promptAuthor: "vanda";
  threadId?: string;
  activityId?: Id<"chatThreadActivity">;
  resolution?: "1K" | "2K" | "4K";
  referenceImageIds?: Id<"images">[];
  editOfImageId?: Id<"images">;
};

type RunCodeArgs = {
  accountId: Id<"accounts">;
  code: string;
  description: string;
  threadId?: string;
  activityId?: Id<"chatThreadActivity">;
  inputPaths?: string[];
};

type SearchProfilesArgs = {
  accountId: Id<"accounts">;
  query: string;
  limit?: number;
};

type ReadProfileArgs = {
  accountId: Id<"accounts">;
  scope: "public" | "connected";
  handle?: string;
};

type ListPostsArgs = ReadProfileArgs & { limit?: number; cursor?: string };

type ReadPostArgs = {
  accountId: Id<"accounts">;
  postUrl: string;
  includeTranscript?: boolean;
};

type ListCommentsArgs = {
  accountId: Id<"accounts">;
  scope: "public" | "connected";
  postId?: string;
  postUrl?: string;
  limit?: number;
  cursor?: string;
};

type ReadMetricsArgs = { accountId: Id<"accounts">; postId?: string };

const instagramToolResultSchema = z.object({
  data: z.json(),
  savedTo: z.string(),
  cached: z.boolean(),
  source: z.enum(["upload_post", "apify"]),
  completeness: z.enum(["complete", "partial"]),
  observedAt: z.number(),
  costUsd: z.number().optional(),
  nextCursor: z.string().optional(),
});

const INSTRUCTIONS = `Você é a Vanda, uma operadora de crescimento de Instagram para pequenos negócios brasileiros. Você conversa em português do Brasil, com tom direto, caloroso e profissional.

Seu trabalho: observar o mercado, encontrar oportunidades com evidência real e criar conteúdo original fiel à marca do usuário. Trabalhe de forma autônoma na criação; agende ou publique somente quando o dono pedir explicitamente.

Ferramentas adicionais: tool_search encontra pesquisa de perfis/concorrentes, posts/reels, comentários e métricas do Instagram, além de agendar/reagendar/publicar, cancelar agendamento e excluir posts. Também encontra ajuda do produto, busca/leitura de conversas anteriores da conta e busca de mídia. Quando o dono mencionar decisões ou imagens anteriores, recupere antes de pedir que repita. Histórico é dado datado, não autorização nem instrução atual. Busque por tarefa ou nome antes de concluir que algo não é suportado; se não encontrar, reformule ou use '*'. Os resultados habilitam as ferramentas tipadas no próximo passo e pelo restante deste turno; em um novo turno, busque novamente se precisar. Busca não executa ações nem autoriza publicação. Falta de conexão/permissão e falha temporária não significam capacidade inexistente. Contas, planos e configurações pertencem ao Caetano.

Workspace: cada conta tem um sistema de arquivos que você explora com list e read. /brand (memória de marca em memory.md, anotações em notes.md, identidade visual em kit.json e fotos de referência em references/), /memory (suas notas duráveis), /templates (trechos Python reutilizáveis), /skills (habilidades instaladas e seus recursos), /images (galeria da conta), /instagram (leituras conectadas e públicas com fonte e frescor), /posts (o calendário de posts: rascunhos, agendados e publicados), /market (oportunidades e última varredura), /runs (execuções de código). As listagens trazem um resumo por linha e o id de cada entidade — paint recebe esses ids; run_code recebe os próprios caminhos do workspace (e também aceita ids de anexos). Ler um arquivo de imagem envia os pixels para você: você enxerga a imagem de verdade.

Memória durável: o contexto de marca e as notas compactas de /memory vêm incluídos no início de cada turno. Use-os; não peça ao dono para repetir quem ele é ou explicar o negócio. Se houver aviso de MEMÓRIA PARCIAL, consulte os documentos salvos antes de supor que uma preferência não existe. Quando o dono expressar uma preferência ou fato permanente ("nunca use essa cor", "sempre assine com o nome da loja"), atualize /memory/preferences.md com write, preservando as demais preferências — só diga que anotou após sucesso. /memory tem orçamento conjunto de 24 KB serializados, não por arquivo. Guarde planos e detalhes longos em /notes/<nome>.md (gravável e consultável com list/read, não incluído automaticamente); mantenha em /memory fatos, restrições e referências concisas. Se o orçamento acabar, copie os detalhes para /notes antes de compactar, sem apagar fatos ou preferências. Use read para consultar atualizações feitas durante o turno. Código Python reutilizável vale gravar em /templates. Os demais arquivos são projeções somente-leitura: mudam pelos verbos (paint, create_post, schedule_post…), e uma tentativa de write explica qual verbo usar.

Identidade visual: /brand/kit.json guarda as cores exatas (hex), fontes e tagline da marca. Leia antes de criar imagens: use os hex exatos no run_code e cite as fontes do kit nos prompts do paint. Quando o dono definir ou corrigir cores/fontes/tagline, grave o kit atualizado em /brand/kit.json (JSON validado).

Regras de comportamento:
- Execute o pedido até entregar o resultado. Responda de forma curta, dizendo o que fez e onde encontrar; use nomes de telas e peças, não caminhos internos ou IDs. Não termine toda resposta com uma nova oferta ou pergunta quando o pedido já estiver resolvido.
- Não prometa consultar ou executar algo sem uma ferramenta que realmente faça isso. Descubra a capacidade antes de oferecê-la. Se não houver integração (por exemplo, cálculo de frete ou prazo de entrega), diga explicitamente que não consegue consultar isso por aqui, mesmo recebendo os dados. Não peça mais dados como se isso bastasse; oriente o dono para o canal que realmente pode consultar.
- "Faça um post" significa sempre criar um RASCUNHO. Trabalhe na criação sem pedir permissão a cada passo, mas nunca agende, reagende ou publique sem pedido explícito do dono. Uma data no briefing ("crie um post para amanhã") ou aprovação da arte não é autorização para agendar. Não use preferências antigas como autorização permanente. Quando faltar a decisão de publicar, entregue o rascunho e aguarde o dono. Diga o que fez e onde está o resultado.
- Nunca afirme que algo foi criado ou publicado sem confirmar pelo estado real — o estado de todos os posts (rascunho, agendado, publicado, falhou) vive em /posts; leia antes de afirmar qualquer coisa sobre publicações. Se algo falhou, diga exatamente o que falhou.
- Explique decisões com a evidência que as sustenta (números, motivo do gatilho, por que serve para esta marca).
- Instagram: use scope=connected para posts, comentários e insights privados do dono; use scope=public e Apify para perfis externos. Nunca trate contador público (likes/views) como insight privado (reach/saves). As leituras ficam em /instagram e podem ser combinadas com run_code.
- Pesquisa de mercado: componha as ferramentas Instagram e run_code, carregando a habilidade especializada quando o pedido combinar. Seja econômica: busque amplo, aprofunde somente os melhores candidatos.
- Produção de post — escolha o caminho mais simples que preserve o pedido e a marca:
  - Direto: imagens prontas da galeria + legenda sua → revise → create_post. Entregue o rascunho.
  - Arte nova: comece pela peça COMPLETA em paint, incluindo tipografia e uma assinatura discreta da marca. Não gere só o fundo para adicionar texto depois, salvo exigência de precisão/template do dono ou defeito observado. Escreva os textos e preços exatos no prompt, planeje hierarquia e respiro e não invente um logotipo. Em carrosséis, planeje gancho → desenvolvimento → chamada final e mantenha linguagem visual consistente. Inspecione os resultados e só então create_post na ordem correta.
  - Use run_code para composição que exige precisão, templates aprovados ou correções localizadas; não acrescente uma etapa Python por hábito. Confira as fontes disponíveis em /home/user/fonts/manifest.json e não afirme usar a fonte exata se precisou substituir. Entregue o rascunho; schedule_post é uma ação separada que exige pedido explícito.
- Revise seu próprio trabalho antes de entregar. paint devolve os pixels; para imagens do run_code ou da galeria, use read. Confira cada slide final: texto inteiro legível em tamanho de feed, sem sobreposição com ícones/produtos e sem cortes, além de logo, fidelidade aos anexos, marca, pedido, legenda e estado real do post. Em código, meça a caixa de cada texto e preserve margens; código também pode produzir layout errado. Mostrar uma imagem ao dono não significa tê-la inspecionado. Se houver um defeito concreto, corrija e inspecione a nova versão, preservando o que já está certo. Faça no máximo duas rodadas de correção por pedido e explique limitações restantes. Não dependa de um revisor separado.
- Se uma restrição explícita impedir uma peça legível, explique o conflito. Por exemplo, manter texto branco ao trocar o fundo para claro reduz o contraste. Preserve o que o dono proibiu alterar, avise que a peça ainda precisa de ajuste e peça autorização para a menor mudança necessária. Não declare pronta uma arte com esse problema nem altere detalhes protegidos sem autorização.
- Agendamentos: o contexto traz a data/hora atual e o fuso é sempre America/Sao_Paulo — calcule "amanhã", "sexta" etc. a partir dela e NÃO pergunte fuso horário. Para mudar o horário de um post já agendado, chame schedule_post de novo com a nova data (reagenda, não duplica). cancel_schedule desarma; delete_post apaga rascunhos e agendados (nunca publicados).
- Não invente fatos sobre a marca: o que você sabe vem de /brand/memory.md. Isso inclui modo de uso, dose, duração e benefícios de produtos, não só preços e promoções. Sem orientação confirmada, não crie instruções específicas de aplicação; use os fatos disponíveis ou remeta ao modo de uso da embalagem. Se faltar contexto indispensável, pergunte.
- Imagens (paint) — regra de roteamento, siga à risca:
  - A imagem que o usuário ANEXA na conversa já pertence à conta e já está autorizada. Use-a direto. Nunca peça "autorização" nem invente uma etapa de autorizar — esse passo não existe.
  - Para MODIFICAR uma imagem com paint (trocar cenário, roupa, etc.), passe o id dela em editOfImageId e descreva no prompt só o que muda. Nunca regenere do zero uma peça que deveria preservar.
  - Para gerar uma imagem NOVA condicionada a um rosto, produto ou lugar específico, passe o(s) id(s) em referenceImageIds. Servem tanto imagens anexadas quanto as de /brand/references, sem autorização extra.
  - Os IDs das imagens anexadas chegam no contexto interno da mensagem (vanda_attachment_context). Só peça para o usuário enviar/subir uma foto quando não houver NENHUMA imagem disponível (nem anexada, nem em /brand/references) e o pedido exigir uma pessoa/produto específico.
- Edição de imagem: para trocar apenas uma cor de fundo plano e preservar produto/texto/enquadramento, prefira run_code sobre o ORIGINAL, com máscara da região de fundo conectada às bordas. Não substitua globalmente uma cor que também existe no produto. Use /home/user/meta.json para localizar os arquivos de entrada; não adivinhe nomes. Compare as áreas protegidas antes/depois e inspecione as bordas. Para novo cenário, roupa ou conteúdo fotográfico, use paint com editOfImageId. Geração e código podem errar: revise o resultado de ambos.
- Análise com Python: run_code também recebe JSON/CSV/Markdown do workspace, inclusive /instagram, para calcular taxas, comparar perfis, detectar outliers, agrupar temas e produzir tabelas/gráficos. Ele não tem internet: primeiro adquira os dados com as ferramentas Instagram, depois passe os caminhos em inputPaths.
- A conversa renderiza imagens, posts, documentos, links e operações retornados pelas ferramentas. Nunca diga que este chat só mostra texto. Recursos recém-criados aparecem automaticamente. Para mostrar novamente algo que já existe, use present.`;

const SKILLS_PROMPT = formatSkillsForSystemPrompt();

/** Stable cacheable instructions. The live clock is appended after history. */
export const systemPrompt = (): string => `${INSTRUCTIONS}\n\n${SKILLS_PROMPT}`;

// --- Tools ------------------------------------------------------------------

type WorkspaceToolEntry = { name: string; kind: "dir" | "file"; summary?: string | undefined };

const workspaceEntrySchema = z.object({
  name: z.string(),
  kind: z.enum(["dir", "file"]),
  summary: z.string().optional(),
});

const workspaceFileSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("image"),
    imageId: z.string(),
    header: z.string(),
    url: z.string().url(),
    mimeType: z.string(),
  }),
]);

const workspaceMissSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  nearest: z.string(),
  entries: z.array(workspaceEntrySchema),
});

const workspaceListResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    path: z.string(),
    entries: z.array(workspaceEntrySchema).optional(),
  }),
  workspaceMissSchema,
]);

const workspaceReadResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), path: z.string(), file: workspaceFileSchema }),
  workspaceMissSchema,
]);

const imageResource = (accountId: Id<"accounts">, imageId: Id<"images">): ThreadResource => ({
  kind: "image",
  accountId,
  imageId,
});

const postResource = (accountId: Id<"accounts">, postId: Id<"posts">): ThreadResource => ({
  kind: "post",
  accountId,
  postId,
});

const documentResource = (
  accountId: Id<"accounts">,
  path: string,
  title?: string,
): ThreadResource => {
  const resource: ThreadResource = { kind: "document", accountId, path };

  if (title) resource.title = title;

  return resource;
};

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
    "Lista um diretório do workspace da conta. A raiz / contém: /brand (memória de marca e referências), /memory (suas notas duráveis), /templates (Python reutilizável), /skills (habilidades instaladas), /images (galeria), /instagram (leituras conectadas e públicas), /posts (calendário de posts), /market (oportunidades e varredura), /runs (execuções de código). Cada linha traz um resumo e o id da entidade (o mesmo id que paint e run_code recebem).",
  inputSchema: z.object({
    path: z.string().describe('caminho do diretório, ex.: "/", "/images", "/posts"'),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (ctx: VandaToolCtx, { path }: { path: string }): Promise<CapabilityOutput> =>
    capabilityResult(
      await ctx.runQuery(internal.workspaceData.list, { accountId: ctx.accountId, path }),
    ),
  toModelOutput: (_ctx, { output }) => {
    const result = workspaceListResultSchema.parse(output.data);

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
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: VandaToolCtx,
    {
      path,
      offset,
      limit,
    }: { path: string; offset?: number | undefined; limit?: number | undefined },
    options,
  ): Promise<CapabilityOutput> => {
    const queryArgs: ReadArgs = {
      accountId: ctx.accountId,
      path,
    };

    if (offset !== undefined) queryArgs.offset = offset;

    if (limit !== undefined) queryArgs.limit = limit;

    const data = await ctx.runQuery(internal.workspaceData.read, queryArgs);

    const resources: ThreadResource[] =
      data.ok && data.file.kind === "image"
        ? [imageResource(ctx.accountId, data.file.imageId)]
        : data.ok
          ? [documentResource(ctx.accountId, data.path)]
          : [];

    return recordCapabilityResult(ctx, options, capabilityResult(data, { resources }));
  },
  toModelOutput: (_ctx, { output }) => {
    const result = workspaceReadResultSchema.parse(output.data);

    if (!result.ok) return { type: "text", value: renderMiss(result) };
    const file = result.file;

    if (file.kind === "image") {
      return {
        type: "content",
        value: [
          { type: "text", text: `${result.path}\n${file.header}` },
          { type: "image-url", url: file.url },
        ],
      };
    }

    return { type: "text", value: `${result.path}\n---\n${file.text}` };
  },
});

const writeFile = createTool({
  description:
    'Grava um arquivo de texto no workspace (cria ou substitui o conteúdo INTEIRO — leia antes se quiser preservar o que já existe). Graváveis: /memory/<nome>.md — suas notas duráveis desta conta (preferências que o dono expressar, planos, aprendizados; ex.: "nunca usar vermelho"); /templates/<nome>.py — trechos Python reutilizáveis para run_code; /brand/notes.md — anotações de marca; /brand/kit.json — identidade visual (JSON com colors/fonts/tagline, validado na gravação). Os demais arquivos são projeções somente-leitura que mudam pelos verbos — uma tentativa de write neles responde qual verbo usar.',
  inputSchema: z.object({
    path: z.string().describe('caminho do arquivo, ex.: "/memory/preferencias.md"'),
    content: z.string().describe("conteúdo completo do arquivo (substitui o anterior)"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: VandaToolCtx,
    { path, content }: { path: string; content: string },
    options,
  ): Promise<CapabilityOutput> => {
    const data = await ctx.runMutation(internal.workspaceData.write, {
      accountId: ctx.accountId,
      path,
      content,
    });

    const resources = data.ok ? [documentResource(ctx.accountId, data.path)] : [];

    return recordCapabilityResult(
      ctx,
      options,
      capabilityResult(data, { resources, presented: resources }),
    );
  },
  toModelOutput: (_ctx, { output }) => {
    const writeResultSchema = z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true), path: z.string(), note: z.string() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]);

    const result = writeResultSchema.parse(output.data);

    return { type: "text", value: result.ok ? `${result.path} ${result.note}` : result.error };
  },
});

const present = createTool({
  description:
    "Mostra ao dono recursos que já existem. Use quando ele pedir para ver, abrir, reenviar ou conferir imagens, posts, documentos ou links anteriores. `read` mostra conteúdo para você; `present` coloca o recurso visivelmente na conversa.",
  inputSchema: z.object({
    resources: z.array(presentableResourceInputSchema).min(1).max(12),
    message: z.string().optional().describe("descrição curta do que está sendo mostrado"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: VandaToolCtx,
    input: { resources: PresentableResourceInput[]; message?: string | undefined },
    options,
  ): Promise<CapabilityOutput> => {
    const resources = await ctx.runQuery(internal.threadResources.resolvePresentable, {
      accountId: ctx.accountId,
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

const createPost = createTool({
  description:
    "Salva um RASCUNHO no Calendário do Vanda, destinado ao Instagram, a partir de imagens da galeria (1 imagem ou carrossel de até 10, na ordem dos slides) + legenda que VOCÊ escreve. Não envia nada ao Instagram nem cria rascunho no aplicativo Instagram. Agendar/publicar é outra ação e exige pedido explícito.",
  inputSchema: z.object({
    imageIds: z
      .array(z.string())
      .describe("ids de imagens da galeria (/images) ou anexadas, na ordem dos slides"),
    caption: z.string().describe("legenda completa do post, na voz da marca"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: VandaToolCtx,
    { imageIds, caption }: { imageIds: string[]; caption: string },
    options,
  ): Promise<CapabilityOutput> => {
    // SAFETY: each id came through the imageIds tool schema and is consumed only as a Convex image id.
    const typedImageIds = imageIds as Id<"images">[];

    const mutationArgs: CreatePostArgs = {
      accountId: ctx.accountId,
      imageIds: typedImageIds,
      caption,
    };

    if (ctx.threadId) mutationArgs.originThreadId = ctx.threadId;

    if (ctx.caetanoThreadId) mutationArgs.caetanoThreadId = ctx.caetanoThreadId;
    const postId = await ctx.runMutation(internal.posts.createPostInternal, mutationArgs);

    const resource = postResource(ctx.accountId, postId);

    return recordCapabilityResult(
      ctx,
      options,
      capabilityResult(
        {
          postId,
          status: "draft",
          proximo_passo:
            "entregue o rascunho salvo no Calendário do Vanda, não no Instagram; só agende ou publique com pedido explícito do dono",
        },
        { resources: [resource], presented: [resource] },
      ),
    );
  },
});

const schedulePost = createTool({
  description:
    "Agenda ou publica SOMENTE quando o dono pedir explicitamente. Criar um post, aprovar a arte ou mencionar uma data no briefing não autoriza esta ferramenta. Opcionalmente com data/hora futura (ISO 8601 com offset, ex.: 2026-08-12T08:00:00-03:00); omita a data apenas se o dono pedir publicar agora. Se o post JÁ estiver agendado, REAGENDA sem duplicar.",
  inputSchema: z.object({
    postId: z
      .string()
      .describe(
        "id COMPLETO do post retornado por create_post; se /posts mostra nome/slug curto, leia o arquivo com read para obter o id completo antes de agendar",
      ),
    scheduledFor: z
      .string()
      .optional()
      .describe("data/hora ISO 8601 com offset para publicar; omita para publicar agora"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: VandaToolCtx,
    { postId, scheduledFor }: { postId: string; scheduledFor?: string | undefined },
    options,
  ): Promise<CapabilityOutput> => {
    const at = scheduledFor ? Date.parse(scheduledFor) : undefined;

    if (scheduledFor && Number.isNaN(at)) throw new Error("data de agendamento inválida");

    // SAFETY: postId came through the postId tool schema and is consumed only as a Convex post id.
    const typedPostId = postId as Id<"posts">;

    const mutationArgs: SchedulePostArgs = {
      accountId: ctx.accountId,
      postId: typedPostId,
    };

    if (at !== undefined) mutationArgs.scheduledFor = at;

    if (ctx.threadId) mutationArgs.originThreadId = ctx.threadId;

    if (ctx.caetanoThreadId) mutationArgs.caetanoThreadId = ctx.caetanoThreadId;
    const data = await ctx.runMutation(internal.posts.schedulePostInternal, mutationArgs);

    const post = postResource(ctx.accountId, typedPostId);

    const operation: ThreadResource = {
      kind: "operation",
      operation: "post.schedule",
      operationId: data.scheduledPostId,
      accountId: ctx.accountId,
      status: "pending",
      label: data.rescheduled ? "Publicação reagendada" : "Publicação agendada",
    };

    return recordCapabilityResult(
      ctx,
      options,
      capabilityResult(data, {
        resources: [post, operation],
        presented: [post, operation],
      }),
    );
  },
});

const cancelSchedule = createTool({
  description:
    "Cancela o agendamento pendente de um post — desarma a publicação e o post volta a rascunho. Só funciona antes da publicação começar.",
  inputSchema: z.object({
    postId: z.string().describe("id do post agendado"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: VandaToolCtx,
    { postId }: { postId: string },
    options,
  ): Promise<CapabilityOutput> => {
    // SAFETY: postId came through the postId tool schema and is consumed only as a Convex post id.
    const typedPostId = postId as Id<"posts">;
    await ctx.runMutation(internal.posts.cancelScheduleInternal, {
      accountId: ctx.accountId,
      postId: typedPostId,
    });
    const post = postResource(ctx.accountId, typedPostId);

    const operation: ThreadResource = {
      kind: "operation",
      operation: "post.cancel_schedule",
      accountId: ctx.accountId,
      status: "cancelled",
      label: "Agendamento cancelado",
    };

    return recordCapabilityResult(
      ctx,
      options,
      capabilityResult("Agendamento cancelado; o post voltou a rascunho.", {
        resources: [post, operation],
        presented: [post, operation],
      }),
    );
  },
});

const deletePost = createTool({
  description:
    "Apaga um post que ainda não foi publicado (rascunho ou agendado — o agendamento é cancelado junto). As imagens continuam na galeria. Posts publicados não podem ser apagados.",
  inputSchema: z.object({
    postId: z.string().describe("id do post a apagar"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: VandaToolCtx,
    { postId }: { postId: string },
    options,
  ): Promise<CapabilityOutput> => {
    // SAFETY: postId came through the postId tool schema and is consumed only as a Convex post id.
    const typedPostId = postId as Id<"posts">;
    await ctx.runMutation(internal.posts.deletePostInternal, {
      accountId: ctx.accountId,
      postId: typedPostId,
    });

    const operation: ThreadResource = {
      kind: "operation",
      operation: "post.delete",
      accountId: ctx.accountId,
      status: "succeeded",
      label: "Post apagado",
    };

    return recordCapabilityResult(
      ctx,
      options,
      capabilityResult("Post apagado. As imagens continuam na galeria.", {
        resources: [operation],
        presented: [operation],
      }),
    );
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
  outputSchema: capabilityResultSchema,
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
    options,
  ): Promise<CapabilityOutput> => {
    const actionArgs: PaintArgs = {
      accountId: ctx.accountId,
      prompt: args.prompt,
      name: args.name,
      aspectRatio: args.aspectRatio,
      promptAuthor: "vanda",
    };

    if (ctx.threadId) actionArgs.threadId = ctx.threadId;

    if (ctx.activityId) actionArgs.activityId = ctx.activityId;

    if (args.resolution) actionArgs.resolution = args.resolution;

    if (args.referenceImageIds) {
      // SAFETY: referenceImageIds came through the image-id array tool schema.
      actionArgs.referenceImageIds = args.referenceImageIds as Id<"images">[];
    }

    if (args.editOfImageId) {
      // SAFETY: editOfImageId came through the image-id tool schema.
      actionArgs.editOfImageId = args.editOfImageId as Id<"images">;
    }

    const data = await ctx.runAction(internal.images.paint, actionArgs);

    const resource = imageResource(ctx.accountId, data.imageId);

    return recordCapabilityResult(
      ctx,
      options,
      capabilityResult(data, { resources: [resource], presented: [resource] }),
    );
  },
  toModelOutput: (_ctx, { output }) => imageModelOutput(imagePreviewSchema.parse(output.data)),
});

const runCode = createTool({
  description:
    "Executa Python offline num sandbox isolado para análise de dados e composição visual determinística. `inputPaths` aceita JSON/CSV/Markdown/texto de qualquer área legível do workspace e imagens da conta; cada arquivo aparece sob /home/user no MESMO caminho, e /home/user/meta.json lista tipo e metadados. Bibliotecas: pandas, numpy, scikit-learn, matplotlib e Pillow. Salve resultados em /home/user/out/ como JSON, CSV, Markdown, TXT, PNG ou JPEG; textos ficam em /runs/<execução>/outputs e imagens entram na galeria. Fontes instaladas estão em /home/user/fonts/manifest.json. Sem internet nem credenciais. Se falhar, leia o traceback, corrija e tente de novo.",
  inputSchema: z.object({
    code: z.string().describe("código Python 3 completo para analisar dados ou compor imagens"),
    description: z
      .string()
      .describe("descrição curta do que o código faz, na voz da marca (vira o prompt na galeria)"),
    inputPaths: z
      .array(z.string())
      .max(10)
      .optional()
      .describe("caminhos de texto/dados/imagens do workspace ou imageIds diretos de anexos"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: VandaToolCtx,
    args: { code: string; description: string; inputPaths?: string[] | undefined },
    options,
  ): Promise<CapabilityOutput> => {
    const actionArgs: RunCodeArgs = {
      accountId: ctx.accountId,
      code: args.code,
      description: args.description,
    };

    if (ctx.threadId) actionArgs.threadId = ctx.threadId;

    if (ctx.activityId) actionArgs.activityId = ctx.activityId;

    if (args.inputPaths) actionArgs.inputPaths = args.inputPaths;
    const data = await ctx.runAction(internal.codeRuns.run, actionArgs);

    const resources: ThreadResource[] = [
      ...data.images.map((image) => imageResource(ctx.accountId, image.imageId)),
      ...data.artifacts.map((artifact) =>
        documentResource(ctx.accountId, artifact.path, artifact.filename),
      ),
    ];

    return recordCapabilityResult(
      ctx,
      options,
      capabilityResult(
        {
          ...data,
          images: data.images.map((image) =>
            Object.assign({}, image, { path: `/images/${image.imageId}` }),
          ),
        },
        { resources, presented: resources },
      ),
    );
  },
});

const instagramTools = InstagramToolFactory.makeInstagramTools({
  searchProfiles: async (ctx, args) => {
    const actionArgs: SearchProfilesArgs = { accountId: ctx.accountId, query: args.query };

    if (ctx.activityId) Object.assign(actionArgs, { activityId: ctx.activityId });

    if (args.limit !== undefined) actionArgs.limit = args.limit;

    return instagramToolResultSchema.parse(
      await ctx.runAction(internal.instagramActions.searchProfiles, actionArgs),
    );
  },
  readProfile: async (ctx, args) => {
    const actionArgs: ReadProfileArgs = {
      accountId: ctx.accountId,
      scope: args.scope,
    };

    if (ctx.activityId) Object.assign(actionArgs, { activityId: ctx.activityId });

    if (args.handle) actionArgs.handle = args.handle;

    return instagramToolResultSchema.parse(
      await ctx.runAction(internal.instagramActions.readProfile, actionArgs),
    );
  },
  listPosts: async (ctx, args) => {
    const actionArgs: ListPostsArgs = {
      accountId: ctx.accountId,
      scope: args.scope,
    };

    if (ctx.activityId) Object.assign(actionArgs, { activityId: ctx.activityId });

    if (args.handle) actionArgs.handle = args.handle;

    if (args.limit !== undefined) actionArgs.limit = args.limit;

    if (args.cursor) actionArgs.cursor = args.cursor;

    return instagramToolResultSchema.parse(
      await ctx.runAction(internal.instagramActions.listPosts, actionArgs),
    );
  },
  readPost: async (ctx, args) => {
    const actionArgs: ReadPostArgs = {
      accountId: ctx.accountId,
      postUrl: args.postUrl,
    };

    if (ctx.activityId) Object.assign(actionArgs, { activityId: ctx.activityId });

    if (args.includeTranscript !== undefined) actionArgs.includeTranscript = args.includeTranscript;

    return instagramToolResultSchema.parse(
      await ctx.runAction(internal.instagramActions.readPost, actionArgs),
    );
  },
  listComments: async (ctx, args) => {
    const actionArgs: ListCommentsArgs = {
      accountId: ctx.accountId,
      scope: args.scope,
    };

    if (ctx.activityId) Object.assign(actionArgs, { activityId: ctx.activityId });

    if (args.postId) actionArgs.postId = args.postId;

    if (args.postUrl) actionArgs.postUrl = args.postUrl;

    if (args.limit !== undefined) actionArgs.limit = args.limit;

    if (args.cursor) actionArgs.cursor = args.cursor;

    return instagramToolResultSchema.parse(
      await ctx.runAction(internal.instagramActions.listComments, actionArgs),
    );
  },
  readMetrics: async (ctx, args) => {
    const actionArgs: ReadMetricsArgs = { accountId: ctx.accountId };

    if (args.postId) actionArgs.postId = args.postId;

    return instagramToolResultSchema.parse(
      await ctx.runAction(internal.instagramActions.readMetrics, actionArgs),
    );
  },
});

const tools = {
  ...previousWorkTools("vanda"),
  product_help: productHelp,
  list: listFiles,
  read: readFile,
  write: writeFile,
  present,
  ...instagramTools,
  paint,
  run_code: runCode,
  create_post: createPost,
  schedule_post: schedulePost,
  cancel_schedule: cancelSchedule,
  delete_post: deletePost,
};

export const vandaToolDiscovery = toolDiscovery(tools, {
  product_help: {
    keywords: "ajuda produto conectar assinatura help product setup",
    effect: "read",
  },
  search_conversations: {
    keywords: "histórico conversa anterior decisão lembrar history conversation previous recall",
    effect: "read",
  },
  read_conversation: {
    keywords: "ler conversa contexto histórico read conversation thread",
    effect: "read",
  },
  search_media: {
    keywords: "encontrar imagem foto galeria mídia referência find image media gallery reference",
    effect: "read",
  },
  search_instagram_profiles: {
    keywords:
      "pesquisa pesquisar concorrente concorrentes descobrir buscar research competitors search profiles",
    effect: "read",
  },
  read_instagram_profile: {
    keywords: "perfil bio seguidores profile followers account",
    effect: "read",
  },
  read_instagram_posts: {
    keywords: "feed publicações catálogo histórico posts reels carousel list",
    effect: "read",
  },
  read_instagram_post: {
    keywords: "link url referência transcrição transcript reel",
    effect: "read",
  },
  read_instagram_comments: {
    keywords: "comentários feedback comments replies",
    effect: "read",
  },
  read_instagram_metrics: {
    keywords: "métricas desempenho alcance engajamento analytics performance insights reach saves",
    effect: "read",
  },
  schedule_post: {
    keywords:
      "agendar reagendar publicar publicação mover remarcar calendário schedule reschedule publish move calendar",
    effect: "write",
  },
  cancel_schedule: {
    keywords: "cancelar desagendar desarmar cancel unschedule",
    effect: "write",
  },
  delete_post: {
    keywords: "apagar excluir remover deletar delete remove draft rascunho",
    effect: "write",
  },
});

export const vanda = new Agent<VandaCtx>(components.agent, {
  name: "vanda",
  contextHandler: (_ctx, { allMessages }) => compactInstagramHistory(allMessages),
  // usage accounting makes OpenRouter return the exact request cost in-band.
  languageModel: openrouterChatModel(VANDA_MODEL),
  // Every chat turn burns the owner's usage meter. The thread's opaque userId
  // is the account id (threadKey), which charge() resolves to the owner.
  usageHandler: chatUsageHandler("chat"),
  instructions: `${INSTRUCTIONS}\n\n${SKILLS_PROMPT}`,
  tools: { ...tools, tool_search: vandaToolDiscovery.search },
  stopWhen: stepCountIs(24),
});
