import { v } from "convex/values";
import { z } from "zod";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { entityName, imageFileParts } from "./workspace/types";
import { referenceAuthors, referenceLabels, type ReferenceLabel } from "./pipeline/constants";

/**
 * References: account images labeled for what Vanda and Caetano should take from
 * them (layout, style, face, product, place, logo, avoid). Any image can be one
 * (a painted post, an owner upload, a chat attachment, a copy of an Instagram
 * post); the labels on the row are the whole mechanism, and finding them is a
 * label lookup, not a vision call.
 */

export const referenceLabelValidator = v.union(...referenceLabels.map((label) => v.literal(label)));

export const referenceAuthorValidator = v.union(
  ...referenceAuthors.map((author) => v.literal(author)),
);

export type ReferenceAuthor = (typeof referenceAuthors)[number];

/** Most references one search returns; paint takes a handful at most. */
export const MAX_REFERENCE_RESULTS = 24;

/** Notes are a line or two: what to take from the image, not a description of it. */
export const MAX_REFERENCE_NOTE = 400;

/** The labels of an image; legacy Perfil photos read from their old single kind. */
export const referenceLabelsOf = (
  image: Pick<Doc<"images">, "referenceLabels" | "purpose" | "referenceKind">,
): ReferenceLabel[] =>
  image.referenceLabels && image.referenceLabels.length > 0
    ? image.referenceLabels
    : image.purpose === "reference"
      ? [image.referenceKind ?? "style"]
      : [];

export const isReference = (
  image: Pick<Doc<"images">, "referenceLabels" | "purpose" | "referenceKind">,
): boolean => referenceLabelsOf(image).length > 0;

/** Unique labels in catalog order. */
export const normalizeLabels = (labels: readonly ReferenceLabel[]): ReferenceLabel[] =>
  referenceLabels.filter((label) => labels.includes(label));

const cleanNote = (note: string | undefined): string | undefined => {
  const trimmed = note?.replace(/\s+/g, " ").trim();

  return trimmed ? trimmed.slice(0, MAX_REFERENCE_NOTE) : undefined;
};

/** Every reference of an account, newest first. */
export const loadReferences = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
): Promise<Doc<"images">[]> => {
  const rows = await ctx.db
    .query("images")
    .withIndex("by_account_reference", (q) =>
      q.eq("accountId", accountId).gte("referenceAddedAt", 0),
    )
    .order("desc")
    .take(500);

  return rows.filter((image) => image.status === undefined && isReference(image));
};

export type ReferenceCounts = Partial<Record<ReferenceLabel, number>>;

export const countLabels = (images: readonly Doc<"images">[]): ReferenceCounts => {
  const counts: ReferenceCounts = {};

  for (const image of images)
    for (const label of referenceLabelsOf(image)) counts[label] = (counts[label] ?? 0) + 1;

  return counts;
};

/** "5 layout, 2 face": counts in catalog order. */
export const countsLine = (counts: ReferenceCounts): string =>
  referenceLabels
    .flatMap((label) => (counts[label] ? [`${counts[label]} ${label}`] : []))
    .join(", ");

const imageUrl = (ctx: QueryCtx, image: Doc<"images">): Promise<string | null> =>
  image.externalUrl
    ? Promise.resolve(image.externalUrl)
    : image.storageId
      ? ctx.storage.getUrl(image.storageId)
      : Promise.resolve(null);

export interface ReferenceView {
  imageId: Id<"images">;
  labels: ReferenceLabel[];
  note: string | null;
  source: string | null;
  addedBy: ReferenceAuthor | null;
  addedAt: number;
  useCount: number;
  name: string | null;
  width: number | null;
  height: number | null;
  url: string | null;
  /** Where read shows its pixels. */
  path: string;
}

export const toReferenceView = async (
  ctx: QueryCtx,
  image: Doc<"images">,
): Promise<ReferenceView> => ({
  imageId: image._id,
  labels: referenceLabelsOf(image),
  note: image.referenceNote ?? null,
  source: image.referenceSource ?? null,
  addedBy: image.referenceAddedBy ?? null,
  addedAt: image.referenceAddedAt ?? image.createdAt,
  useCount: image.referenceUseCount ?? 0,
  name: image.name ?? null,
  width: image.width ?? null,
  height: image.height ?? null,
  url: await imageUrl(ctx, image),
  path: `/brand/references/${entityName(referenceLabelsOf(image)[0] ?? "referencia", image._id)}.${imageFileParts(image.mimeType).extension}`,
});

export interface ReferenceSearchResult {
  total: number;
  counts: ReferenceCounts;
  matched: number;
  items: ReferenceView[];
}

export interface ReferenceSaved {
  imageId: Id<"images">;
  labels: ReferenceLabel[];
}

/** References with any of `labels` (all when empty), newest first, plus counts. */
export const search = internalQuery({
  args: {
    accountId: v.id("accounts"),
    labels: v.optional(v.array(referenceLabelValidator)),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { accountId, labels, limit }): Promise<ReferenceSearchResult> => {
    const all = await loadReferences(ctx, accountId);
    const wanted = new Set(labels ?? []);

    const matching =
      wanted.size === 0
        ? all
        : all.filter((image) => referenceLabelsOf(image).some((label) => wanted.has(label)));

    const size = Math.min(Math.max(1, Math.floor(limit ?? 8)), MAX_REFERENCE_RESULTS);

    return {
      total: all.length,
      counts: countLabels(all),
      matched: matching.length,
      items: await Promise.all(matching.slice(0, size).map((image) => toReferenceView(ctx, image))),
    };
  },
});

/** The reference fields one save may set; undefined removes a field. */
interface ReferencePatch {
  referenceLabels: ReferenceLabel[];
  referenceNote?: string | undefined;
  referenceSource?: string | undefined;
  referenceAddedAt?: number | undefined;
  referenceAddedBy?: ReferenceAuthor | undefined;
}

/** Labels (and optionally a note) on an image the account owns. */
export const applyReference = async (
  ctx: MutationCtx,
  image: Doc<"images">,
  update: {
    labels: readonly ReferenceLabel[];
    note?: string | undefined;
    source?: string | undefined;
    addedBy: ReferenceAuthor;
  },
): Promise<ReferenceLabel[]> => {
  if (image.status !== undefined) throw new Error("a imagem ainda não está pronta");

  const labels = normalizeLabels(update.labels);

  if (labels.length === 0) throw new Error("informe ao menos um rótulo");

  const patch: ReferencePatch = { referenceLabels: labels };

  // A given note replaces the old one; an empty one clears it.
  if (update.note !== undefined) patch.referenceNote = cleanNote(update.note);

  if (update.source !== undefined) patch.referenceSource = update.source;

  // Who first saved it and when stay; relabeling is not re-adding.
  if (!isReference(image) || image.referenceAddedAt === undefined) {
    patch.referenceAddedAt = Date.now();
    patch.referenceAddedBy = image.referenceAddedBy ?? update.addedBy;
  }

  await ctx.db.patch(image._id, patch);

  return labels;
};

/**
 * Stop using an image as a reference without deleting it. A Perfil photo or an
 * Instagram copy (purpose "reference") becomes an ordinary gallery upload.
 */
export const clearReference = async (ctx: MutationCtx, image: Doc<"images">): Promise<void> => {
  await ctx.db.patch(image._id, {
    referenceLabels: undefined,
    referenceNote: undefined,
    referenceSource: undefined,
    referenceAddedBy: undefined,
    referenceAddedAt: undefined,
    referenceKind: undefined,
    ...(image.purpose === "reference" && { purpose: "post" as const }),
  });
};

const ownedImage = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  imageId: Id<"images">,
): Promise<Doc<"images">> => {
  const image = await ctx.db.get(imageId);

  if (!image || image.accountId !== accountId) throw new Error("imagem não encontrada nesta conta");

  return image;
};

/** Agent save: label an existing account image. */
export const mark = internalMutation({
  args: {
    accountId: v.id("accounts"),
    imageId: v.id("images"),
    labels: v.array(referenceLabelValidator),
    note: v.optional(v.string()),
    source: v.optional(v.string()),
    addedBy: referenceAuthorValidator,
  },
  handler: async (ctx, { accountId, imageId, ...update }): Promise<ReferenceSaved> => {
    const image = await ownedImage(ctx, accountId, imageId);
    const labels = await applyReference(ctx, image, update);

    return { imageId, labels };
  },
});

/** Agent remove: the image stays, it just stops being a reference. */
export const unmark = internalMutation({
  args: { accountId: v.id("accounts"), imageId: v.id("images") },
  handler: async (
    ctx,
    { accountId, imageId },
  ): Promise<{ imageId: Id<"images">; removed: boolean }> => {
    const image = await ownedImage(ctx, accountId, imageId);

    if (!isReference(image)) return { imageId, removed: false };
    await clearReference(ctx, image);

    return { imageId, removed: true };
  },
});

/** Insert an imported copy (an Instagram post, a link) as a reference row. */
export const insertImported = internalMutation({
  args: {
    accountId: v.id("accounts"),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    name: v.string(),
    labels: v.array(referenceLabelValidator),
    note: v.optional(v.string()),
    source: v.string(),
    addedBy: referenceAuthorValidator,
  },
  handler: async (ctx, args) => {
    const labels = normalizeLabels(args.labels);

    if (labels.length === 0) throw new Error("informe ao menos um rótulo");
    const note = cleanNote(args.note);
    const now = Date.now();

    return ctx.db.insert("images", {
      accountId: args.accountId,
      origin: "uploaded",
      purpose: "reference",
      storageId: args.storageId,
      mimeType: args.mimeType,
      name: args.name.slice(0, 120),
      referenceLabels: labels,
      referenceSource: args.source,
      referenceAddedBy: args.addedBy,
      referenceAddedAt: now,
      createdAt: now,
      ...(note !== undefined && { referenceNote: note }),
      ...(args.width !== undefined && { width: args.width }),
      ...(args.height !== undefined && { height: args.height }),
    });
  },
});

/** One reference already copied from this Instagram post, to keep saves idempotent. */
export const findBySource = internalQuery({
  args: { accountId: v.id("accounts"), source: v.string() },
  handler: async (ctx, { accountId, source }) => {
    const all = await loadReferences(ctx, accountId);

    return all.find((image) => image.referenceSource === source)?._id ?? null;
  },
});

/** Count paint uses so the owner sees which references actually work. */
export const recordUse = internalMutation({
  args: { accountId: v.id("accounts"), imageIds: v.array(v.id("images")) },
  handler: async (ctx, { accountId, imageIds }) => {
    const now = Date.now();

    for (const imageId of new Set(imageIds)) {
      const image = await ctx.db.get(imageId);

      if (!image || image.accountId !== accountId || !isReference(image)) continue;
      await ctx.db.patch(imageId, {
        referenceUseCount: (image.referenceUseCount ?? 0) + 1,
        referenceLastUsedAt: now,
      });
    }
  },
});

// --- Instagram copies ----------------------------------------------------------

const nonEmpty = z
  .string()
  .optional()
  .catch(undefined)
  .transform((value) => (value ? value : undefined));

/** The fields a reference copy needs from one stored post; anything else is ignored. */
const storedPostSchema = z.object({
  id: nonEmpty,
  url: nonEmpty,
  shortcode: nonEmpty,
  ownerHandle: nonEmpty,
  caption: nonEmpty,
  mediaType: nonEmpty,
  mediaUrl: nonEmpty,
  thumbnailUrl: nonEmpty,
});

type StoredPost = z.infer<typeof storedPostSchema>;

const storedPostsSchema = z
  .array(z.unknown())
  .catch([])
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = storedPostSchema.safeParse(item);

      return parsed.success ? [parsed.data] : [];
    }),
  );

/** Posts a stored Instagram read carries: a posts list, one post, or a profile's latest. */
const postsOf = (payload: Doc<"instagramObservations">["payload"]): StoredPost[] => {
  const list = storedPostsSchema.parse(payload);

  if (list.length > 0) return list;

  const nested = z
    .object({
      items: z.array(z.unknown()).optional(),
      posts: z.array(z.unknown()).optional(),
      latestPosts: z.array(z.unknown()).optional(),
      data: z.array(z.unknown()).optional(),
    })
    .safeParse(payload);

  if (nested.success) {
    const { items, posts, latestPosts, data } = nested.data;
    const found = items ?? posts ?? latestPosts ?? data;

    if (found) return storedPostsSchema.parse(found);
  }

  const single = storedPostSchema.safeParse(payload);

  return single.success && single.data.id ? [single.data] : [];
};

const shortcodeOf = (url: string): string | undefined =>
  /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([^/?#]+)/.exec(url)?.[1];

/**
 * The image of a post Vanda already read with read_instagram_posts or
 * read_instagram_post, from the stored observation. Instagram media links expire,
 * so a save must follow a recent read.
 */
export const instagramMedia = internalQuery({
  args: { accountId: v.id("accounts"), post: v.string() },
  handler: async (ctx, { accountId, post }) => {
    const wanted = post.trim();
    const wantedShortcode = shortcodeOf(wanted);

    const observations = await ctx.db
      .query("instagramObservations")
      .withIndex("by_account_observed", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(60);

    for (const observation of observations) {
      for (const item of postsOf(observation.payload)) {
        const { id, url } = item;
        const shortcode = item.shortcode ?? (url ? shortcodeOf(url) : undefined);

        const matches =
          id === wanted ||
          url === wanted ||
          (wantedShortcode !== undefined && shortcode === wantedShortcode) ||
          shortcode === wanted;

        if (!matches) continue;
        const media = item.thumbnailUrl ?? (item.mediaType === "video" ? undefined : item.mediaUrl);

        if (!media) continue;

        // Stored targets read "self" (the connected account) or "public:<handle>".
        const handle =
          item.ownerHandle ??
          (observation.target.startsWith("public:") ? observation.target.slice(7) : "instagram");

        return {
          mediaUrl: media,
          postId: id ?? wanted,
          postUrl: url ?? null,
          handle: handle === "instagram" || handle.startsWith("@") ? handle : `@${handle}`,
          caption: item.caption?.slice(0, 80) ?? null,
        };
      }
    }

    return null;
  },
});

/** Width and height from a PNG, JPEG or WebP header; null when unknown. */
export const imageSize = (bytes: Uint8Array): { width: number; height: number } | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50)
    return { width: view.getUint32(16), height: view.getUint32(20) };

  if (bytes.length > 30 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));

    if (chunk === "VP8X")
      return {
        width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
        height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)),
      };

    if (chunk === "VP8 ")
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };

    if (chunk === "VP8L") {
      const b = view.getUint32(21, true);

      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
    }

    return null;
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;

    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      const length = view.getUint16(offset + 2);

      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };

      offset += 2 + length;
    }
  }

  return null;
};

const MAX_IMPORT_BYTES = 12 * 1024 * 1024;

/**
 * Copy an Instagram post's image into the account as a reference. Idempotent
 * per post: saving the same post again only relabels the existing copy.
 */
export const saveFromInstagram = internalAction({
  args: {
    accountId: v.id("accounts"),
    post: v.string(),
    labels: v.array(referenceLabelValidator),
    note: v.optional(v.string()),
    addedBy: referenceAuthorValidator,
  },
  handler: async (
    ctx,
    { accountId, post, labels, note, addedBy },
  ): Promise<ReferenceSaved & { source: string; copied: boolean }> => {
    const media = await ctx.runQuery(internal.references.instagramMedia, { accountId, post });

    if (!media)
      throw new Error(
        "post não encontrado nas leituras recentes: leia-o antes com read_instagram_posts (ou read_instagram_post) e passe o id ou a URL dele",
      );

    const source = `${media.handle} · ${media.postUrl ?? media.postId}`;
    const existing = await ctx.runQuery(internal.references.findBySource, { accountId, source });

    if (existing) {
      const saved = await ctx.runMutation(internal.references.mark, {
        accountId,
        imageId: existing,
        labels,
        addedBy,
        ...(note !== undefined && { note }),
      });

      return { ...saved, source, copied: false };
    }

    const response = await fetch(media.mediaUrl);

    if (!response.ok)
      throw new Error(
        `não consegui baixar a imagem do post (HTTP ${response.status}); leia os posts de novo para renovar o link`,
      );

    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error("imagem do post grande demais");
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";

    if (!mimeType.startsWith("image/")) throw new Error("o link do post não devolveu uma imagem");

    const storageId = await ctx.storage.store(new Blob([bytes], { type: mimeType }));
    const size = imageSize(bytes);

    const imageId = await ctx.runMutation(internal.references.insertImported, {
      accountId,
      storageId,
      mimeType,
      name: media.caption ? `${media.handle} · ${media.caption}` : `${media.handle} · post`,
      labels,
      source,
      addedBy,
      ...(note !== undefined && { note }),
      ...(size && { width: size.width, height: size.height }),
    });

    return { imageId, labels: normalizeLabels(labels), source, copied: true };
  },
});
