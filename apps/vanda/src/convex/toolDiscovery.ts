import { tool, type StepResult, type ToolSet } from "ai";
import { z } from "zod";

type DiscoveryEntry = {
  keywords: string;
  effect: "read" | "write";
};

type DiscoverableSkill = {
  name: string;
  description: string;
  location: string;
};

const searchResultSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      effect: z.enum(["read", "write"]),
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      location: z.string(),
    }),
  ),
  message: z.string(),
});

// Per search: enough tools to cover a task, and the skills worth reading. A post
// search asks for three at once (production, type, purpose), so three is too tight.
const RESULTS = { tool: 4, skill: 5 } as const;

// Name words every skill of a family shares; only the rest identify one skill.
const FAMILY_WORDS = new Set(["post", "purpose", "type"]);

// A query word that names a skill ("produto" for post-purpose-produto) outweighs
// any description word; naming the entry exactly guarantees it a place.
const NAME_WEIGHT = 3;

const EXACT_NAME = 100;

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

/**
 * Discovery changes model exposure, never the tool's implementation or authorization.
 * Skills share the same index: a match returns its location to load with read.
 */
export function toolDiscovery<Tools extends ToolSet>(
  tools: Tools,
  deferred: Partial<Record<keyof Tools, DiscoveryEntry>>,
  skills: readonly DiscoverableSkill[] = [],
) {
  const toolEntries = Object.entries(tools).flatMap(([name, definition]) => {
    const entry = deferred[name];

    return entry
      ? [{ kind: "tool" as const, name, description: definition.description ?? name, ...entry }]
      : [];
  });

  const catalog = [
    ...toolEntries,
    ...skills.map((skill) => ({ kind: "skill" as const, keywords: "", ...skill })),
  ];

  const indexed = catalog.map((entry) => ({
    entry,
    tokens: new Set(words(`${entry.name} ${entry.description} ${entry.keywords}`)),
    // Skill names are chosen to identify; tool names (read_instagram_post) are generic.
    nameTokens: new Set(
      entry.kind === "skill" ? words(entry.name).filter((word) => !FAMILY_WORDS.has(word)) : [],
    ),
  }));

  // Rare words decide the ranking: "post" and "propósito" sit in every purpose
  // skill, so a plain count lets any incidental word (or the alphabet) pick one.
  const weight = (term: string) => {
    const frequency = indexed.filter(({ tokens }) => tokens.has(term)).length;

    return Math.log((indexed.length + 1) / (frequency + 1)) + 0.1;
  };

  const deferredNames = new Set(toolEntries.map((entry) => entry.name));
  const core = ["tool_search", ...Object.keys(tools).filter((name) => !deferredNames.has(name))];

  const search = tool({
    description:
      "Descobre ferramentas e habilidades adicionais deste agente por tarefa, palavras-chave em português/inglês ou nome exato. Use '*' para listar todas. As ferramentas encontradas ficam disponíveis com seus parâmetros tipados a partir do próximo passo, até o fim deste turno. Habilidades encontradas trazem location: leia o SKILL.md com read antes de agir. Buscar não executa a operação nem concede autorização. Se não encontrar, reformule ou consulte '*'; não invente capacidades.",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(300),
    }),
    outputSchema: searchResultSchema,
    execute: async ({ query }) => {
      const terms = [...new Set(words(query))];
      const normalizedQuery = normalize(query.trim());
      const exact = catalog.find((entry) => entry.name === normalizedQuery);

      const ranked = indexed.flatMap(({ entry, tokens, nameTokens }) => {
        if (exact && entry !== exact) return [];

        if (normalizedQuery === "*") return [{ entry, score: 1 }];

        const named = normalizedQuery.includes(entry.name) ? EXACT_NAME : 0;

        const score = terms.reduce(
          (total, term) =>
            total +
            (tokens.has(term) ? weight(term) : 0) +
            (nameTokens.has(term) ? NAME_WEIGHT * weight(term) : 0),
          named,
        );

        return score > 0 ? [{ entry, score }] : [];
      });

      ranked.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));

      // Tools and skills keep separate cuts, so a skill never pushes out the tool it needs.
      const top = (kind: "tool" | "skill") => {
        const ofKind = ranked.filter(({ entry }) => entry.kind === kind);

        return query.trim() === "*" ? ofKind : ofKind.slice(0, RESULTS[kind]);
      };

      const matches = [...top("tool"), ...top("skill")].map(({ entry }) => entry);

      const found = {
        tools: matches.flatMap((entry) =>
          entry.kind === "tool"
            ? [{ name: entry.name, description: entry.description, effect: entry.effect }]
            : [],
        ),
        skills: matches.flatMap((entry) =>
          entry.kind === "skill"
            ? [{ name: entry.name, description: entry.description, location: entry.location }]
            : [],
        ),
      };

      return {
        ...found,
        message: matches.length
          ? "Ferramentas disponíveis no próximo passo. Use os parâmetros da definição da ferramenta. Habilidades: leia o SKILL.md em location com read antes de agir e siga a descoberta progressiva indicada nele. Alterações continuam exigindo a autorização apropriada; descoberta não confirma conexão nem permissões."
          : "Nenhuma ferramenta ou habilidade adicional encontrada para esta busca. Tente outros termos ou '*' para consultar o catálogo deste agente. Isso não verifica conexões nem permissões.",
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
