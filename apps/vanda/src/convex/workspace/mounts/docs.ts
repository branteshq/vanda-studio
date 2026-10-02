import { findProductDoc, productDocs } from "../../productDocs/catalog";
import type { WorkspaceMount } from "../types";

/** The product documentation (the app's /docs page), read-only, one file per page. */
export const docsMount: WorkspaceMount = {
  root: "docs",
  summary: "documentação do Vanda Studio: telas, recursos e configurações (somente leitura)",
  writeHint: "a documentação é mantida pelo time do Vanda Studio e não muda pela conversa",
  list: (_ctx, _accountId, segments) =>
    Promise.resolve(
      segments.length === 0
        ? productDocs().map((doc) => ({
            name: `${doc.slug}.md`,
            kind: "file" as const,
            summary: doc.description,
          }))
        : null,
    ),
  read: (_ctx, _accountId, segments) => {
    const [name, ...rest] = segments;
    const doc = name && rest.length === 0 ? findProductDoc(name.replace(/\.md$/, "")) : undefined;

    return Promise.resolve(doc ? { kind: "text" as const, text: doc.markdown } : null);
  },
};
