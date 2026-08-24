import { createTool, type ToolCtx } from "@convex-dev/agent";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";

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

/** Keep generated Convex action references in vanda.ts to avoid an API type cycle. */
export const makeInstagramTools = (runners: InstagramToolRunners) => {
  const searchInstagramProfiles = createTool({
    description:
      "Busca perfis públicos do Instagram por palavras-chave. Use para descobrir negócios, criadores e concorrentes; os resultados vêm de dados públicos via Apify e ficam salvos em /instagram/searches.",
    inputSchema: z.object({
      query: z.string().describe("consulta curta, ex.: cafeteria pinheiros"),
      limit: z.number().int().min(1).max(20).optional().describe("máximo de perfis; padrão 10"),
    }),
    execute: runners.searchProfiles,
  });

  const readInstagramProfile = createTool({
    description:
      "Lê um perfil do Instagram. scope=connected usa a conexão oficial do dono; scope=public lê qualquer perfil público pelo handle. Retorna proveniência/frescor e salva o JSON em /instagram.",
    inputSchema: z.object({
      scope: scopeSchema,
      handle: z.string().optional().describe("@handle obrigatório somente quando scope=public"),
    }),
    execute: runners.readProfile,
  });

  const readInstagramPosts = createTool({
    description:
      "Lista posts/reels/carrosséis. scope=connected lê o catálogo oficial da conta; scope=public lê um perfil público. Use cursor para continuar uma leitura conectada. O resultado completo fica em /instagram.",
    inputSchema: z.object({
      scope: scopeSchema,
      handle: z.string().optional().describe("@handle obrigatório quando scope=public"),
      limit: z.number().int().min(1).max(100).optional().describe("padrão 25"),
      cursor: z.string().optional().describe("cursor retornado pela página anterior"),
    }),
    execute: runners.listPosts,
  });

  const readInstagramPost = createTool({
    description:
      "Lê em detalhe um post ou reel público por URL. Ative includeTranscript para obter a transcrição de um reel quando disponível. Salva em /instagram/posts.",
    inputSchema: z.object({
      postUrl: z.string().url().describe("URL instagram.com do post ou reel"),
      includeTranscript: z.boolean().optional().describe("extrair transcrição do reel"),
    }),
    execute: runners.readPost,
  });

  const readInstagramComments = createTool({
    description:
      "Lê comentários de um post. Para scope=connected passe o media postId retornado por read_instagram_posts; para scope=public passe postUrl. Leituras conectadas são oficiais e pagináveis; públicas podem ser parciais.",
    inputSchema: z.object({
      scope: scopeSchema,
      postId: z.string().optional().describe("media id para post da conta conectada"),
      postUrl: z.string().url().optional().describe("URL para post público"),
      limit: z.number().int().min(1).max(50).optional().describe("padrão 25"),
      cursor: z.string().optional().describe("cursor para comentários conectados"),
    }),
    execute: runners.listComments,
  });

  const readInstagramMetrics = createTool({
    description:
      "Lê insights privados da conta Instagram conectada. Sem postId retorna métricas da conta e audiência; com postId retorna alcance, visualizações, saves, shares e engajamento daquele post, inclusive orgânico.",
    inputSchema: z.object({
      postId: z.string().optional().describe("media id; omita para métricas da conta"),
    }),
    execute: runners.readMetrics,
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
