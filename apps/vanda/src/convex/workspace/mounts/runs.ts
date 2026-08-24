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

const loadArtifacts = async (ctx: QueryCtx, codeRunId: Id<"codeRuns">) =>
  ctx.db
    .query("codeRunArtifacts")
    .withIndex("by_run", (q) => q.eq("codeRunId", codeRunId))
    .collect();

export const runsMount: WorkspaceMount = {
  root: "runs",
  summary: "execuções de run_code: código, logs e artefatos produzidos",
  writeHint:
    "histórico de execuções — somente leitura; promova código que deu certo para /templates/.",
  list: async (ctx, accountId, segments): Promise<WorkspaceEntry[] | null> => {
    const runs = await loadRuns(ctx, accountId);
    if (segments.length === 0) {
      return runs.map((run) => ({
        name: entityName(run.description, run._id),
        kind: "dir",
        summary:
          `${run.status} · ${formatDate(run.createdAt)}` +
          `${run.durationMs !== undefined ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ""}` +
          `${run.imageIds && run.imageIds.length > 0 ? ` · ${run.imageIds.length} imagem(ns)` : ""}`,
      }));
    }
    const run = resolveByName(segments[0]!, runs);
    if (!run) return null;
    const artifacts = await loadArtifacts(ctx, run._id);
    if (segments.length === 1) {
      return [
        { name: "run.json", kind: "file", summary: "código, logs e resultado da execução" },
        ...(artifacts.length > 0
          ? [{ name: "outputs", kind: "dir" as const, summary: `${artifacts.length} artefato(s)` }]
          : []),
      ];
    }
    if (segments.length === 2 && segments[1] === "outputs") {
      return artifacts.map((artifact) => ({
        name: artifact.filename,
        kind: "file",
        summary: `${artifact.mimeType} · ${artifact.content.length} caracteres`,
      }));
    }
    return null;
  },
  read: async (ctx, accountId, segments): Promise<WorkspaceFile | null> => {
    if (segments.length < 2) return null;
    const runs = await loadRuns(ctx, accountId);
    const run = resolveByName(segments[0]!, runs);
    if (!run) return null;
    if (segments.length === 2 && segments[1] === "run.json") {
      const artifacts = await loadArtifacts(ctx, run._id);
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
        artifacts: artifacts.map((artifact) => ({
          id: artifact._id,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
        })),
      });
    }
    if (segments.length === 3 && segments[1] === "outputs") {
      const artifact = (await loadArtifacts(ctx, run._id)).find(
        (candidate) => candidate.filename === segments[2],
      );
      return artifact ? { kind: "text", text: artifact.content } : null;
    }
    return null;
  },
};
