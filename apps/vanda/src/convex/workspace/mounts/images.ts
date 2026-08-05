import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { imageModelLabel } from "../../imageModels";
import {
  entityName,
  formatDate,
  imageFileParts,
  imageUrl,
  resolveByName,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceMount,
} from "../types";

/** Newest-first gallery window projected into /images. */
const LISTING_CAP = 100;

const loadGallery = async (ctx: QueryCtx, accountId: Id<"accounts">): Promise<Doc<"images">[]> => {
  const images = await ctx.db
    .query("images")
    .withIndex("by_account_created", (q) => q.eq("accountId", accountId))
    .order("desc")
    .take(LISTING_CAP * 2);
  // Same membership rule as the gallery UI: references live under /brand,
  // in-flight placeholders are not files yet.
  return images
    .filter((image) => image.purpose !== "reference" && image.status === undefined)
    .slice(0, LISTING_CAP);
};

const imageTitle = (image: Doc<"images">): string =>
  image.name ?? image.prompt?.split(/\s+/).slice(0, 4).join(" ") ?? "imagem";

const originLabel = (image: Doc<"images">): string =>
  image.origin === "uploaded" ? "enviada" : "gerada";

export const imagesMount: WorkspaceMount = {
  root: "images",
  summary: "galeria da conta (geradas e enviadas), mais recentes primeiro",
  writeHint:
    "a galeria muda por paint ou run_code, não por write.",
  list: async (ctx, accountId, segments): Promise<WorkspaceEntry[] | null> => {
    if (segments.length !== 0) return null;
    const images = await loadGallery(ctx, accountId);
    const entries: WorkspaceEntry[] = images.map((image) => ({
      name: `${entityName(imageTitle(image), image._id)}.${imageFileParts(image.mimeType).extension}`,
      kind: "file",
      summary:
        [
          image.width && image.height ? `${image.width}×${image.height}` : null,
          originLabel(image),
          image.model ? imageModelLabel(image.model) : null,
          image.prompt ? `"${image.prompt.slice(0, 60)}"` : null,
        ]
          .filter(Boolean)
          .join(" · ") + ` · id ${image._id}`,
    }));
    if (images.length === LISTING_CAP) {
      entries.push({
        name: "…",
        kind: "file",
        summary: `listagem limitada às ${LISTING_CAP} imagens mais recentes`,
      });
    }
    return entries;
  },
  read: async (ctx, accountId, segments): Promise<WorkspaceFile | null> => {
    if (segments.length !== 1) return null;
    const images = await loadGallery(ctx, accountId);
    const image = resolveByName(segments[0]!, images);
    if (!image) return null;
    const url = await imageUrl(ctx, image);
    if (!url) return null;
    const header = [
      `${imageTitle(image)} · ${originLabel(image)} · imageId ${image._id}`,
      image.width && image.height ? `${image.width}×${image.height}` : null,
      image.model ? `modelo: ${imageModelLabel(image.model)}` : null,
      image.prompt ? `prompt: ${image.prompt}` : null,
      image.costUsd !== undefined ? `custo: US$ ${image.costUsd.toFixed(4)}` : null,
      `criada em ${formatDate(image.createdAt)}`,
    ]
      .filter(Boolean)
      .join("\n");
    return { kind: "image", header, url, mimeType: imageFileParts(image.mimeType).mimeType };
  },
};
