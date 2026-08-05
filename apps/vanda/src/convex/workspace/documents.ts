import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  formatDate,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceMount,
  type WorkspaceWriteResult,
} from "./types";

/**
 * Document store backing the writable files of the workspace (/memory,
 * /templates, /brand/notes.md). Unlike the projected views, these files ARE
 * the data: workspaceFiles holds the head of each file, workspaceFileRevisions
 * an append-only history of every write (audit trail and undo safety).
 */

export const MAX_DOCUMENT_CHARS = 64_000;

/** Flat, url-safe file names only: "plano-agosto.md" — no dirs, no spaces. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const validName = (name: string, extension: string): boolean =>
  name.endsWith(extension) &&
  name.length > extension.length &&
  name.length <= 80 &&
  NAME_PATTERN.test(name);

const getDocument = (ctx: QueryCtx, accountId: Id<"accounts">, path: string) =>
  ctx.db
    .query("workspaceFiles")
    .withIndex("by_account_path", (q) => q.eq("accountId", accountId).eq("path", path))
    .unique();

export const listDocuments = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  prefix: string,
): Promise<WorkspaceEntry[]> => {
  const files = await ctx.db
    .query("workspaceFiles")
    .withIndex("by_account_path", (q) =>
      q.eq("accountId", accountId).gte("path", prefix).lt("path", prefix + "\uffff"),
    )
    .collect();
  return files.map((file) => ({
    name: file.path.slice(prefix.length),
    kind: "file",
    summary: `${file.content.split("\n")[0]?.slice(0, 60) ?? ""} · ${formatDate(file.updatedAt)}`,
  }));
};

export const readDocument = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  path: string,
): Promise<WorkspaceFile | null> => {
  const document = await getDocument(ctx, accountId, path);
  return document ? { kind: "text", text: document.content } : null;
};

/** Upsert the head and append a revision. Content must be pre-validated. */
export const saveDocument = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  path: string,
  content: string,
): Promise<WorkspaceWriteResult> => {
  if (content.length > MAX_DOCUMENT_CHARS) {
    return {
      ok: false,
      error: `conteúdo grande demais (${content.length} caracteres; máximo ${MAX_DOCUMENT_CHARS}) — divida em arquivos menores`,
    };
  }
  const now = Date.now();
  const existing = await getDocument(ctx, accountId, path);
  if (existing) {
    await ctx.db.patch(existing._id, { content, updatedAt: now, updatedBy: "vanda" });
  } else {
    await ctx.db.insert("workspaceFiles", {
      accountId,
      path,
      content,
      updatedAt: now,
      updatedBy: "vanda",
    });
  }
  await ctx.db.insert("workspaceFileRevisions", {
    accountId,
    path,
    content,
    savedAt: now,
    savedBy: "vanda",
  });
  return { ok: true, path, note: existing ? "atualizado" : "criado" };
};

/** A flat, fully writable mount of documents sharing one extension. */
export const documentMount = (config: {
  root: string;
  summary: string;
  extension: string;
}): WorkspaceMount => {
  const prefix = `/${config.root}/`;
  return {
    root: config.root,
    summary: config.summary,
    writeHint: `grave em ${prefix}<nome>${config.extension}`,
    list: async (ctx, accountId, segments) =>
      segments.length === 0 ? listDocuments(ctx, accountId, prefix) : null,
    read: async (ctx, accountId, segments) =>
      segments.length === 1 ? readDocument(ctx, accountId, prefix + segments[0]!) : null,
    write: async (ctx, accountId, segments, content) => {
      const name = segments[0];
      if (segments.length !== 1 || !name) {
        return { ok: false, error: `escreva direto em ${prefix}<nome>${config.extension}` };
      }
      if (!validName(name, config.extension)) {
        return {
          ok: false,
          error: `nome inválido: ${name} — use minúsculas, números, hífens e a extensão ${config.extension} (ex.: ${prefix}plano-agosto${config.extension})`,
        };
      }
      return saveDocument(ctx, accountId, prefix + name, content);
    },
  };
};
