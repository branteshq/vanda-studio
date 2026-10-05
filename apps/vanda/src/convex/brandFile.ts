import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import type { brandCanonKinds } from "./pipeline/constants";
import { saveDocument, type DocumentAuthor } from "./workspace/documents";
import type { WorkspaceWriteResult } from "./workspace/types";

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

type CanonKind = BrandFactKind;

const SECTIONS: ReadonlyArray<{ title: string; kinds: readonly CanonKind[] }> = [
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
  },
  { title: "Público", kinds: ["audience"] },
  { title: "Tom e voz", kinds: ["voice", "character"] },
  { title: "Provas e credenciais", kinds: ["proof"] },
  { title: "Preferências", kinds: [] },
  { title: "Nunca fazer", kinds: ["restriction", "forbidden_claim"] },
  { title: "O que funciona", kinds: [] },
];

export const BRAND_FILE_LEGEND = [
  "A Vanda e o Caetano leem este arquivo em toda conversa. Cada item termina com a origem:",
  "",
  "- **(dono)**: você disse ou confirmou. Só muda se você pedir.",
  "- **(observado: evidência, data)**: aprendido com resultados. É revisado quando surgem novas evidências.",
  "- **(Vanda)**: padrão sugerido pela Vanda. Você pode mudar quando quiser.",
].join("\n");

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

// Room left for the reference lines of legacy notes that do not fit inline.
const LEGACY_REFERENCE_MARGIN = 1_000;

const PREFERENCE_PATHS = new Set(["/memory/preferences.md", "/memory/preferencias.md"]);

const prioritized = <Document extends { readonly path: string }>(
  documents: readonly Document[],
): Document[] =>
  documents.toSorted(
    (left, right) =>
      Number(!PREFERENCE_PATHS.has(left.path)) - Number(!PREFERENCE_PATHS.has(right.path)),
  );

/** Where an old document stays readable: /legado/brand-notes.md, /legado/memory-<name>. */
export const legacyPath = (path: string): string =>
  path === "/brand/notes.md"
    ? "/legado/brand-notes.md"
    : `/legado/memory-${path.slice("/memory/".length)}`;

interface BrandFileSources {
  readonly name: string;
  readonly handle?: string | null | undefined;
  readonly facts: ReadonlyArray<{ readonly kind: CanonKind; readonly text: string }>;
  /** Legacy documents (/brand/notes.md, /memory/*.md) carried over verbatim. */
  readonly legacy: ReadonlyArray<{ readonly path: string; readonly content: string }>;
}

/** The first version of a brand file, built from what the account already knows. */
export function composeBrandFile(sources: BrandFileSources): string {
  const lines = [
    `# Marca · ${sources.name}${sources.handle ? ` (@${sources.handle})` : ""}`,
    "",
    BRAND_FILE_LEGEND,
  ];

  for (const section of SECTIONS) {
    lines.push("", `## ${section.title}`);
    const facts = sources.facts.filter((fact) => section.kinds.includes(fact.kind));

    if (facts.length > 0) lines.push("");

    for (const fact of facts) lines.push(`- ${oneLine(fact.text)} (dono)`);
  }

  const legacy = sources.legacy.filter((document) => document.content.trim());

  if (legacy.length > 0) {
    lines.push(
      "",
      "## Notas anteriores",
      "",
      "Trazidas das antigas anotações e memória da Vanda. Ao usar algo daqui, mova para a seção certa com a origem.",
    );

    // Inline what fits the always-on budget, preferences first; point to the rest.
    for (const document of prioritized(legacy)) {
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

export interface BrandFileFact {
  /** Position in this exact text: stable for an immutable snapshot of it. */
  readonly id: string;
  /** The section title the item sits under. */
  readonly kind: string;
  readonly text: string;
}

/** Every item ("- …") of the brand file under its section, the legend excluded. */
export function brandFileFacts(content: string): BrandFileFact[] {
  const facts: BrandFileFact[] = [];
  let section: string | null = null;

  for (const line of content.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);

    if (heading) section = heading[1]!;
    else if (section && /^\s*[-*]\s+\S/.test(line))
      facts.push({
        id: `marca-${facts.length + 1}`,
        kind: section,
        text: line.replace(/^\s*[-*]\s+/, "").trim(),
      });
  }

  return facts;
}

/** The onboarding kinds the file covers: a section with at least one item covers its kinds. */
export function brandFileKinds(content: string): BrandFactKind[] {
  const filled = new Set(brandFileFacts(content).map((fact) => fact.kind));

  return SECTIONS.flatMap((section) => (filled.has(section.title) ? section.kinds : []));
}

const getStored = (ctx: QueryCtx, accountId: Id<"accounts">) =>
  ctx.db
    .query("workspaceFiles")
    .withIndex("by_account_path", (q) => q.eq("accountId", accountId).eq("path", BRAND_FILE_PATH))
    .unique();

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

// Accounts from before the brand file still have their confirmed facts in brandCanon,
// read only here to seed their file once; nothing writes that table anymore.
const composeFor = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  onboarding?: ReadonlyArray<{ readonly kind: CanonKind; readonly text: string }>,
): Promise<string> => {
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

export interface BrandFile {
  readonly content: string;
  /** False until the first save: the content is composed from legacy sources. */
  readonly persisted: boolean;
  readonly updatedAt: number | null;
  readonly updatedBy: string | null;
}

export async function loadBrandFile(ctx: QueryCtx, accountId: Id<"accounts">): Promise<BrandFile> {
  const stored = await getStored(ctx, accountId);

  if (stored) {
    return {
      content: stored.content,
      persisted: true,
      updatedAt: stored.updatedAt,
      updatedBy: stored.updatedBy,
    };
  }

  return {
    content: await composeFor(ctx, accountId),
    persisted: false,
    updatedAt: null,
    updatedBy: null,
  };
}

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

  return saveDocument(ctx, accountId, BRAND_FILE_PATH, content, author);
}

/**
 * Persist the composed file once, so later edits start from a stable document.
 * Returns whether it created one (migrations:brandFiles counts them).
 */
export async function ensureBrandFile(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
): Promise<boolean> {
  if (await getStored(ctx, accountId)) return false;

  // Legacy content may exceed the budget; keep it whole rather than drop facts.
  await saveDocument(ctx, accountId, BRAND_FILE_PATH, await composeFor(ctx, accountId));

  return true;
}

/** Onboarding's approved analysis opens the brand file (replacing a retry's earlier one). */
export async function writeOnboardingBrandFile(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  facts: ReadonlyArray<{ readonly kind: BrandFactKind; readonly text: string }>,
): Promise<void> {
  await saveDocument(ctx, accountId, BRAND_FILE_PATH, await composeFor(ctx, accountId, facts));
}

/** The brand file's text as the agents see it, composed if it was never saved. */
export async function brandFileContent(ctx: QueryCtx, accountId: Id<"accounts">): Promise<string> {
  return (await loadBrandFile(ctx, accountId)).content;
}

/** The owner's view of a business's brand file. */
export const get = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    const file = await loadBrandFile(ctx, accountId);

    return { ...file, bytes: brandFileBytes(file.content), maxBytes: MAX_BRAND_FILE_BYTES };
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
