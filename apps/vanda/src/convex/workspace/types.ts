import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * The account workspace: a read-only virtual filesystem projected over the
 * domain tables. Each mount is a curated view (like /proc), not a table dump —
 * what a file contains is an API contract with the agent. See
 * docs/workspace-design.md.
 */

/** One row of a directory listing. `summary` is the agent's scan line. */
export interface WorkspaceEntry {
  readonly name: string;
  readonly kind: "dir" | "file";
  readonly summary?: string | undefined;
}

export type WorkspaceFile =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "image";
      /** Metadata header the model reads alongside the pixels. */
      readonly header: string;
      readonly url: string;
      readonly mimeType: string;
    };

export type WorkspaceWriteResult =
  | { readonly ok: true; readonly path: string; readonly note: string }
  | { readonly ok: false; readonly error: string };

/**
 * A mount resolves paths under its root. `segments` excludes the root segment.
 * Returning null means "no such path" — the resolver turns that into an
 * errors-as-navigation response (the nearest listing), never a bare not-found.
 *
 * Writes follow the VFS shape: one `write(path, content)` tool on the surface,
 * a per-mount handler underneath (like /proc's writable files). A mount with
 * no handler is a projection — its `writeHint` names the verb that changes the
 * underlying state, so a refused write teaches the model the right move.
 */
export interface WorkspaceMount {
  readonly root: string;
  /** One-liner shown when listing "/". */
  readonly summary: string;
  readonly list: (
    ctx: QueryCtx,
    accountId: Id<"accounts">,
    segments: readonly string[],
  ) => Promise<WorkspaceEntry[] | null>;
  readonly read: (
    ctx: QueryCtx,
    accountId: Id<"accounts">,
    segments: readonly string[],
  ) => Promise<WorkspaceFile | null>;
  /** Present only on mounts with writable files. */
  readonly write?: (
    ctx: MutationCtx,
    accountId: Id<"accounts">,
    segments: readonly string[],
    content: string,
  ) => Promise<WorkspaceWriteResult>;
  /** Returned when a write lands on this mount's read-only files. */
  readonly writeHint: string;
}

/** Length of the id suffix appended to entity names (`cafe-gelado-3kb2xq`). */
export const ID_SUFFIX_LENGTH = 6;

/** `promo de agosto ☕` → "promo-de-agosto"; never empty. */
export const slugify = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "") || "item";

/**
 * Stable 6-hex-char token derived from the entity id (FNV-1a). A hash instead
 * of the id's raw tail: Convex ids have no distribution guarantee at their
 * tail, and test ids all end in the table name — a hash keeps suffixes
 * discriminating everywhere while staying rename-proof.
 */
export const entitySuffix = (id: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(-ID_SUFFIX_LENGTH);
};

/** Stable, rename-proof entity name: slug is decoration, the id suffix is truth. */
export const entityName = (title: string, id: string): string =>
  `${slugify(title)}-${entitySuffix(id)}`;

/**
 * Resolve a path segment to an entity by its trailing id suffix. Accepts a full
 * id, a current or stale `slug-suffix` name, or a bare suffix — the suffix
 * alone decides. Returns null when nothing (or more than one thing) matches.
 */
export const resolveByName = <T extends { _id: string }>(
  segment: string,
  entities: readonly T[],
): T | null => {
  const base = segment.replace(/\.[a-z0-9]+$/i, "");
  const full = entities.find((entity) => entity._id === base);
  if (full) return full;
  const suffix = base.split("-").at(-1) ?? base;
  if (suffix.length !== ID_SUFFIX_LENGTH) return null;
  const matches = entities.filter((entity) => entitySuffix(entity._id) === suffix);
  return matches.length === 1 ? (matches[0] ?? null) : null;
};

/** Extension + mime for image files projected into the namespace. */
export const imageFileParts = (
  mimeType: string | undefined,
): { extension: string; mimeType: string } => {
  switch (mimeType) {
    case "image/png":
      return { extension: "png", mimeType };
    case "image/webp":
      return { extension: "webp", mimeType };
    case "image/gif":
      return { extension: "gif", mimeType };
    default:
      return { extension: "jpg", mimeType: "image/jpeg" };
  }
};

/** Resolve an image row's display URL (external or storage). */
export const imageUrl = async (
  ctx: QueryCtx,
  image: { externalUrl?: string | undefined; storageId?: Id<"_storage"> | undefined },
): Promise<string | null> => {
  if (image.externalUrl) return image.externalUrl;
  if (image.storageId) return ctx.storage.getUrl(image.storageId);
  return null;
};

/** Deterministic pretty JSON for .json views. */
export const jsonFile = (value: unknown): WorkspaceFile => ({
  kind: "text",
  text: JSON.stringify(value, null, 2),
});

export const formatDate = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 16).replace("T", " ") + " UTC";
