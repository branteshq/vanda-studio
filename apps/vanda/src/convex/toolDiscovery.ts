import { tool, type StepResult, type ToolSet } from "ai";
import { z } from "zod";

type DiscoveryEntry = {
  keywords: string;
  effect: "read" | "write";
};

const searchResultSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      effect: z.enum(["read", "write"]),
    }),
  ),
  message: z.string(),
});

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const stopWords = new Set(
  "a as o os de da das do dos e em no na nos nas um uma para por com que quero preciso como meu minha meus minhas the a an and or to of for with how my i want need".split(
    " ",
  ),
);

const words = (text: string) =>
  normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !stopWords.has(word));

/** Discovery changes model exposure, never the tool's implementation or authorization. */
export function toolDiscovery<Tools extends ToolSet>(
  tools: Tools,
  deferred: Partial<Record<keyof Tools, DiscoveryEntry>>,
) {
  const catalog = Object.entries(tools).flatMap(([name, definition]) => {
    const entry = deferred[name];

    return entry ? [{ name, description: definition.description ?? name, ...entry }] : [];
  });

  const deferredNames = new Set(catalog.map((entry) => entry.name));
  const core = ["tool_search", ...Object.keys(tools).filter((name) => !deferredNames.has(name))];

  const search = tool({
    description:
      "Descobre ferramentas adicionais deste agente por tarefa, palavras-chave em português/inglês ou nome exato. Use '*' para listar todas. As ferramentas encontradas ficam disponíveis com seus parâmetros tipados a partir do próximo passo, até o fim deste turno. Buscar não executa a operação nem concede autorização. Se não encontrar, reformule ou consulte '*'; não invente capacidades.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(300),
    }),
    outputSchema: searchResultSchema,
    execute: async ({ query }) => {
      const terms = [...new Set(words(query))];
      const normalizedQuery = normalize(query.trim());
      const exact = catalog.find((entry) => entry.name === normalizedQuery);

      const ranked = (exact ? [exact] : catalog).flatMap((entry) => {
        const tokens = new Set(words(`${entry.name} ${entry.description} ${entry.keywords}`));

        const score = normalizedQuery === "*" ? 1 : terms.filter((term) => tokens.has(term)).length;

        return score > 0 ? [{ entry, score }] : [];
      });

      ranked.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));

      const matches = (query.trim() === "*" ? ranked : ranked.slice(0, 4)).map(({ entry }) => ({
        name: entry.name,
        description: entry.description,
        effect: entry.effect,
      }));

      return {
        tools: matches,
        message: matches.length
          ? "Ferramentas disponíveis no próximo passo. Use os parâmetros da definição da ferramenta. Alterações continuam exigindo a autorização apropriada; descoberta não confirma conexão nem permissões."
          : "Nenhuma ferramenta adicional encontrada para esta busca. Tente outros termos ou '*' para consultar o catálogo deste agente. Isso não verifica conexões nem permissões.",
      };
    },
  });

  const prepareStep = ({
    steps,
  }: {
    steps: ReadonlyArray<Pick<StepResult<ToolSet>, "toolResults">>;
  }) => {
    // Only completed results from this invocation count, not persisted thread history.
    const activeTools = new Set<keyof Tools | "tool_search">(core);

    for (const step of steps) {
      for (const result of step.toolResults) {
        if (result.toolName !== "tool_search") continue;

        const parsed = searchResultSchema.safeParse(result.output);

        if (!parsed.success) continue;

        for (const match of parsed.data.tools) {
          if (deferredNames.has(match.name)) activeTools.add(match.name);
        }
      }
    }

    return { activeTools: [...activeTools] };
  };

  return { search, prepareStep };
}
