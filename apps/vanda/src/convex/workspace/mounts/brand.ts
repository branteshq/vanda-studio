import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { assessBrandReadiness } from "../../pipeline/inputQuality";
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

const loadBrand = async (ctx: QueryCtx, accountId: Id<"accounts">) => {
  const account = await ctx.db.get(accountId);
  const connection = account?.connectionId ? await ctx.db.get(account.connectionId) : null;
  const canon = (
    await ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect()
  ).filter((item) => item.confirmedByOwner);
  const readiness = assessBrandReadiness({ confirmedKinds: canon.map((item) => item.kind) });
  return { account, handle: connection?.handle ?? null, canon, readiness };
};

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

const memoryMarkdown = (brand: Awaited<ReturnType<typeof loadBrand>>): string => {
  const lines = [
    "# Memória de marca",
    "",
    `Conta: ${brand.account?.name ?? "—"}${brand.handle ? ` (@${brand.handle})` : ""}`,
    `Prontidão do perfil: ${Math.round(brand.readiness.score * 100)}%` +
      (brand.readiness.missingRequired.length > 0
        ? ` — faltam: ${brand.readiness.missingRequired.join(", ")}`
        : ""),
    "",
    "## Fatos confirmados pelo dono",
    "",
  ];
  if (brand.canon.length === 0) {
    lines.push("(nenhum fato confirmado ainda — peça ao dono para completar o perfil)");
  }
  for (const item of brand.canon) lines.push(`- **${item.kind}**: ${item.text}`);
  return lines.join("\n");
};

/** The one writable file in /brand — free-form notes, gated by owner approval. */
const NOTES_PATH = "/brand/notes.md";

export const brandMount: WorkspaceMount = {
  root: "brand",
  summary: "memória de marca confirmada e fotos de referência autorizadas",
  writeHint:
    "memory.md e profile.json são projeções dos fatos confirmados pelo dono — eles mudam pelo fluxo de perfil. Anotações livres de marca vão em /brand/notes.md; notas de trabalho, em /memory/.",
  list: async (ctx, accountId, segments): Promise<WorkspaceEntry[] | null> => {
    if (segments.length === 0) {
      return [
        { name: "memory.md", kind: "file", summary: "fatos de marca confirmados pelo dono" },
        { name: "profile.json", kind: "file", summary: "handle, modo e prontidão do perfil" },
        {
          name: "notes.md",
          kind: "file",
          summary: "anotações livres de marca (gravável com aprovação do dono)",
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
    if (segments.length === 1 && segments[0] === "memory.md") {
      return { kind: "text", text: memoryMarkdown(await loadBrand(ctx, accountId)) };
    }
    if (segments.length === 1 && segments[0] === "notes.md") {
      return (
        (await readDocument(ctx, accountId, NOTES_PATH)) ?? {
          kind: "text",
          text: "(sem anotações ainda — grave em /brand/notes.md para criar)",
        }
      );
    }
    if (segments.length === 1 && segments[0] === "profile.json") {
      const brand = await loadBrand(ctx, accountId);
      return jsonFile({
        name: brand.account?.name ?? null,
        handle: brand.handle,
        kind: brand.account?.kind ?? null,
        mode: brand.account?.mode ?? null,
        readiness: brand.readiness,
      });
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
    if (segments.length !== 1 || segments[0] !== "notes.md") {
      return { ok: false, error: brandMount.writeHint };
    }
    return saveDocument(ctx, accountId, NOTES_PATH, content);
  },
};
