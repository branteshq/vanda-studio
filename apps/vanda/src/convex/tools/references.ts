import { createTool, type ToolCtx } from "@convex-dev/agent";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { agentAccount, type AgentCtx } from "../agentContext";
import { referenceLabels } from "../pipeline/constants";
import {
  MAX_REFERENCE_NOTE,
  MAX_REFERENCE_RESULTS,
  type ReferenceAuthor,
  type ReferenceSaved,
  type ReferenceSearchResult,
} from "../references";

type ReferenceToolCtx = ToolCtx & AgentCtx;

const labelSchema = z.enum(referenceLabels);

const present = (value: string | undefined): string | undefined => value?.trim() || undefined;

/** An Instagram media id or link; account image ids are never all digits and never URLs. */
const looksLikeInstagramPost = (value: string): boolean =>
  /^\d+$/.test(value) || value.includes("instagram.com");

export type ReferenceSource =
  | { kind: "image"; imageId: string }
  | { kind: "instagram"; post: string };

/**
 * Where a reference comes from. Strict tool schemas make the model send every field, so an unused
 * one arrives as ""; and it sometimes puts an Instagram post id in `imageId`.
 */
export function referenceSourceOf(args: {
  imageId?: string | undefined;
  instagramPost?: string | undefined;
}): ReferenceSource {
  const imageId = present(args.imageId);
  const instagramPost = present(args.instagramPost);

  if (instagramPost !== undefined) {
    if (imageId !== undefined && imageId !== instagramPost && !looksLikeInstagramPost(imageId))
      throw new Error(
        "informe só um: imageId para imagem da conta, instagramPost para post do Instagram; deixe o outro vazio",
      );

    return { kind: "instagram", post: instagramPost };
  }

  if (imageId === undefined)
    throw new Error("informe imageId (imagem da conta) ou instagramPost (post do Instagram)");

  return looksLikeInstagramPost(imageId)
    ? { kind: "instagram", post: imageId }
    : { kind: "image", imageId };
}

const LABELS_HELP =
  "layout = composição/grade do feed a seguir; style = cor, luz, tipografia, acabamento; face = a pessoa real (dono ou equipe) que pode aparecer; product = produto real; place = o lugar; logo = a marca gráfica; avoid = o que a marca não quer (orienta o prompt, nunca vai ao paint)";

/** Caetano saves for the owner in WhatsApp and the guide; Vanda in the app chat. */
const authorOf = (ctx: ReferenceToolCtx): ReferenceAuthor =>
  ctx.caetanoThreadId || ctx.agent?.options.name === "caetano" ? "caetano" : "vanda";

export const referenceTools = {
  reference_search: createTool({
    description: `Lista as referências da marca por rótulo, as mais recentes primeiro, com imageId, nome (o assunto ou a legenda do post, para você não repetir o tema), nota (o que tirar dela), origem e quantas vezes já foi usada. Use antes de pintar um post: passe 2–3 de layout/style em referenceImageIds do paint e descreva no prompt o layout que elas mostram; com rosto real use face. Para ver os pixels, leia o path com read. Rótulos: ${LABELS_HELP}.`,
    inputSchema: z.object({
      labels: z
        .array(labelSchema)
        .optional()
        .describe("rótulos aceitos (qualquer um deles); omita para todas"),
      limit: z.number().int().min(1).max(MAX_REFERENCE_RESULTS).optional().describe("padrão 8"),
    }),
    execute: async (ctx: ReferenceToolCtx, { labels, limit }) => {
      const result: ReferenceSearchResult = await ctx.runQuery(internal.references.search, {
        accountId: await agentAccount(ctx),
        ...(labels && { labels }),
        ...(limit !== undefined && { limit }),
      });

      return {
        total: result.total,
        counts: result.counts,
        matched: result.matched,
        references: result.items.map((item) => ({
          imageId: item.imageId,
          name: item.name,
          labels: item.labels,
          note: item.note,
          source: item.source,
          addedBy: item.addedBy,
          usedInPaints: item.useCount,
          size: item.width && item.height ? `${item.width}×${item.height}` : null,
          path: item.path,
        })),
      };
    },
  }),

  reference_save: createTool({
    description: `Guarda uma imagem como referência da marca, com rótulos e uma nota curta do que tirar dela (ex.: "layout do feed: foto dela à direita, arco rosa atrás, título serifado em caixa alta sobre a foto"). Fonte: imageId (anexo, imagem gerada ou da galeria) OU instagramPost (id ou URL de um post que você acabou de ler com read_instagram_posts/read_instagram_post; a imagem é copiada para a conta). Salvar de novo a mesma imagem troca os rótulos e a nota. Guarde o que o dono mostrar como exemplo ("quero assim", "nunca faz assim" → avoid) e, no guia, os posts que definem o padrão do feed. face só para fotos reais do dono ou da equipe, nunca de outro perfil. Rótulos: ${LABELS_HELP}.`,
    inputSchema: z.object({
      imageId: z.string().optional().describe("imagem da conta"),
      instagramPost: z.string().optional().describe("id ou URL de post do Instagram já lido"),
      labels: z.array(labelSchema).min(1),
      note: z
        .string()
        .max(MAX_REFERENCE_NOTE)
        .optional()
        .describe("o que tirar desta imagem, em uma ou duas frases"),
    }),
    execute: async (ctx: ReferenceToolCtx, args): Promise<ReferenceSaved> => {
      const source = referenceSourceOf(args);
      const note = present(args.note);
      const { labels } = args;

      const accountId = await agentAccount(ctx);
      const addedBy = authorOf(ctx);

      if (source.kind === "instagram")
        return ctx.runAction(internal.references.saveFromInstagram, {
          accountId,
          post: source.post,
          labels,
          addedBy,
          ...(note !== undefined && { note }),
        });

      return ctx.runMutation(internal.references.mark, {
        accountId,
        // SAFETY: the mutation checks the id belongs to this account.
        imageId: source.imageId as Id<"images">,
        labels,
        addedBy,
        ...(note !== undefined && { note }),
      });
    },
  }),

  reference_remove: createTool({
    description:
      "Tira uma imagem das referências da marca sem apagá-la (ela continua na galeria). Use quando o dono disser que uma referência não serve mais.",
    inputSchema: z.object({ imageId: z.string() }),
    execute: async (
      ctx: ReferenceToolCtx,
      { imageId },
    ): Promise<{ imageId: Id<"images">; removed: boolean }> =>
      ctx.runMutation(internal.references.unmark, {
        accountId: await agentAccount(ctx),
        // SAFETY: the mutation checks the id belongs to this account.
        imageId: imageId as Id<"images">,
      }),
  }),
};
