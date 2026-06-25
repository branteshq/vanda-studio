import { cancel, type WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { dropSignal, meetsEvidenceThreshold } from "./pipeline/discernment";
import { type Belief, defaultPolicy, type Policy } from "./pipeline/memory";

/** Strip Convex system fields so discernment's pure functions see clean domain data. */
const toBelief = (b: Doc<"beliefs">): Belief => ({
  accountId: b.accountId,
  statement: b.statement,
  kind: b.kind,
  confidence: b.confidence,
  supportingSignalIds: b.supportingSignalIds,
  firstSeenAt: b.firstSeenAt,
  confidenceAsOf: b.confidenceAsOf,
  status: b.status,
});

const policyFor = async (ctx: MutationCtx, accountId: Id<"accounts">): Promise<Policy> => {
  const row = await ctx.db
    .query("policies")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .first();
  return row ?? defaultPolicy;
};

/**
 * After a belief weakens, re-think the open ideas it grounds. Still clears the
 * evidence bar → nothing changes. Dropped below → each idea citing it moves to
 * `needs_you` with a reason, and a mid-create idea has its workflow canceled
 * first. The "se cair muito, te pergunta antes de seguir" gate.
 */
const rethinkBelief = async (ctx: MutationCtx, belief: Belief, policy: Policy): Promise<void> => {
  if (meetsEvidenceThreshold(belief, policy)) return;
  const accountId = belief.accountId as Id<"accounts">;
  const reason =
    `A crença "${belief.statement}" enfraqueceu ` +
    `(${Math.round(belief.confidence * 100)}%) — revise antes de seguir.`;
  const suggestions = await ctx.db
    .query("suggestions")
    .withIndex("by_account_status", (q) => q.eq("accountId", accountId))
    .collect();
  for (const s of suggestions) {
    if (!s.beliefStatements.includes(belief.statement)) continue;
    if (s.status !== "approved" && s.status !== "creating" && s.status !== "suggestion") continue;
    // Cancel an in-flight create before pausing the idea. onCreateComplete's
    // revert is guarded on status === "creating", so the needs_you we set sticks.
    if (s.status === "creating" && s.workflowId !== undefined) {
      await cancel(ctx, components.workflow, s.workflowId as WorkflowId);
    }
    await ctx.db.patch(s._id, {
      status: "needs_you",
      requiresApproval: true,
      rejectionReason: reason,
    });
  }
};

/**
 * Flag a signal as noise: drop it from every belief it supported, recompute each
 * belief's confidence (inverse-reinforce), and re-think the ideas they ground.
 * The owner steers the reasoning, not just the output.
 */
export const markSignalNoise = internalMutation({
  args: { signalId: v.id("signals") },
  handler: async (ctx, { signalId }) => {
    const signal = await ctx.db.get(signalId);
    if (signal === null || signal.noise === true) return;
    await ctx.db.patch(signalId, { noise: true });
    const policy = await policyFor(ctx, signal.accountId);
    const now = Date.now();
    const beliefs = await ctx.db
      .query("beliefs")
      .withIndex("by_account_status", (q) => q.eq("accountId", signal.accountId))
      .collect();
    for (const row of beliefs) {
      if (!row.supportingSignalIds.includes(signalId)) continue;
      const updated = dropSignal(toBelief(row), signalId, now, policy);
      await ctx.db.patch(row._id, {
        confidence: updated.confidence,
        confidenceAsOf: updated.confidenceAsOf,
        supportingSignalIds: [...updated.supportingSignalIds],
        status: updated.status,
      });
      await rethinkBelief(ctx, updated, policy);
    }
  },
});

/**
 * Correct a belief's wording. Confidence is untouched (only the statement
 * changed), so the ideas it grounds stay valid; we re-point their provenance to
 * the new wording so the lineage link survives. The next plan pass deliberates
 * with the corrected belief.
 */
export const correctBelief = internalMutation({
  args: { beliefId: v.id("beliefs"), statement: v.string() },
  handler: async (ctx, { beliefId, statement }) => {
    const row = await ctx.db.get(beliefId);
    if (row === null || row.statement === statement) return;
    const beliefs = await ctx.db
      .query("beliefs")
      .withIndex("by_account_status", (q) => q.eq("accountId", row.accountId))
      .collect();
    // Statements are the provenance key (suggestions cite them; consolidate upserts
    // by them), so they must stay unique per account — reject a colliding rename.
    if (beliefs.some((b) => b._id !== beliefId && b.statement === statement))
      throw new Error("another belief already holds that statement");
    const previous = row.statement;
    await ctx.db.patch(beliefId, { statement });
    const suggestions = await ctx.db
      .query("suggestions")
      .withIndex("by_account_status", (q) => q.eq("accountId", row.accountId))
      .collect();
    for (const s of suggestions) {
      if (!s.beliefStatements.includes(previous)) continue;
      await ctx.db.patch(s._id, {
        beliefStatements: s.beliefStatements.map((b) => (b === previous ? statement : b)),
      });
    }
  },
});
