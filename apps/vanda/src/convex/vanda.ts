import { Agent, createTool, stepCountIs, type ToolCtx } from "@convex-dev/agent";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_ORCHESTRATOR_MODEL } from "./agentModels";
import { capabilityResult, capabilityResultSchema, type ThreadResource } from "./resourceRefs";
import { formatSkillsForSystemPrompt } from "./skills/catalog";
import { makeInstagramTools } from "./tools/instagram";

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

/** Every agent turn carries the account the thread belongs to. */
type VandaCtx = { accountId: Id<"accounts"> };
type VandaToolCtx = ToolCtx & VandaCtx;

const INSTRUCTIONS = `Você é a Vanda, uma operadora de crescimento de Instagram para pequenos negócios brasileiros. Você conversa em português do Brasil, com tom direto, caloroso e profissional.

Seu trabalho: observar o mercado, encontrar oportunidades com evidência real, criar conteúdo original fiel à marca do usuário e publicar de forma autônoma e transparente.

Workspace: cada conta tem um sistema de arquivos que você explora com list e read. /brand (memória de marca em memory.md, anotações em notes.md, identidade visual em kit.json e fotos de referência em references/), /memory (suas notas duráveis), /templates (trechos Python reutilizáveis), /skills (habilidades instaladas e seus recursos), /images (galeria da conta), /instagram (leituras conectadas e públicas com fonte e frescor), /posts (o calendário de posts: rascunhos, agendados e publicados), /market (oportunidades e última varredura), /runs (execuções de código). As listagens trazem um resumo por linha e o id de cada entidade — paint recebe esses ids; run_code recebe os próprios caminhos do workspace (e também aceita ids de anexos). Ler um arquivo de imagem envia os pixels para você: você enxerga a imagem de verdade.

Memória durável: quando o dono expressar uma preferência ou fato permanente no meio da conversa ("nunca use essa cor", "sempre assine com o nome da loja"), grave em /memory com write antes de seguir — e diga que anotou. Ao começar um trabalho de criação, liste /memory e leia as notas relevantes; o que não está gravado será esquecido entre conversas. Código Python que deu certo e tende a se repetir vale gravar em /templates. Os demais arquivos são projeções somente-leitura: eles mudam pelos verbos (paint, create_post, schedule_post…), e uma tentativa de write neles explica qual verbo usar.

Identidade visual: /brand/kit.json guarda as cores exatas (hex), fontes e tagline da marca. Leia antes de criar imagens: use os hex exatos no run_code e cite as fontes do kit nos prompts do paint. Quando o dono definir ou corrigir cores/fontes/tagline, grave o kit atualizado em /brand/kit.json (JSON validado).

Regras de comportamento:
- Você é uma operadora, não um chatbot passivo: sempre termine propondo a próxima ação concreta.
- Você age por conta própria — não peça permissão para trabalhar. Em vez de gates de aprovação, a sua obrigação é transparência: diga o que fez, onde está o resultado (/posts, calendário, galeria) e como desfazer (schedule_post reagenda, cancel_schedule desarma, delete_post apaga). Quando o pedido for ambíguo sobre PUBLICAR de imediato, prefira agendar para um horário próximo e avisar — o dono vê no calendário e pode mudar.
- Nunca afirme que algo foi criado ou publicado sem confirmar pelo estado real — o estado de todos os posts (rascunho, agendado, publicado, falhou) vive em /posts; leia antes de afirmar qualquer coisa sobre publicações. Se algo falhou, diga exatamente o que falhou.
- Explique decisões com a evidência que as sustenta (números, motivo do gatilho, por que serve para esta marca).
- Instagram: use scope=connected para posts, comentários e insights privados do dono; use scope=public e Apify para perfis externos. Nunca trate contador público (likes/views) como insight privado (reach/saves). As leituras ficam em /instagram e podem ser combinadas com run_code.
- Pesquisa de mercado: componha as ferramentas Instagram e run_code, carregando a habilidade especializada quando o pedido combinar. Seja econômica: busque amplo, aprofunde somente os melhores candidatos.
- Produção de post — um único caminho, escale o capricho conforme o pedido:
  - Direto: imagens prontas da galeria + legenda sua → create_post → schedule_post.
  - Produzido (carrossel com arte): planeje os slides primeiro (gancho → desenvolvimento → chamada final), gere a arte de cada slide com paint e componha texto/logo/cores exatas com run_code (um script por carrossel garante consistência entre slides — salve em /templates se ficar bom), avalie visualmente lendo as imagens, e só então create_post com os slides na ordem + schedule_post.
- Agendamentos: o contexto traz a data/hora atual e o fuso é sempre America/Sao_Paulo — calcule "amanhã", "sexta" etc. a partir dela e NÃO pergunte fuso horário. Para mudar o horário de um post já agendado, chame schedule_post de novo com a nova data (reagenda, não duplica). cancel_schedule desarma; delete_post apaga rascunhos e agendados (nunca publicados).
- Não invente fatos sobre a marca: o que você sabe vem de /brand/memory.md. Se faltar contexto, pergunte ou peça para completar o perfil.
- Imagens (paint) — regra de roteamento, siga à risca:
  - A imagem que o usuário ANEXA na conversa já pertence à conta e já está autorizada. Use-a direto. Nunca peça "autorização" nem invente uma etapa de autorizar — esse passo não existe.
  - Para MODIFICAR uma imagem que já existe (trocar fundo, cenário, roupa, etc.), passe o id dela em editOfImageId e descreva no prompt só o que muda. É o caso quando o usuário anexa uma foto e pede para editá-la.
  - Para gerar uma imagem NOVA condicionada a um rosto, produto ou lugar específico, passe o(s) id(s) em referenceImageIds. Servem tanto imagens anexadas quanto as de /brand/references, sem autorização extra.
  - Os IDs das imagens anexadas chegam no contexto interno da mensagem (vanda_attachment_context). Só peça para o usuário enviar/subir uma foto quando não houver NENHUMA imagem disponível (nem anexada, nem em /brand/references) e o pedido exigir uma pessoa/produto específico.
- Edição de imagem — regra de roteamento entre paint e run_code: mudança GENERATIVA (trocar fundo, cenário, roupa, criar do zero) → paint. Composição DETERMINÍSTICA (texto sobre a imagem, logo, corte, redimensionar, colagem, moldura, cor exata da marca) → run_code. Texto renderizado por modelo generativo erra; texto composto por código não erra.
- Análise com Python: run_code também recebe JSON/CSV/Markdown do workspace, inclusive /instagram, para calcular taxas, comparar perfis, detectar outliers, agrupar temas e produzir tabelas/gráficos. Ele não tem internet: primeiro adquira os dados com as ferramentas Instagram, depois passe os caminhos em inputPaths.`;

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "" });
const SKILLS_PROMPT = formatSkillsForSystemPrompt();

/**
 * An OpenRouter chat model by id, with in-band usage accounting so the meter
 * charges the exact request cost. Used when the owner picked a model other
 * than the default; the agent's own `languageModel` covers the default.
 */
export const openrouterChatModel = (modelId: string) =>
  openrouter.chat(modelId, { usage: { include: true } });

/**
 * The per-turn system prompt: the static instructions plus a live clock.
 * Without it the model guesses what "amanhã" means — with it, relative
 * dates resolve deterministically in the account's timezone.
 */
export const systemPrompt = (): string => {
  const now = new Date();
  const stamp = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
  return `${INSTRUCTIONS}\n\n${SKILLS_PROMPT}\n\nAgora: ${stamp} (fuso America/Sao_Paulo, UTC-03:00). Em agendamentos, escreva datas ISO 8601 com o offset -03:00.`;
};

// --- Tools ------------------------------------------------------------------

type WorkspaceToolEntry = { name: string; kind: "dir" | "file"; summary?: string | undefined };
type WorkspaceToolResult =
  | { ok: true; path: string; entries?: WorkspaceToolEntry[]; file?: WorkspaceToolFile }
  | { ok: false; error: string; nearest: string; entries: WorkspaceToolEntry[] };
type WorkspaceToolFile =
  | { kind: "text"; text: string }
  | {
      kind: "image";
      imageId: Id<"images">;
      header: string;
      url: string;
      mimeType: string;
    };

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
): ThreadResource => ({
  kind: "document",
  accountId,
  path,
  ...(title ? { title } : {}),
});

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
  execute: async (ctx: VandaToolCtx, { path }: { path: string }): Promise<unknown> =>
    capabilityResult(
      await ctx.runQuery(internal.workspaceData.list, { accountId: ctx.accountId, path }),
    ),
  toModelOutput: (_ctx, { output }) => {
    const result = (output as { data: WorkspaceToolResult }).data;
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
  ): Promise<unknown> => {
    const data = await ctx.runQuery(internal.workspaceData.read, {
      accountId: ctx.accountId,
      path,
      ...(offset !== undefined ? { offset } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    const resources: ThreadResource[] =
      data.ok && data.file.kind === "image"
        ? [imageResource(ctx.accountId, data.file.imageId)]
        : data.ok
          ? [documentResource(ctx.accountId, data.path)]
          : [];
    return capabilityResult(data, { resources });
  },
  toModelOutput: (_ctx, { output }) => {
    const result = (output as { data: WorkspaceToolResult }).data;
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
  ): Promise<unknown> => {
    const data = await ctx.runMutation(internal.workspaceData.write, {
      accountId: ctx.accountId,
      path,
      content,
    });
    const resources = data.ok ? [documentResource(ctx.accountId, data.path)] : [];
    return capabilityResult(data, { resources, presented: resources });
  },
  toModelOutput: (_ctx, { output }) => {
    const result = (output as { data: unknown }).data as
      | { ok: true; path: string; note: string }
      | { ok: false; error: string };
    return { type: "text", value: result.ok ? `${result.path} ${result.note}` : result.error };
  },
});

const createPost = createTool({
  description:
    "Monta um RASCUNHO de post para o Instagram a partir de imagens da galeria (1 imagem ou carrossel de até 10, na ordem dos slides) + legenda que VOCÊ escreve. O rascunho é inofensivo — nada é publicado até schedule_post.",
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
  ): Promise<unknown> => {
    const postId = await ctx.runMutation(internal.posts.createPostInternal, {
      accountId: ctx.accountId,
      imageIds: imageIds as Id<"images">[],
      caption,
    });
    const resource = postResource(ctx.accountId, postId);
    return capabilityResult(
      {
        postId,
        status: "draft",
        proximo_passo: "use schedule_post para agendar ou publicar",
      },
      { resources: [resource], presented: [resource] },
    );
  },
});

const schedulePost = createTool({
  description:
    "Agenda a publicação de um post criado com create_post no Instagram conectado. Opcionalmente com data/hora futura (ISO 8601 com offset, ex.: 2026-08-12T08:00:00-03:00); sem data, publica imediatamente. Se o post JÁ estiver agendado, esta ferramenta REAGENDA: substitui o horário anterior, sem duplicar.",
  inputSchema: z.object({
    postId: z.string().describe("id do post (retornado por create_post ou listado em /posts)"),
    scheduledFor: z
      .string()
      .optional()
      .describe("data/hora ISO 8601 com offset para publicar; omita para publicar agora"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (
    ctx: VandaToolCtx,
    { postId, scheduledFor }: { postId: string; scheduledFor?: string | undefined },
  ): Promise<unknown> => {
    const at = scheduledFor ? Date.parse(scheduledFor) : undefined;
    if (scheduledFor && Number.isNaN(at)) throw new Error("data de agendamento inválida");
    const data = await ctx.runMutation(internal.posts.schedulePostInternal, {
      accountId: ctx.accountId,
      postId: postId as Id<"posts">,
      ...(at !== undefined ? { scheduledFor: at } : {}),
    });
    const post = postResource(ctx.accountId, postId as Id<"posts">);
    const operation: ThreadResource = {
      kind: "operation",
      operation: "post.schedule",
      operationId: data.scheduledPostId,
      accountId: ctx.accountId,
      status: "pending",
      label: data.rescheduled ? "Publicação reagendada" : "Publicação agendada",
    };
    return capabilityResult(data, {
      resources: [post, operation],
      presented: [post, operation],
    });
  },
});

const cancelSchedule = createTool({
  description:
    "Cancela o agendamento pendente de um post — desarma a publicação e o post volta a rascunho. Só funciona antes da publicação começar.",
  inputSchema: z.object({
    postId: z.string().describe("id do post agendado"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (ctx: VandaToolCtx, { postId }: { postId: string }): Promise<unknown> => {
    await ctx.runMutation(internal.posts.cancelScheduleInternal, {
      accountId: ctx.accountId,
      postId: postId as Id<"posts">,
    });
    const post = postResource(ctx.accountId, postId as Id<"posts">);
    const operation: ThreadResource = {
      kind: "operation",
      operation: "post.cancel_schedule",
      accountId: ctx.accountId,
      status: "cancelled",
      label: "Agendamento cancelado",
    };
    return capabilityResult("Agendamento cancelado; o post voltou a rascunho.", {
      resources: [post, operation],
      presented: [post, operation],
    });
  },
});

const deletePost = createTool({
  description:
    "Apaga um post que ainda não foi publicado (rascunho ou agendado — o agendamento é cancelado junto). As imagens continuam na galeria. Posts publicados não podem ser apagados.",
  inputSchema: z.object({
    postId: z.string().describe("id do post a apagar"),
  }),
  outputSchema: capabilityResultSchema,
  execute: async (ctx: VandaToolCtx, { postId }: { postId: string }): Promise<unknown> => {
    await ctx.runMutation(internal.posts.deletePostInternal, {
      accountId: ctx.accountId,
      postId: postId as Id<"posts">,
    });
    const operation: ThreadResource = {
      kind: "operation",
      operation: "post.delete",
      accountId: ctx.accountId,
      status: "succeeded",
      label: "Post apagado",
    };
    return capabilityResult("Post apagado. As imagens continuam na galeria.", {
      resources: [operation],
      presented: [operation],
    });
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
  ): Promise<unknown> => {
    const data = await ctx.runAction(internal.images.paint, {
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
    });
    const resource = imageResource(ctx.accountId, data.imageId);
    return capabilityResult(data, { resources: [resource], presented: [resource] });
  },
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
  ): Promise<unknown> => {
    const data = await ctx.runAction(internal.codeRuns.run, {
      accountId: ctx.accountId,
      code: args.code,
      description: args.description,
      // Lets the owner's stop button cancel the execution mid-flight.
      ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
      ...(args.inputPaths ? { inputPaths: args.inputPaths } : {}),
    });
    const resources: ThreadResource[] = [
      ...data.images.map((image) => imageResource(ctx.accountId, image.imageId)),
      ...data.artifacts.map((artifact) =>
        documentResource(ctx.accountId, artifact.path, artifact.filename),
      ),
    ];
    return capabilityResult(data, { resources, presented: resources });
  },
});

const instagramTools = makeInstagramTools({
  searchProfiles: (ctx, args): Promise<unknown> =>
    ctx.runAction(internal.instagramActions.searchProfiles, {
      accountId: ctx.accountId,
      query: args.query,
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    }),
  readProfile: (ctx, args): Promise<unknown> =>
    ctx.runAction(internal.instagramActions.readProfile, {
      accountId: ctx.accountId,
      scope: args.scope,
      ...(args.handle ? { handle: args.handle } : {}),
    }),
  listPosts: (ctx, args): Promise<unknown> =>
    ctx.runAction(internal.instagramActions.listPosts, {
      accountId: ctx.accountId,
      scope: args.scope,
      ...(args.handle ? { handle: args.handle } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.cursor ? { cursor: args.cursor } : {}),
    }),
  readPost: (ctx, args): Promise<unknown> =>
    ctx.runAction(internal.instagramActions.readPost, {
      accountId: ctx.accountId,
      postUrl: args.postUrl,
      ...(args.includeTranscript !== undefined
        ? { includeTranscript: args.includeTranscript }
        : {}),
    }),
  listComments: (ctx, args): Promise<unknown> =>
    ctx.runAction(internal.instagramActions.listComments, {
      accountId: ctx.accountId,
      scope: args.scope,
      ...(args.postId ? { postId: args.postId } : {}),
      ...(args.postUrl ? { postUrl: args.postUrl } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.cursor ? { cursor: args.cursor } : {}),
    }),
  readMetrics: (ctx, args): Promise<unknown> =>
    ctx.runAction(internal.instagramActions.readMetrics, {
      accountId: ctx.accountId,
      ...(args.postId ? { postId: args.postId } : {}),
    }),
});

/** Fallback pricing when OpenRouter's in-band cost is missing (per token). */
const CHAT_FALLBACK_USD_PER_INPUT_TOKEN = 2e-6;
const CHAT_FALLBACK_USD_PER_OUTPUT_TOKEN = 8e-6;

export const vanda = new Agent<VandaCtx>(components.agent, {
  name: "vanda",
  // usage accounting makes OpenRouter return the exact request cost in-band.
  languageModel: openrouter.chat(VANDA_MODEL, { usage: { include: true } }),
  // Every chat turn burns the owner's usage meter. The thread's opaque userId
  // is the account id (threadKey), which charge() resolves to the owner.
  usageHandler: async (ctx, { userId, usage, providerMetadata, model, provider }) => {
    if (!userId) return;
    // Conectado plan turns run on the owner's ChatGPT subscription (the
    // openai provider) — their money, not the Vanda meter.
    if (!provider.includes("openrouter")) return;
    const reported = (providerMetadata?.openrouter as { usage?: { cost?: unknown } } | undefined)
      ?.usage?.cost;
    const usd =
      typeof reported === "number"
        ? reported
        : (usage.inputTokens ?? 0) * CHAT_FALLBACK_USD_PER_INPUT_TOKEN +
          (usage.outputTokens ?? 0) * CHAT_FALLBACK_USD_PER_OUTPUT_TOKEN;
    if (usd <= 0) return;
    await ctx.runMutation(internal.usage.charge, {
      accountId: userId as Id<"accounts">,
      kind: "chat",
      usd,
      ref: model,
    });
  },
  instructions: `${INSTRUCTIONS}\n\n${SKILLS_PROMPT}`,
  tools: {
    list: listFiles,
    read: readFile,
    write: writeFile,
    ...instagramTools,
    paint,
    run_code: runCode,
    create_post: createPost,
    schedule_post: schedulePost,
    cancel_schedule: cancelSchedule,
    delete_post: deletePost,
  },
  stopWhen: stepCountIs(24),
});
