import type { brandCanonKinds } from "./pipeline/constants";

/**
 * The brand file's shape as plain text, shared by the server (brandFile.ts)
 * and the Perfil page that lays it out: its sections, its items and the origin
 * each item ends with.
 */

type BrandFactKind = (typeof brandCanonKinds)[number];

export const BRAND_FILE_SECTIONS: ReadonlyArray<{
  readonly title: string;
  readonly kinds: readonly BrandFactKind[];
}> = [
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

export type BrandFactOrigin = "dono" | "observado" | "vanda" | null;

export interface BrandFactWithOrigin {
  readonly text: string;
  readonly origin: BrandFactOrigin;
  /** The evidence and date of an "(observado: …)" item. */
  readonly detail: string | null;
}

/** An item's text and the origin it ends with: "(dono)", "(observado: …)" or "(Vanda)". */
export function factOrigin(text: string): BrandFactWithOrigin {
  const match = /\s*\((dono|vanda|observado)(?::\s*([^()]*))?\)\s*$/i.exec(text);

  if (!match) return { text, origin: null, detail: null };

  const kind = match[1]!.toLowerCase();
  const origin: BrandFactOrigin = kind === "dono" || kind === "vanda" ? kind : "observado";

  return { text: text.slice(0, match.index).trim(), origin, detail: match[2]?.trim() || null };
}
