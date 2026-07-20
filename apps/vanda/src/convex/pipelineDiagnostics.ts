import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { independentEvidenceCount } from "./pipeline/discernment";
import { defaultPolicy } from "./pipeline/memory";

export type PipelineReceiptState =
  | "idle"
  | "running"
  | "failed"
  | "waiting_for_evidence"
  | "filtered"
  | "ready"
  | "complete";

export interface PipelineStageReceipt {
  stage: Doc<"modelRuns">["stage"];
  model: string;
  status: Doc<"modelRuns">["status"];
  summary: string | null;
  error: string | null;
  durationMs: number | null;
}

export interface RejectedProposalReceipt {
  title: string;
  reason: string;
}

export interface PipelineReceipt {
  state: PipelineReceiptState;
  startedAt: number | null;
  completedAt: number | null;
  signals: {
    total: number;
    actionable: number;
    discarded: number;
    pending: number;
  };
  beliefs: {
    total: number;
    eligible: number;
  };
  proposals: {
    generated: number;
    accepted: number;
    rejected: number;
    rejectedItems: RejectedProposalReceipt[];
  };
  stages: PipelineStageReceipt[];
}

const receiptState = (
  startedAt: number | null,
  stages: PipelineStageReceipt[],
  eligibleBeliefs: number,
  acceptedProposals: number,
  rejectedProposals: number,
): PipelineReceiptState => {
  if (startedAt === null) return "idle";
  if (stages.some((stage) => stage.status === "failed")) return "failed";
  if (stages.some((stage) => stage.status === "running")) return "running";
  if (eligibleBeliefs === 0) return "waiting_for_evidence";
  if (rejectedProposals > 0 && acceptedProposals === 0) return "filtered";
  if (acceptedProposals > 0) return "ready";
  return "complete";
};

/** Build the durable receipt for the latest consolidation → plan pass. */
export const loadPipelineReceipt = async (
  ctx: QueryCtx,
  accountId: Id<"accounts">,
): Promise<PipelineReceipt> => {
  const recentRuns = await ctx.db
    .query("modelRuns")
    .withIndex("by_account_started", (q) => q.eq("accountId", accountId))
    .order("desc")
    .take(50);
  const latestConsolidate = recentRuns.find((run) => run.stage === "consolidate") ?? null;
  const startedAt = latestConsolidate?.startedAt ?? null;
  const passRuns = startedAt === null ? [] : recentRuns.filter((run) => run.startedAt >= startedAt);
  const latestByStage = new Map<Doc<"modelRuns">["stage"], Doc<"modelRuns">>();
  for (const run of passRuns) {
    if (!latestByStage.has(run.stage)) latestByStage.set(run.stage, run);
  }
  const stages: PipelineStageReceipt[] = [];
  for (const run of latestByStage.values()) {
    stages.unshift({
      stage: run.stage,
      model: run.model,
      status: run.status,
      summary: run.outputSummary ?? null,
      error: run.error ?? null,
      durationMs: run.completedAt === undefined ? null : run.completedAt - run.startedAt,
    });
  }

  const [signals, beliefs, policy, proposals] = await Promise.all([
    ctx.db
      .query("signals")
      .withIndex("by_account_consolidated", (q) => q.eq("accountId", accountId))
      .collect(),
    ctx.db
      .query("beliefs")
      .withIndex("by_account_status", (q) => q.eq("accountId", accountId))
      .collect(),
    ctx.db
      .query("policies")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .first(),
    startedAt === null
      ? Promise.resolve([])
      : ctx.db
          .query("suggestions")
          .withIndex("by_account_created", (q) =>
            q.eq("accountId", accountId).gte("createdAt", startedAt),
          )
          .collect(),
  ]);

  const activePolicy = policy ?? defaultPolicy;
  const eligibleBeliefs = beliefs.filter(
    (belief) =>
      belief.status === "active" &&
      belief.confidence >= activePolicy.minConfidence &&
      independentEvidenceCount(belief) >= activePolicy.minEvidence,
  ).length;
  const rejected = proposals.filter((proposal) => proposal.status === "rejected");
  const accepted = proposals.length - rejected.length;
  const completedAt = passRuns.reduce<number | null>(
    (latest, run) =>
      run.completedAt === undefined ? latest : Math.max(latest ?? 0, run.completedAt),
    null,
  );

  return {
    state: receiptState(startedAt, stages, eligibleBeliefs, accepted, rejected.length),
    startedAt,
    completedAt,
    signals: {
      total: signals.length,
      actionable: signals.filter((signal) => signal.actionable === true).length,
      discarded: signals.filter((signal) => signal.actionable === false).length,
      pending: signals.filter(
        (signal) => signal.noise !== true && signal.consolidatedAt === undefined,
      ).length,
    },
    beliefs: { total: beliefs.length, eligible: eligibleBeliefs },
    proposals: {
      generated: proposals.length,
      accepted,
      rejected: rejected.length,
      rejectedItems: rejected.slice(0, 3).map((proposal) => ({
        title: proposal.title,
        reason: proposal.rejectionReason ?? "A proposta não passou pela revisão de qualidade.",
      })),
    },
    stages,
  };
};
