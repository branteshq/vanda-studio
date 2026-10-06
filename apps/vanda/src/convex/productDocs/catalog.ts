import { renderSettingsReference } from "../settings/catalog";
import { PRODUCT_DOC_SOURCES } from "./generated";
import type { ProductDocSource } from "./types";

export type ProductDoc = ProductDocSource;

const settingsPage: ProductDoc = {
  slug: "configuracoes",
  title: "Configurações",
  description:
    "Todas as configurações da plataforma, onde ficam no app e quais a Vanda e o Caetano podem alterar.",
  order: 90,
  keywords: "configuracao configuracoes ajustes settings registro opcoes alterar",
  markdown: renderSettingsReference(),
};

/** Every docs page in reading order: the Markdown sources plus the generated settings reference. */
export const productDocs = (): readonly ProductDoc[] =>
  [...PRODUCT_DOC_SOURCES, settingsPage].toSorted(
    (left, right) => left.order - right.order || left.slug.localeCompare(right.slug),
  );

export const findProductDoc = (slug: string): ProductDoc | undefined =>
  productDocs().find((doc) => doc.slug === slug);

const normalize = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const STOP_WORDS = new Set(
  "a as o os de da das do dos e em no na nos nas um uma para por com que como qual quais onde meu minha meus minhas eu the and or to of for how my".split(
    " ",
  ),
);

const terms = (value: string): string[] =>
  normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));

interface Section {
  readonly heading: string;
  readonly text: string;
}

const sections = (doc: ProductDoc): Section[] =>
  doc.markdown.split(/\n(?=#{1,3} )/).map((chunk) => ({
    heading: chunk.split("\n", 1)[0]?.replace(/^#+\s*/, "") ?? "",
    text: chunk,
  }));

export interface ProductDocMatch {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly excerpt: string;
}

/**
 * Keyword search over the docs. Title, description and keywords count double,
 * and the excerpt is the section that matches the most terms.
 */
export function searchProductDocs(query: string, limit = 3): ProductDocMatch[] {
  const wanted = [...new Set(terms(query))];

  if (wanted.length === 0) return [];

  return productDocs()
    .map((doc) => {
      const header = new Set(terms(`${doc.slug} ${doc.title} ${doc.description} ${doc.keywords}`));
      const body = new Set(terms(doc.markdown));
      const headerHits = wanted.filter((term) => header.has(term)).length;
      const bodyHits = wanted.filter((term) => body.has(term)).length;
      const covered = wanted.filter((term) => header.has(term) || body.has(term)).length;
      // An incidental word is noise: a page must cover a third of the question's terms,
      // and a header hit or two body hits.
      const relevant = covered >= Math.ceil(wanted.length / 3) && (headerHits > 0 || bodyHits > 1);
      const score = relevant ? headerHits * 2 + bodyHits : 0;

      const best = sections(doc)
        .map((section) => {
          const words = new Set(terms(section.text));

          return { section, hits: wanted.filter((term) => words.has(term)).length };
        })
        .toSorted((left, right) => right.hits - left.hits)[0];

      return { doc, score, excerpt: best?.section.text.slice(0, 1200) ?? "" };
    })
    .filter((match) => match.score > 0)
    .toSorted((left, right) => right.score - left.score || left.doc.order - right.doc.order)
    .slice(0, limit)
    .map(({ doc, excerpt }) => ({
      slug: doc.slug,
      title: doc.title,
      description: doc.description,
      excerpt,
    }));
}
