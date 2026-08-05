import type { Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import {
  entityName,
  formatDate,
  jsonFile,
  resolveByName,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceMount,
} from "../types";

const LISTING_CAP = 30;

const loadRuns = async (ctx: QueryCtx, accountId: Id<"accounts">) =>
  ctx.db
    .query("codeRuns")
    .withIndex("by_account_created", (q) => q.eq("accountId", accountId))
    .order("desc")
    .take(LISTING_CAP);

export const runsMount: WorkspaceMount = {
  root: "runs",
  summary: "execuções de run_code: código, saída e imagens produzidas",
  writeHint:
    "histórico de execuções — somente leitura; promova código que deu certo para /templates/.",
  list: async (ctx, accountId, segments): Promise<WorkspaceEntry[] | null> => {
    if (segments.length !== 0) return null;
    const runs = await loadRuns(ctx, accountId);
    return runs.map((run) => ({
      name: `${entityName(run.description, run._id)}.json`,
      kind: "file",
      summary:
        `${run.status} · ${formatDate(run.createdAt)}` +
        `${run.durationMs !== undefined ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ""}` +
        `${run.imageIds && run.imageIds.length > 0 ? ` · ${run.imageIds.length} imagem(ns)` : ""}`,
    }));
  },
  read: async (ctx, accountId, segments): Promise<WorkspaceFile | null> => {
    if (segments.length !== 1) return null;
    const runs = await loadRuns(ctx, accountId);
    const run = resolveByName(segments[0]!, runs);
    if (!run) return null;
    return jsonFile({
      codeRunId: run._id,
      description: run.description,
      status: run.status,
      createdAt: formatDate(run.createdAt),
      durationMs: run.durationMs ?? null,
      costUsd: run.costUsd ?? null,
      code: run.code,
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? "",
      error: run.error ?? null,
      imageIds: run.imageIds ?? [],
    });
  },
};
