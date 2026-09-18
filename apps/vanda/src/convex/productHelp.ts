import { tool } from "ai";
import { z } from "zod";

const guideSchema = z.object({
  id: z.string(),
  title: z.string(),
  guidance: z.string(),
  route: z.string(),
  sourceFiles: z.array(z.string()),
});

const resultSchema = z.object({
  results: z.array(guideSchema).max(6),
  message: z.string(),
});

export type ProductHelpResult = z.infer<typeof resultSchema>;

type Guide = z.infer<typeof guideSchema> & { keywords: string };

const guides: readonly Guide[] = [
  {
    id: "connections.instagram-openai",
    title: "Conexões do Instagram e ChatGPT",
    guidance:
      "Em Perfil › Conexões, conecte o Instagram do negócio para publicar e, no plano ChatGPT, conecte sua assinatura OpenAI pelo código exibido. A conexão OpenAI só alimenta a inferência quando o plano ChatGPT está ativo e a conexão existe. Este guia não confirma o estado da sua conta: combine-o com account_status para Instagram e model_preferences para verificar conectado. Uma conexão registrada não garante que o token ainda funcione; erros de reconexão exigem conectar novamente.",
    route: "/perfil",
    sourceFiles: [
      "routes/_dashboard.perfil.tsx",
      "convex/publisherConnect.ts",
      "convex/openaiSub.ts",
    ],
    keywords:
      "conexao conexoes conectar instagram publicador upload post openai chatgpt assinatura connection connect publisher subscription",
  },
  {
    id: "models.subscription-limits",
    title: "Modelos e limites da assinatura",
    guidance:
      "Em Perfil › Modelos, escolha os modelos de conversa da Vanda e do Caetano e o modelo de imagens. No plano ChatGPT, apenas modelos compatíveis com a conexão OpenAI ficam disponíveis. Consulte model_preferences para saber as escolhas e restrições atuais; este guia não afirma qual modelo está ativo.",
    route: "/perfil",
    sourceFiles: ["routes/_dashboard.perfil.tsx", "convex/users.ts", "convex/openaiSub.ts"],
    keywords:
      "modelo modelos vanda caetano imagem imagens assinatura plano chatgpt openai limite indisponivel model models subscription limitation preferences",
  },
  {
    id: "billing.usage",
    title: "Plano e uso",
    guidance:
      "Em Perfil › Plano e uso, veja o plano, a porcentagem consumida, a renovação e mudanças de plano agendadas. O teste tem uma cota única; planos pagos usam uma cota por período, compartilhada entre os negócios do usuário. A tela não mostra o custo interno em dinheiro. Combine este guia com usage_status para dados atuais.",
    route: "/perfil",
    sourceFiles: ["routes/_dashboard.perfil.tsx", "convex/billing/plans.ts", "convex/usage.ts"],
    keywords:
      "plano planos uso cota limite renovacao assinatura cobranca teste porcentagem usage billing allowance trial renewal",
  },
  {
    id: "posts.drafts-and-scheduling",
    title: "Rascunhos, agendamento e publicação",
    guidance:
      "Pedir para criar um post produz um rascunho; não publica nem agenda. Agendar, reagendar ou publicar exige um pedido explícito separado. Uma data no briefing ou a aprovação da arte não autoriza o agendamento. Em Calendário, acompanhe o estado; cancelar um agendamento devolve o post a rascunho. Posts publicados não podem ser apagados nem editados por esse fluxo.",
    route: "/calendario",
    sourceFiles: ["convex/vanda.ts", "convex/posts.ts"],
    keywords:
      "post posts rascunho criar agendar reagendar publicar cancelar calendario draft schedule reschedule publish delete edit",
  },
  {
    id: "work.find-created-content",
    title: "Onde encontrar o trabalho criado",
    guidance:
      "A conversa entrega o rascunho e os recursos recém-criados. Use Calendário para localizar posts e acompanhar estados como rascunho, agendado, publicado ou falhou; use a conversa para continuar o trabalho com a Vanda. Não há, no comportamento documentado, um fluxo separado de “aprovar e publicar” automático.",
    route: "/calendario",
    sourceFiles: ["convex/vanda.ts", "convex/posts.ts"],
    keywords:
      "encontrar achar trabalho conteudo criado resultado onde calendario conversa galeria find work created content result status",
  },
  {
    id: "brand.preferences-and-memory",
    title: "Marca, preferências e memória",
    guidance:
      "Em Perfil › Marca, consulte os fatos e o kit visual usados pela Vanda; em Memória, consulte preferências duráveis. Diga uma preferência permanente na conversa: a Vanda pode gravar notas em /memory e atualizar anotações e kit visual, sem uma etapa adicional de aprovação implementada. Fatos confirmados do perfil são separados dessas notas. Este guia não altera nada nem confirma que a preferência foi salva; confira o retorno da ferramenta de gravação.",
    route: "/perfil",
    sourceFiles: ["routes/_dashboard.perfil.tsx", "convex/vanda.ts"],
    keywords:
      "marca memoria preferencia preferencias identidade visual cor cores fonte fontes tagline instrucoes brand memory preference preferences identity kit",
  },
];

const normalize = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const tokens = (value: string): string[] =>
  normalize(value)
    .split(/[^a-z0-9.-]+/)
    .filter((token) => token.length > 1);

export const productHelp = tool({
  description:
    "Consulta ajuda mantida do produto Vanda/Caetano por palavras-chave em português/inglês ou pelo id exato do tópico. Use '*' para ver o catálogo pequeno. É somente leitura e não consulta o estado da conta.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(200),
  }),
  outputSchema: resultSchema,
  execute: async ({ query }) => {
    const normalizedQuery = normalize(query);
    const queryTokens = [...new Set(tokens(query))];
    const exact = guides.find((guide) => guide.id === normalizedQuery);

    const ranked = (exact ? [exact] : guides)
      .map((guide) => {
        const searchable = new Set(tokens(`${guide.id} ${guide.title} ${guide.keywords}`));

        return { guide, score: queryTokens.filter((token) => searchable.has(token)).length };
      })
      .filter(({ score }) => normalizedQuery === "*" || score > 0)
      .toSorted((a, b) => b.score - a.score || a.guide.id.localeCompare(b.guide.id));

    const matches = (normalizedQuery === "*" ? ranked : ranked.slice(0, 3)).map(
      ({ guide: { keywords: _keywords, ...guide } }) => guide,
    );

    return {
      results: matches,
      message: matches.length
        ? "Orientação geral, sem leitura do estado da conta. Para respostas pessoais, combine com account_status, usage_status e/ou model_preferences conforme o tema."
        : "Tópico não documentado neste catálogo. Não invente um fluxo de interface: informe que o comportamento não é suportado aqui e, se útil, consulte '*' para ver os tópicos disponíveis.",
    };
  },
});
