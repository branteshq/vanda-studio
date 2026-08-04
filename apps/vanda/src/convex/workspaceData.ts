import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { listPath, readPath, type ListResult, type ReadResult } from "./workspace";

/**
 * The workspace query surface for the agent's list/read tools. The accountId is
 * the chroot root — mounts only ever query by it, so cross-account paths are
 * structurally impossible. See docs/workspace-design.md.
 */

export const list = internalQuery({
  args: { accountId: v.id("accounts"), path: v.string() },
  handler: async (ctx, { accountId, path }): Promise<ListResult> => {
    if (!(await ctx.db.get(accountId))) throw new Error("account not found");
    return listPath(ctx, accountId, path);
  },
});

/** Text pagination is pi-shaped: 1-indexed `offset` line, `limit` lines. */
export const read = internalQuery({
  args: {
    accountId: v.id("accounts"),
    path: v.string(),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { accountId, path, offset, limit }): Promise<ReadResult> => {
    if (!(await ctx.db.get(accountId))) throw new Error("account not found");
    const result = await readPath(ctx, accountId, path);
    if (!result.ok || result.file.kind !== "text" || (offset === undefined && limit === undefined)) {
      return result;
    }
    const lines = result.file.text.split("\n");
    const start = Math.max(0, (offset ?? 1) - 1);
    const end = limit !== undefined ? start + limit : lines.length;
    const slice = lines.slice(start, end).join("\n");
    const note =
      end < lines.length || start > 0
        ? `\n\n[linhas ${start + 1}–${Math.min(end, lines.length)} de ${lines.length}]`
        : "";
    return { ...result, file: { kind: "text", text: slice + note } };
  },
});
