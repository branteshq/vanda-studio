import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { modelStages } from "./pipeline/constants";

export const start = internalMutation({
  args: {
    accountId: v.id("accounts"),
    stage: v.union(...modelStages.map((stage) => v.literal(stage))),
    model: v.string(),
    promptVersion: v.string(),
    inputIds: v.array(v.string()),
  },
  handler: (ctx, args) =>
    ctx.db.insert("modelRuns", { ...args, status: "running", startedAt: Date.now() }),
});

export const finish = internalMutation({
  args: {
    runId: v.id("modelRuns"),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    outputSummary: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: (ctx, { runId, status, outputSummary, error }) => {
    const patch = {
      status,
      completedAt: Date.now(),
    };

    if (outputSummary !== undefined) Object.assign(patch, { outputSummary });

    if (error !== undefined) Object.assign(patch, { error });

    return ctx.db.patch(runId, patch);
  },
});
