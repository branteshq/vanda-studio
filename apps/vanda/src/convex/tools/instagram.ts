import { createTool, type ToolCtx } from "@convex-dev/agent";
import type { ToolExecutionOptions } from "ai";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import { recordCapabilityResult } from "../capabilityTools";
import type { InstagramOperation } from "../instagram/cache";
import { summarizeInstagramResult } from "../instagram/toolSummary";
import { capabilityResult, capabilityResultSchema, type ThreadResource } from "../resourceRefs";

type InstagramToolCtx = ToolCtx & { accountId: Id<"accounts"> };
type Scope = "connected" | "public";

interface InstagramToolRunners {
  readonly searchProfiles: (
    ctx: InstagramToolCtx,
    args: { query: string; limit?: number | undefined },
  ) => Promise<unknown>;
  readonly readProfile: (
    ctx: InstagramToolCtx,
    args: { scope: Scope; handle?: string | undefined },
  ) => Promise<unknown>;
  readonly listPosts: (
    ctx: InstagramToolCtx,
    args: {
      scope: Scope;
      handle?: string | undefined;
      limit?: number | undefined;
      cursor?: string | undefined;
    },
  ) => Promise<unknown>;
  readonly readPost: (
    ctx: InstagramToolCtx,
    args: { postUrl: string; includeTranscript?: boolean | undefined },
  ) => Promise<unknown>;
  readonly listComments: (
    ctx: InstagramToolCtx,
    args: {
      scope: Scope;
      postId?: string | undefined;
      postUrl?: string | undefined;
      limit?: number | undefined;
      cursor?: string | undefined;
    },
  ) => Promise<unknown>;
  readonly readMetrics: (
    ctx: InstagramToolCtx,
    args: { postId?: string | undefined },
  ) => Promise<unknown>;
}

const scopeSchema = z.enum(["connected", "public"]).default("connected");

const instagramResult = async (
  ctx: InstagramToolCtx,
  options: ToolExecutionOptions,
  operation: InstagramOperation,
  run: () => Promise<unknown>,
): Promise<unknown> => {
  const data = summarizeInstagramResult(operation, await run());
  const savedTo =
    data && typeof data === "object" && typeof (data as { savedTo?: unknown }).savedTo === "string"
      ? (data as { savedTo: string }).savedTo
      : null;
  const resources: ThreadResource[] = savedTo
    ? [{ kind: "document", accountId: ctx.accountId, path: savedTo }]
    : [];
  return recordCapabilityResult(ctx, options, capabilityResult(data, { resources }));
};

/** Keep generated Convex action references in vanda.ts to avoid an API type cycle. */
export const makeInstagramTools = (runners: InstagramToolRunners) => {
  const searchInstagramProfiles = createTool({
    description:
      "Busca perfis públicos do Instagram por palavras-chave. Use para descobrir negócios, criadores e concorrentes; retorna resumos de perfis sem posts aninhados. Os dados completos ficam em /instagram/searches; para analisar em lote, use run_code com inputPaths.",
    inputSchema: z.object({
      query: z.string().describe("consulta curta, ex.: cafeteria pinheiros"),
      limit: z.number().int().min(1).max(20).optional().describe("máximo de perfis; padrão 10"),
    }),
    outputSchema: capabilityResultSchema,
    execute: (ctx: InstagramToolCtx, args, options) =>
      instagramResult(ctx, options, "search_profiles", () => runners.searchProfiles(ctx, args)),
  });

  const readInstagramProfile = createTool({
    description:
      "Lê um perfil do Instagram. scope=connected usa a conexão oficial do dono; scope=public lê qualquer perfil público pelo handle. Retorna resumo sem posts aninhados, com proveniência/frescor. Salva o JSON completo em /instagram.",
    inputSchema: z.object({
      scope: scopeSchema,
      handle: z.string().optional().describe("@handle obrigatório somente quando scope=public"),
    }),
    outputSchema: capabilityResultSchema,
    execute: (ctx: InstagramToolCtx, args, options) =>
      instagramResult(ctx, options, "profile", () => runners.readProfile(ctx, args)),
  });

  const readInstagramPosts = createTool({
    description:
      "Lista posts/reels/carrosséis. scope=connected lê o catálogo oficial da conta; scope=public lê um perfil público. Use cursor para continuar uma leitura conectada. Retorna uma prévia limitada com IDs, URLs e métricas; o resultado completo fica em /instagram. Analise grandes volumes com run_code e inputPaths.",
    inputSchema: z.object({
      scope: scopeSchema,
      handle: z.string().optional().describe("@handle obrigatório quando scope=public"),
      limit: z.number().int().min(1).max(100).optional().describe("padrão 25"),
      cursor: z.string().optional().describe("cursor retornado pela página anterior"),
    }),
    outputSchema: capabilityResultSchema,
    execute: (ctx: InstagramToolCtx, args, options) =>
      instagramResult(ctx, options, "posts", () => runners.listPosts(ctx, args)),
  });

  const readInstagramPost = createTool({
    description:
      "Lê em detalhe um post ou reel público por URL. Ative includeTranscript para obter a transcrição de um reel quando disponível. Retorna prévia com legenda/transcrição limitadas e salva os textos completos em /instagram/posts.",
    inputSchema: z.object({
      postUrl: z.string().url().describe("URL instagram.com do post ou reel"),
      includeTranscript: z.boolean().optional().describe("extrair transcrição do reel"),
    }),
    outputSchema: capabilityResultSchema,
    execute: (ctx: InstagramToolCtx, args, options) =>
      instagramResult(ctx, options, "post", () => runners.readPost(ctx, args)),
  });

  const readInstagramComments = createTool({
    description:
      "Lê comentários de um post. Para scope=connected passe o media postId retornado por read_instagram_posts; para scope=public passe postUrl. Retorna prévia limitada sem respostas aninhadas e salva os dados completos em /instagram. Leituras conectadas são oficiais e pagináveis; públicas podem ser parciais.",
    inputSchema: z.object({
      scope: scopeSchema,
      postId: z.string().optional().describe("media id para post da conta conectada"),
      postUrl: z.string().url().optional().describe("URL para post público"),
      limit: z.number().int().min(1).max(50).optional().describe("padrão 25"),
      cursor: z.string().optional().describe("cursor para comentários conectados"),
    }),
    outputSchema: capabilityResultSchema,
    execute: (ctx: InstagramToolCtx, args, options) =>
      instagramResult(ctx, options, "comments", () => runners.listComments(ctx, args)),
  });

  const readInstagramMetrics = createTool({
    description:
      "Lê insights privados da conta Instagram conectada. Sem postId retorna métricas resumidas da conta; com postId retorna alcance, visualizações, saves, shares e engajamento daquele post, inclusive orgânico. Demografia e dados completos ficam no workspace para análise com run_code.",
    inputSchema: z.object({
      postId: z.string().optional().describe("media id; omita para métricas da conta"),
    }),
    outputSchema: capabilityResultSchema,
    execute: (ctx: InstagramToolCtx, args, options) =>
      instagramResult(ctx, options, "insights", () => runners.readMetrics(ctx, args)),
  });

  return {
    search_instagram_profiles: searchInstagramProfiles,
    read_instagram_profile: readInstagramProfile,
    read_instagram_posts: readInstagramPosts,
    read_instagram_post: readInstagramPost,
    read_instagram_comments: readInstagramComments,
    read_instagram_metrics: readInstagramMetrics,
  };
};
