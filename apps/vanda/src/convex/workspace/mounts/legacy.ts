import { legacyDocuments, legacyPath } from "../../brandFile";
import type { WorkspaceMount } from "../types";

/**
 * Read-only view of the documents the brand file replaced (/brand/notes.md and
 * /memory/*.md). The brand file inlines what fits its budget and points here
 * for the rest, so nothing written before is lost.
 */
export const legacyMount: WorkspaceMount = {
  root: "legado",
  summary:
    "anotações e memória do formato antigo, substituídas pelo arquivo da marca (somente leitura)",
  writeHint: "o formato antigo não recebe mais gravações; use /brand/marca.md ou /notes/<nome>.md",
  list: async (ctx, accountId, segments) =>
    segments.length === 0
      ? (await legacyDocuments(ctx, accountId)).map((document) => ({
          name: legacyPath(document.path).slice("/legado/".length),
          kind: "file" as const,
          summary: document.content.split("\n")[0]?.slice(0, 60) ?? "",
        }))
      : null,
  read: async (ctx, accountId, segments) => {
    if (segments.length !== 1) return null;
    const wanted = `/legado/${segments[0]}`;

    const document = (await legacyDocuments(ctx, accountId)).find(
      (candidate) => legacyPath(candidate.path) === wanted,
    );

    return document ? { kind: "text", text: document.content } : null;
  },
};
