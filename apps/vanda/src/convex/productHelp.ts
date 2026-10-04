import { tool } from "ai";
import { z } from "zod";
import { findProductDoc, productDocs, searchProductDocs } from "./productDocs/catalog";

const matchSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string(),
  excerpt: z.string().optional(),
});

const resultSchema = z.object({
  results: z.array(matchSchema),
  page: z.object({ slug: z.string(), title: z.string(), markdown: z.string() }).optional(),
  message: z.string(),
});

export type ProductHelpResult = z.infer<typeof resultSchema>;

const url = (slug: string) => `/docs/${slug}`;

export const productHelp = tool({
  description:
    "Lê a documentação do Vanda Studio, a mesma da página /docs do app: telas, posts e agendamento, Caetano no WhatsApp, marca e memória, planos, modelos, conexões e a referência de configurações. Busque por palavras-chave, passe o slug exato de uma página para lê-la inteira, ou '*' para listar as páginas. Não lê o estado da conta; para isso use settings_get.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(200),
  }),
  outputSchema: resultSchema,
  execute: async ({ query }): Promise<ProductHelpResult> => {
    const slug = query.replace(/^\/?docs\//, "").replace(/\.md$/, "");
    const exact = findProductDoc(slug);

    if (exact) {
      return {
        results: [
          {
            slug: exact.slug,
            title: exact.title,
            description: exact.description,
            url: url(exact.slug),
          },
        ],
        page: { slug: exact.slug, title: exact.title, markdown: exact.markdown },
        message: `Página completa. O dono pode abrir em ${url(exact.slug)}.`,
      };
    }

    if (query === "*") {
      return {
        results: productDocs().map((doc) => ({
          slug: doc.slug,
          title: doc.title,
          description: doc.description,
          url: url(doc.slug),
        })),
        message: "Páginas da documentação. Passe um slug para ler a página inteira.",
      };
    }

    const results = searchProductDocs(query).map((match) =>
      Object.assign(match, { url: url(match.slug) }),
    );

    return {
      results,
      message: results.length
        ? "Trechos da documentação. Para respostas sobre a conta do dono, combine com settings_get; passe o slug para ler a página inteira."
        : "Tópico não documentado. Não invente um fluxo de interface: diga que isso não está documentado e, se útil, consulte '*' para ver as páginas.",
    };
  },
});
