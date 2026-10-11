import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { loadBrandFile, saveBrandFile } from "../../brandFile";
import {
  entityName,
  imageFileParts,
  imageUrl,
  resolveByName,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceMount,
} from "../types";

const loadReferences = async (ctx: QueryCtx, accountId: Id<"accounts">) => {
  const images = await ctx.db
    .query("images")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .collect();

  return images.filter((image) => image.purpose === "reference");
};

const REFERENCE_LABELS = {
  face: "rosto",
  product: "produto",
  place: "lugar",
  style: "estilo",
};

const referenceLabel = (image: { referenceKind?: keyof typeof REFERENCE_LABELS | undefined }) =>
  image.referenceKind ? REFERENCE_LABELS[image.referenceKind] : "referencia";

// The brand writes: the file and its long-form notes. The workspace's write help shares it.
export const BRAND_WRITABLE =
  "/brand/marca.md (arquivo da marca, com a origem de cada item e a seção Design); detalhes longos vão em /notes/";

export const brandMount: WorkspaceMount = {
  root: "brand",
  summary: "arquivo da marca (memória do negócio, com a seção Design) e fotos de referência",
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
        { name: "references", kind: "dir", summary: "fotos de referência (rosto, produto, lugar)" },
      ];
    }

    if (segments.length === 1 && segments[0] === "references") {
      const references = await loadReferences(ctx, accountId);

      return references.map((image) => ({
        name: `${entityName(referenceLabel(image), image._id)}.${imageFileParts(image.mimeType).extension}`,
        kind: "file",
        summary:
          `${referenceLabel(image)}${image.width && image.height ? ` · ${image.width}×${image.height}` : ""}` +
          `${image.description ? ` · ${image.description.slice(0, 60)}` : ""} · id ${image._id}`,
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

      const authorized =
        image.referenceKind === "face"
          ? "AUTORIZADA para condicionar geração de imagens com essa pessoa."
          : "Disponível como referência para geração.";

      return {
        kind: "image",
        imageId: image._id,
        header:
          `Referência de marca (${referenceLabel(image)}) · imageId ${image._id}` +
          `${image.width && image.height ? ` · ${image.width}×${image.height}` : ""}\n` +
          `${image.description ?? ""}\n${authorized}`,
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
