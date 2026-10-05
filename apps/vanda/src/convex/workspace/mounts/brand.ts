import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { loadBrandFile, saveBrandFile } from "../../brandFile";
import { validateBrandKit } from "../brandKit";
import { readDocument, saveDocument } from "../documents";
import {
  entityName,
  imageFileParts,
  imageUrl,
  jsonFile,
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

const referenceLabel = (image: { referenceKind?: string | undefined }): string => {
  switch (image.referenceKind) {
    case "face":
      return "rosto";
    case "product":
      return "produto";
    case "place":
      return "lugar";
    case "style":
      return "estilo";
    default:
      return "referencia";
  }
};

const KIT_PATH = "/brand/kit.json";

/** Read fallback that teaches the kit's schema in-band. */
const EMPTY_KIT = {
  colors: [],
  fonts: [],
  dica: 'sem identidade visual ainda — grave com write: {"colors":[{"hex":"#d81b60","name":"rosa","role":"primária"}],"fonts":[{"family":"Poppins","role":"títulos"}],"tagline":"..."}',
};

export const brandMount: WorkspaceMount = {
  root: "brand",
  summary: "arquivo da marca (memória do negócio), identidade visual e fotos de referência",
  writeHint:
    "graváveis aqui: /brand/marca.md (arquivo da marca, com a origem de cada item) e /brand/kit.json (identidade visual); detalhes longos vão em /notes/",
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
          name: "kit.json",
          kind: "file",
          summary: "identidade visual: cores exatas, fontes e tagline (gravável)",
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

    if (segments.length === 1 && segments[0] === "kit.json") {
      return (await readDocument(ctx, accountId, KIT_PATH)) ?? jsonFile(EMPTY_KIT);
    }

    if (segments.length === 2 && segments[0] === "references") {
      const references = await loadReferences(ctx, accountId);
      const image = resolveByName(segments[1]!, references);

      if (!image) return null;
      const url = await imageUrl(ctx, image);

      if (!url) return null;

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

    if (segments.length === 1 && segments[0] === "kit.json") {
      const kit = validateBrandKit(content);

      if (!kit.ok) return { ok: false, error: kit.error };

      return saveDocument(ctx, accountId, KIT_PATH, kit.normalized);
    }

    return { ok: false, error: brandMount.writeHint };
  },
};
