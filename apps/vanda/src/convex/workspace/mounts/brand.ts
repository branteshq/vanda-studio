import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { loadBrandFile, saveBrandFile } from "../../brandFile";
import { loadReferences, referenceLabelsOf } from "../../references";
import {
  entityName,
  imageFileParts,
  imageUrl,
  resolveByName,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceMount,
} from "../types";

const labelsText = (image: Doc<"images">) => referenceLabelsOf(image).join(", ");

// The brand writes: the file and its long-form notes. The workspace's write help shares it.
export const BRAND_WRITABLE =
  "/brand/marca.md (arquivo da marca, com a origem de cada item e a seção Design); detalhes longos vão em /notes/";

export const brandMount: WorkspaceMount = {
  root: "brand",
  summary: "arquivo da marca (memória do negócio, com a seção Design) e referências rotuladas",
  writeHint: `gravável aqui: ${BRAND_WRITABLE}`,
  list: async (ctx, accountId, segments): Promise<WorkspaceEntry[] | null> => {
    if (segments.length === 0) {
      return [
        {
          name: "marca.md",
          kind: "file",
          summary:
            "arquivo da marca: fatos, tom, preferências e aprendizados, com origem (gravável)",
        },
        {
          name: "references",
          kind: "dir",
          summary:
            "referências rotuladas (layout, style, face, product, place, logo, avoid); reference_search filtra por rótulo",
        },
      ];
    }

    if (segments.length === 1 && segments[0] === "references") {
      const references = await loadReferences(ctx, accountId);

      return references.map((image) => ({
        name: `${entityName(referenceLabelsOf(image)[0] ?? "referencia", image._id)}.${imageFileParts(image.mimeType).extension}`,
        kind: "file",
        summary:
          `${labelsText(image)}${image.width && image.height ? ` · ${image.width}×${image.height}` : ""}` +
          `${image.referenceNote ? ` · ${image.referenceNote.slice(0, 90)}` : ""}` +
          `${image.referenceSource ? ` · de ${image.referenceSource}` : ""} · id ${image._id}`,
      }));
    }

    return null;
  },
  read: async (ctx, accountId, segments): Promise<WorkspaceFile | null> => {
    if (segments.length === 1 && segments[0] === "marca.md") {
      return { kind: "text", text: (await loadBrandFile(ctx, accountId)).content };
    }

    if (segments.length === 2 && segments[0] === "references") {
      const references = await loadReferences(ctx, accountId);
      const image = resolveByName(segments[1]!, references);
      const url = image && (await imageUrl(ctx, image));

      if (!image || !url) return null;

      const labels = referenceLabelsOf(image);

      const use = labels.includes("face")
        ? "AUTORIZADA para condicionar geração de imagens com essa pessoa."
        : labels.includes("avoid")
          ? "O que a marca NÃO quer: guia o prompt, nunca vai em referenceImageIds."
          : "Disponível como referência para geração.";

      return {
        kind: "image",
        imageId: image._id,
        header:
          `Referência de marca (${labels.join(", ")}) · imageId ${image._id}` +
          `${image.width && image.height ? ` · ${image.width}×${image.height}` : ""}` +
          `${image.referenceSource ? ` · de ${image.referenceSource}` : ""}\n` +
          `${image.referenceNote ?? image.description ?? ""}\n${use}`,
        url,
        mimeType: imageFileParts(image.mimeType).mimeType,
      };
    }

    return null;
  },
  write: async (ctx, accountId, segments, content) => {
    if (segments.length === 1 && segments[0] === "marca.md") {
      return saveBrandFile(ctx, accountId, content, "vanda");
    }

    return { ok: false, error: brandMount.writeHint };
  },
};
