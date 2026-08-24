import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import {
  formatDate,
  jsonFile,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceMount,
} from "../types";

const OBSERVATION_CAP = 200;

const loadObservations = async (ctx: QueryCtx, accountId: Id<"accounts">) => {
  const rows = await ctx.db
    .query("instagramObservations")
    .withIndex("by_account_observed", (q) => q.eq("accountId", accountId))
    .order("desc")
    .take(OBSERVATION_CAP);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.workspacePath)) latest.set(row.workspacePath, row);
  }
  return [...latest.values()];
};

const relativeSegments = (workspacePath: string): string[] =>
  workspacePath.split("/").filter(Boolean).slice(1);

const listChildren = (
  observations: Awaited<ReturnType<typeof loadObservations>>,
  segments: readonly string[],
): WorkspaceEntry[] => {
  const children = new Map<string, WorkspaceEntry>();
  for (const observation of observations) {
    const path = relativeSegments(observation.workspacePath);
    if (!segments.every((segment, index) => path[index] === segment)) continue;
    const name = path[segments.length];
    if (!name) continue;
    const isFile = path.length === segments.length + 1;
    const existing = children.get(name);
    if (!existing || existing.kind === "file") {
      children.set(name, {
        name,
        kind: isFile ? "file" : "dir",
        ...(isFile
          ? {
              summary: `${observation.source} · ${observation.completeness} · ${formatDate(observation.observedAt)}`,
            }
          : {}),
      });
    }
  }
  return [...children.values()].sort((left, right) => left.name.localeCompare(right.name));
};

export const instagramMount: WorkspaceMount = {
  root: "instagram",
  summary: "leituras normalizadas do Instagram conectado e de perfis públicos",
  writeHint: "dados observados — use as ferramentas read_instagram_* para atualizá-los.",
  list: async (ctx, accountId, segments): Promise<WorkspaceEntry[] | null> => {
    if (segments.length === 0) {
      return [
        { name: "self", kind: "dir", summary: "perfil conectado, posts e insights" },
        { name: "public", kind: "dir", summary: "perfis públicos consultados" },
        { name: "posts", kind: "dir", summary: "posts, comentários e insights por post" },
        { name: "searches", kind: "dir", summary: "buscas de perfis realizadas" },
      ];
    }
    if (!["self", "public", "posts", "searches"].includes(segments[0]!)) return null;
    return listChildren(await loadObservations(ctx, accountId), segments);
  },
  read: async (ctx, accountId, segments): Promise<WorkspaceFile | null> => {
    if (segments.length < 2) return null;
    const path = `/instagram/${segments.join("/")}`;
    const observation = (await loadObservations(ctx, accountId)).find(
      (row) => row.workspacePath === path,
    );
    if (!observation) return null;
    return jsonFile({
      source: observation.source,
      observedAt: new Date(observation.observedAt).toISOString(),
      expiresAt: new Date(observation.expiresAt).toISOString(),
      completeness: observation.completeness,
      nextCursor: observation.nextCursor ?? null,
      data: observation.payload,
    });
  },
};
