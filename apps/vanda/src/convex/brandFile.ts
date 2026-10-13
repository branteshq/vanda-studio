import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import type { brandCanonKinds } from "./pipeline/constants";
import { saveDocument, type DocumentAuthor } from "./workspace/documents";
import { imageUrl, type WorkspaceWriteResult } from "./workspace/types";

/**
 * The brand file: one Markdown document per business that both agents read at
 * every turn and the owner reads and edits in Perfil: the only brand memory. The
 * radar, the visual brand and readiness read it too. Every item ends with its
 * origin, which decides who may change it: (dono) only on the owner's word,
 * (observado: …) when new evidence arrives, (Vanda) whenever the owner prefers
 * something else.
 */

export const BRAND_FILE_PATH = "/brand/marca.md";

/** Always in context, so it stays small enough to ride along on every turn. */
export const MAX_BRAND_FILE_BYTES = 24_000;

export const brandFileBytes = (content: string): number =>
  new TextEncoder().encode(content).byteLength;

/** The kinds of fact onboarding extracts; each lands in one section. */
export type BrandFactKind = (typeof brandCanonKinds)[number];

/** One item; `origin` defaults to the owner's word ("dono"). */
export type BrandFact = { kind: BrandFactKind; text: string; origin?: string };

/** The section that holds the palette, the typography and the logo. */
const DESIGN_SECTION = "Design";

/**
 * Labels of the Design items: "- Paleta: #hex nome (papel); …", "- Logo: ![…](image:id)".
 * `Manter` is the brand's identity, what every post keeps (colours, signature, a recurring
 * person or element, humour); `Evoluir` is the execution the feed shows today and how the
 * next posts improve on it. Caetano writes both in the guide; Vanda when they are missing.
 */
export const DESIGN_LABELS = {
  palette: "Paleta",
  typography: "Tipografia",
  logo: "Logo",
  keep: "Manter",
  evolve: "Evoluir",
} as const;

/**
 * The people who appear in the posts, one item each: who they are, how often and
 * how they appear, and links to their face photos ("fotos: ![rosto](image:<id>)").
 */
export const PEOPLE_SECTION = "Quem aparece";

/** Legacy notes: everything under this heading is carried over verbatim, never parsed. */
const LEGACY_HEADING = "Notas anteriores";

/** The sections in file order; `discover` is what the guide interview asks for. */
const SECTIONS: { title: string; kinds: readonly BrandFactKind[]; discover?: string }[] = [
  {
    title: "O negócio",
    kinds: [
      "summary",
      "identity",
      "positioning",
      "offer",
      "differentiator",
      "location",
      "objective",
    ],
    discover: "o que vende, preços aproximados, onde ou como atende, e o que quer do Instagram",
  },
  { title: "Público", kinds: ["audience"], discover: "quem compra e do que precisa ou tem medo" },
  {
    title: "Voz",
    kinds: ["voice"],
    discover:
      "se o perfil é só profissional ou também pessoal e descontraído; como fala com os clientes; se usa emojis",
  },
  // Who shows up in the posts, one item per person: optional, so the guide never waits on it.
  { title: PEOPLE_SECTION, kinds: ["character"] },
  {
    title: DESIGN_SECTION,
    kinds: [],
    discover:
      "cores e o papel de cada uma, se tem logo (e onde ele vai), a fonte se souber, o estilo das imagens, o que manter e o que melhorar nos posts, e o que evitar",
  },
  {
    title: "Nunca fazer",
    kinds: ["restriction", "forbidden_claim"],
    discover:
      "o que a lei ou o conselho da profissão proíbe nos anúncios e assuntos que a marca evita",
  },
  {
    title: "Provas",
    kinds: ["proof"],
    discover: "registro profissional, tempo de mercado, prêmios ou depoimentos de clientes",
  },
  { title: "Preferências", kinds: [] },
  { title: "O que funciona", kinds: [] },
];

/** The section titles of the brand file, in file order. */
export const SECTION_TITLES = SECTIONS.map((section) => section.title);

const BRAND_FILE_LEGEND =
  "Lido pela Vanda e pelo Caetano em toda conversa. A origem no fim de cada item diz quem pode mudá-lo: (dono) só você; (observado: evidência, data) revisado com novos resultados; (Vanda) sugestão, mude quando quiser. Este guia define a identidade; tipo, formato e layout de cada post são escolhidos a cada post.";

/** The label each canon kind gets on its composed line; kinds without one render bare. */
const LABELS: Partial<Record<BrandFactKind, string>> = {
  identity: "O que é",
  summary: "Resumo",
  positioning: "Posicionamento",
  offer: "Oferta",
  differentiator: "Diferencial",
  location: "Onde",
  objective: "Objetivo do perfil",
  audience: "Quem",
  voice: "Voz",
};

/** One line per kind and origin: "- Oferta: a; b (dono)". */
const groupedLines = (facts: readonly BrandFact[]): string[] => {
  const groups = new Map<string, { label: string | undefined; origin: string; texts: string[] }>();

  for (const fact of facts) {
    const origin = fact.origin ?? "dono";
    const key = `${fact.kind} ${origin}`;
    const group = groups.get(key) ?? { label: LABELS[fact.kind], origin, texts: [] };

    group.texts.push(fact.text.replace(/\s+/g, " ").trim());
    groups.set(key, group);
  }

  return [...groups.values()].map(
    ({ label, origin, texts }) => `- ${label ? `${label}: ` : ""}${texts.join("; ")} (${origin})`,
  );
};

/** Room left for the reference lines of legacy notes that do not fit inline. */
const LEGACY_REFERENCE_MARGIN = 1_000;

const PREFERENCE_PATHS = new Set(["/memory/preferences.md", "/memory/preferencias.md"]);

/** Where an old document stays readable: /legado/brand-notes.md, /legado/memory-<name>. */
export const legacyPath = (path: string): string =>
  path === "/brand/notes.md"
    ? "/legado/brand-notes.md"
    : `/legado/memory-${path.slice("/memory/".length)}`;

/** Legacy documents (/brand/notes.md, /memory/*.md) are carried over verbatim. */
type BrandFileSources = {
  name: string;
  handle?: string | null | undefined;
  facts: readonly BrandFact[];
  legacy: readonly { path: string; content: string }[];
};

/** The first version of a brand file, built from what the account already knows. */
export function composeBrandFile(sources: BrandFileSources): string {
  const handle = sources.handle ? ` (@${sources.handle})` : "";
  const lines = [`# Marca · ${sources.name}${handle}`, "", BRAND_FILE_LEGEND];

  for (const section of SECTIONS) {
    const facts = sources.facts.filter((fact) => section.kinds.includes(fact.kind));

    lines.push("", `## ${section.title}`, ...groupedLines(facts));
  }

  const legacy = sources.legacy.filter((document) => document.content.trim());

  if (legacy.length > 0) {
    lines.push(
      "",
      `## ${LEGACY_HEADING}`,
      "Trazidas das antigas anotações e memória da Vanda. Ao usar algo daqui, mova para a seção certa com a origem.",
    );

    // Inline what fits the always-on budget, preferences first; point to the rest.
    const preferencesFirst = legacy.toSorted(
      (a, b) => Number(!PREFERENCE_PATHS.has(a.path)) - Number(!PREFERENCE_PATHS.has(b.path)),
    );

    for (const document of preferencesFirst) {
      const block = ["", `### ${document.path}`, "", document.content.trim()];
      const candidate = `${[...lines, ...block].join("\n")}\n`;

      if (brandFileBytes(candidate) <= MAX_BRAND_FILE_BYTES - LEGACY_REFERENCE_MARGIN)
        lines.push(...block);
      else
        lines.push(
          "",
          `- Nota longa antiga em ${legacyPath(document.path)}; leia quando precisar e traga para cá só o essencial.`,
        );
    }
  }

  return `${lines.join("\n")}\n`;
}

/** The one parser: "## " sections with their "- " items in file order; stops at the legacy notes unless `legacy`. */
const walk = (content: string, legacy = false) => {
  const sections: { title: string; items: string[] }[] = [];

  for (const line of content.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);

    if (heading) {
      if (heading[1] === LEGACY_HEADING && !legacy) break;

      sections.push({ title: heading[1]!, items: [] });
      continue;
    }

    const text = /^\s*[-*]\s+(.+?)\s*$/.exec(line)?.[1]?.trim();
    const section = sections.at(-1);

    if (section && text) section.items.push(text);
  }

  return sections;
};

/** The titles of the sections that have at least one item. */
const filledTitles = (content: string) =>
  new Set(
    walk(content)
      .filter((section) => section.items.length > 0)
      .map((section) => section.title),
  );

/** Every item under its section, the legend excluded; legacy notes included (marca-N ids). */
export const brandFileFacts = (content: string) =>
  walk(content, true)
    .flatMap((section) => section.items.map((text) => ({ kind: section.title, text })))
    .map((fact, index) => ({ id: `marca-${index + 1}`, kind: fact.kind, text: fact.text }));

/** The balanced "(…)" closing a text (trailing punctuation ignored), parentheses nested inside it included. */
const trailingGroup = (text: string): { index: number; inner: string } | null => {
  const trimmed = text.replace(/[\s.;,]+$/, "");

  if (!trimmed.endsWith(")")) return null;

  for (let index = trimmed.length - 1, depth = 0; index >= 0; index--) {
    if (trimmed[index] === ")") depth++;
    else if (trimmed[index] === "(" && --depth === 0)
      return { index, inner: trimmed.slice(index + 1, -1) };
  }

  return null;
};

const parseOutlineItem = (line: string) => {
  const origin = trailingGroup(line);
  const body = (origin ? line.slice(0, origin.index) : line).trim();
  const colon = body.indexOf(": ");
  const prefix = colon > 0 ? body.slice(0, colon) : "";
  const label = prefix && prefix.length <= 30 && !/[(!]/.test(prefix) ? prefix : null;

  return {
    label,
    text: (label ? body.slice(colon + 2) : body).trim(),
    origin: origin?.inner.trim() || "dono",
  };
};

/** The brand file as sections of labelled items; every "## " is a section, empty ones too. */
export const brandFileOutline = (content: string) =>
  walk(content).map(({ title, items }) => ({ title, items: items.map(parseOutlineItem) }));

type Outline = ReturnType<typeof brandFileOutline>;

const designItems = (outline: Outline) =>
  outline.find((section) => section.title === DESIGN_SECTION)?.items ?? [];

/** The texts of the Design items with one label, markdown and origin dropped, joined by "; ". */
export const designText = (outline: Outline, label: string): string =>
  designItems(outline)
    .filter((item) => item.label === label)
    .map((item) =>
      item.text
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\*\*|__|[*`]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("; ");

/** The palette, typography and logo of the Design section, as the Perfil view shows them. */
export const brandFileDesign = (outline: Outline, images: Record<string, string>) => {
  const items = designItems(outline);
  const logo = items.find((item) => item.label === DESIGN_LABELS.logo);
  const imageId = logo ? /\(image:([a-z0-9]+)\)/.exec(logo.text)?.[1] : undefined;

  return {
    // One swatch per "#hex" segment, split on ";"; the last "(…)" of a segment is its role.
    palette: items
      .filter((item) => item.label === DESIGN_LABELS.palette)
      .flatMap((item) =>
        item.text.split(";").flatMap((segment) => {
          const hex = /#[0-9a-f]{3,8}\b/i.exec(segment);

          if (!hex) return [];

          const rest =
            `${segment.slice(0, hex.index)} ${segment.slice(hex.index + hex[0].length)}`.trim();

          const role = trailingGroup(rest);

          return [
            {
              hex: hex[0],
              name: (role ? rest.slice(0, role.index) : rest).replace(/[\s.;,]+$/, ""),
              role: role?.inner.trim() || null,
            },
          ];
        }),
      ),
    typography: designText(outline, DESIGN_LABELS.typography),
    logoUrl: (imageId && images[imageId]) ?? null,
  };
};

export type BrandFileDesign = ReturnType<typeof brandFileDesign>;

/** The onboarding kinds the file covers: a section with at least one item covers its kinds. */
export function brandFileKinds(content: string): BrandFactKind[] {
  const filled = filledTitles(content);

  return SECTIONS.flatMap((section) => (filled.has(section.title) ? section.kinds : []));
}

const getStored = (ctx: QueryCtx, accountId: Id<"accounts">) =>
  ctx.db
    .query("workspaceFiles")
    .withIndex("by_account_path", (q) => q.eq("accountId", accountId).eq("path", BRAND_FILE_PATH))
    .unique();

/** The old notes and memory documents of an account, as they were stored. */
export const legacyDocuments = async (ctx: QueryCtx, accountId: Id<"accounts">) => {
  const notes = await ctx.db
    .query("workspaceFiles")
    .withIndex("by_account_path", (q) => q.eq("accountId", accountId).eq("path", "/brand/notes.md"))
    .unique();

  const memory = await ctx.db
    .query("workspaceFiles")
    .withIndex("by_account_path", (q) =>
      q.eq("accountId", accountId).gte("path", "/memory/").lt("path", "/memory/￿"),
    )
    .collect();

  return [...(notes ? [notes] : []), ...memory].map(({ path, content }) => ({ path, content }));
};

// Accounts from before the brand file seed their file once from brandCanon, which nothing writes now.
const composeFor = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  onboarding?: readonly BrandFact[],
) => {
  const account = await ctx.db.get(accountId);

  const facts =
    onboarding ??
    (
      await ctx.db
        .query("brandCanon")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    ).filter((fact) => fact.confirmedByOwner);

  return composeBrandFile({
    name: account?.name ?? account?.handle ?? "Novo negócio",
    handle: account?.handle,
    facts,
    legacy: await legacyDocuments(ctx, accountId),
  });
};

/** The brand file as the owner sees it; `persisted` is false until the first save, when it is composed. */
export async function loadBrandFile(ctx: QueryCtx, accountId: Id<"accounts">) {
  const stored = await getStored(ctx, accountId);

  if (stored)
    return {
      content: stored.content,
      persisted: true,
      updatedAt: stored.updatedAt,
      updatedBy: stored.updatedBy,
    };

  return {
    content: await composeFor(ctx, accountId),
    persisted: false,
    updatedAt: null,
    updatedBy: null,
  };
}

/** Each image the content links as `![…](image:<id>)`, with its row when it belongs to the account (null for a foreign or unknown id). */
const linkedImages = (ctx: QueryCtx, accountId: Id<"accounts">, content: string) =>
  Promise.all(
    [...new Set([...content.matchAll(/\(image:([^)\s]*)\)/g)].map((match) => match[1]!))].map(
      async (imageId) => {
        const id = ctx.db.normalizeId("images", imageId);
        const image = id ? await ctx.db.get(id) : null;

        return { imageId, image: image?.accountId === accountId ? image : null };
      },
    ),
  );

export async function saveBrandFile(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  content: string,
  author: DocumentAuthor,
): Promise<WorkspaceWriteResult> {
  const bytes = brandFileBytes(content);

  if (!content.trim()) return { ok: false, error: "o arquivo da marca não pode ficar vazio" };

  if (bytes > MAX_BRAND_FILE_BYTES) {
    return {
      ok: false,
      error: `o arquivo da marca passou do limite (${bytes} de ${MAX_BRAND_FILE_BYTES} bytes); nada foi gravado. Compacte sem perder itens (dono) e mova detalhes longos para /notes/<nome>.md.`,
    };
  }

  const foreign = (await linkedImages(ctx, accountId, content)).find((link) => link.image === null);

  if (foreign) {
    return {
      ok: false,
      error: `a imagem ${foreign.imageId} não é desta conta; use o imageId de um anexo ou de /brand/references, ou remova o link`,
    };
  }

  return saveDocument(ctx, accountId, BRAND_FILE_PATH, content, author);
}

/** Persists the composed file once, so later edits start from a stable document; true when it created one. */
export async function ensureBrandFile(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
): Promise<boolean> {
  if (await getStored(ctx, accountId)) return false;

  // Legacy content may exceed the budget; keep it whole rather than drop facts.
  await saveDocument(ctx, accountId, BRAND_FILE_PATH, await composeFor(ctx, accountId));

  return true;
}

/** Onboarding opens the brand file, replacing a retry's earlier one. */
export async function writeOnboardingBrandFile(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  facts: readonly BrandFact[],
) {
  await saveDocument(ctx, accountId, BRAND_FILE_PATH, await composeFor(ctx, accountId, facts));
}

/** The brand file's text as the agents see it, composed if it was never saved. */
export async function brandFileContent(ctx: QueryCtx, accountId: Id<"accounts">): Promise<string> {
  return (await loadBrandFile(ctx, accountId)).content;
}

/** The sections the guide counts as answered. Design needs its colors: a logo alone leaves posts guessing. */
const answeredTitles = (content: string) =>
  new Set(
    walk(content)
      .filter((section) =>
        section.title === DESIGN_SECTION
          ? section.items.some((item) => item.startsWith(`${DESIGN_LABELS.palette}:`))
          : section.items.length > 0,
      )
      .map((section) => section.title),
  );

/** Sections whose items come from results, never from the owner's word. */
const OBSERVED_SECTION = "O que funciona";

/**
 * The owner approved Caetano's draft: every (Vanda) guess in the identity sections
 * becomes (dono). Results and legacy notes stay as they are. Returns the new text
 * and how many items changed.
 */
interface ConfirmedBrandFile {
  content: string;
  confirmed: number;
}

export const confirmBrandGuesses = (content: string): ConfirmedBrandFile => {
  let section: string | null = null;
  let confirmed = 0;

  const lines = content.split("\n").map((line) => {
    const heading = /^##\s+(.+?)\s*$/.exec(line);

    // Legacy notes run to the end of the file, whatever headings they carry.
    if (heading && section !== LEGACY_HEADING) {
      section = heading[1]!;

      return line;
    }

    if (section === null || section === OBSERVED_SECTION || section === LEGACY_HEADING) return line;

    if (!/^\s*[-*]\s+/.test(line)) return line;

    const next = line.replace(/\(Vanda\)(\s*[.;,]?\s*)$/, "(dono)$1");

    if (next !== line) confirmed++;

    return next;
  });

  return { content: lines.join("\n"), confirmed };
};

/** The brand guide: the interview sections and whether each is answered, for the guide card. */
export const brandGuide = (content: string) => {
  const filled = answeredTitles(content);

  return SECTIONS.flatMap(({ title, discover }) =>
    discover ? [{ title, discover, filled: filled.has(title) }] : [],
  );
};

/** The guide card above Caetano's thread: which thread, and how far it got. */
export const guide = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await requireOwnedAccount(ctx, accountId);

    return {
      threadId: account.brandGuideThreadId ?? null,
      done: account.brandGuideDoneAt !== undefined,
      sections: brandGuide((await loadBrandFile(ctx, accountId)).content),
    };
  },
});

/** The account's brand guide thread: a chat turn there is Caetano's. */
export const guideThread = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<string | null> =>
    (await ctx.db.get(accountId))?.brandGuideThreadId ?? null,
});

/** The owner's view of a business's brand file. */
export const get = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);

    const file = await loadBrandFile(ctx, accountId);
    const images: Record<string, string> = {};

    for (const { imageId, image } of await linkedImages(ctx, accountId, file.content)) {
      const url = image ? await imageUrl(ctx, image) : null;

      if (url) images[imageId] = url;
    }

    const outline = brandFileOutline(file.content);

    return {
      ...file,
      bytes: brandFileBytes(file.content),
      maxBytes: MAX_BRAND_FILE_BYTES,
      outline,
      images,
      design: brandFileDesign(outline, images),
    };
  },
});

/** The owner edits the brand file directly; their edits are history like any other. */
export const save = mutation({
  args: { accountId: v.id("accounts"), content: v.string() },
  handler: async (ctx, { accountId, content }): Promise<void> => {
    await requireOwnedAccount(ctx, accountId);

    const result = await saveBrandFile(ctx, accountId, content, "owner");

    if (!result.ok) throw new Error(result.error);
  },
});
