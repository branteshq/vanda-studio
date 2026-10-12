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
// search asks for up to five at once (production, type, purpose, a second
// purpose, ad format), and a format word must not lose its slot to the rest.
const RESULTS = { tool: 4, skill: 7 } as const;

// Name words every skill of a family shares; only the rest identify one skill.
const FAMILY_WORDS = new Set(["post", "purpose", "type", "ad"]);

// A query word that names a skill ("produto" for post-purpose-produto) outweighs
// any description word; naming the entry exactly, or its name words in order
// ("nós vs nós" for post-ad-nos-vs-nos), guarantees it a place.
const NAME_WEIGHT = 3;

const EXACT_NAME = 100;

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Every ad format skill (post-ad-*) is described as "Formato de anúncio <nome>" and Vanda
// searches "formato de anúncio <nome>". The phrase marks a format search; counted as
// words it would make "anuncio" common and drown the anuncio purpose.
const AD_FORMAT_MARKER = "formato de anuncio";

const withoutMarker = (text: string) => normalize(text).replaceAll(AD_FORMAT_MARKER, " ");

const isAdFormat = (name: string) => name.startsWith("post-ad-");

const stopWords = new Set(
  "a as o os de da das do dos e em no na nos nas um uma para por com que quero preciso como meu minha meus minhas the a an and or to of for with how my i want need".split(
    " ",
  ),
);

// A skill's identifying name words ("nos vs nos" for post-ad-nos-vs-nos).
const identifyingWords = (name: string) => {
  const parts = name.split("-");

  return parts.slice(parts.findIndex((part) => !FAMILY_WORDS.has(part)));
};

// As a padded phrase; one word is too loose to guarantee a place.
const namePhrase = (name: string) => {
  const identifying = identifyingWords(name);

  return identifying.length > 1 ? ` ${identifying.join(" ")} ` : undefined;
};

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

  // A format's name word identifies it only if no core post skill (type, purpose,
  // production, instagram-*) uses that word: "story do instagram" is an ordinary story
  // request, while "combo" or "nós vs nós" can only mean the format.
  const coreNameWords = new Set(
    skills.filter((skill) => !isAdFormat(skill.name)).flatMap((skill) => skill.name.split("-")),
  );

  const formatOwns = (name: string) =>
    !isAdFormat(name) ||
    !name.split("-").some((part) => coreNameWords.has(part) && !FAMILY_WORDS.has(part));

  const indexed = catalog.map((entry) => ({
    entry,
    tokens: new Set(words(withoutMarker(`${entry.name} ${entry.description} ${entry.keywords}`))),

    // Skill names are chosen to identify; tool names (read_instagram_post) are generic.
    nameTokens: new Set(
      entry.kind === "skill"
        ? words(entry.name).filter(
            (word) =>
              !FAMILY_WORDS.has(word) && (!isAdFormat(entry.name) || !coreNameWords.has(word)),
          )
        : [],
    ),
    // Stop words still count here: "nós vs nós" would otherwise only search "vs".
    namePhrase:
      entry.kind === "skill" && formatOwns(entry.name) ? namePhrase(entry.name) : undefined,
    // "formato de anúncio <nome>", the search Vanda is told to make, always names the format.
    markedName:
      entry.kind === "skill" && isAdFormat(entry.name)
        ? ` ${AD_FORMAT_MARKER} ${identifyingWords(entry.name).join(" ")} `
        : undefined,
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
      const terms = [...new Set(words(withoutMarker(query)))];
      const normalizedQuery = normalize(query.trim());
      const spacedQuery = ` ${normalizedQuery.replace(/[^a-z0-9]+/g, " ")} `;
      const exact = catalog.find((entry) => entry.name === normalizedQuery);

      const ranked = indexed.flatMap(({ entry, tokens, nameTokens, namePhrase, markedName }) => {
        if (exact && entry !== exact) return [];

        if (normalizedQuery === "*") return [{ entry, score: 1 }];

        const named =
          normalizedQuery.includes(entry.name) ||
          (namePhrase && spacedQuery.includes(namePhrase)) ||
          (markedName && spacedQuery.includes(markedName))
            ? EXACT_NAME
            : 0;

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
