import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

/** Max run_code executions per account inside the rate window. */
export const CODE_RUN_RATE_LIMIT = 20;
export const CODE_RUN_RATE_WINDOW_MS = 5 * 60_000;

/**
 * Identity wall for run_code inputs, sibling of resolvePaintInput: only images
 * the account owns may be materialized into the sandbox. Returns the metadata
 * the sandbox's meta.json is built from.
 */
export const resolveCodeRunInput = internalQuery({
  args: {
    accountId: v.id("accounts"),
    inputImageIds: v.array(v.id("images")),
  },
  handler: async (ctx, { accountId, inputImageIds }) => {
    if (!(await ctx.db.get(accountId))) throw new Error("account not found");
    return Promise.all(
      inputImageIds.map(async (imageId) => {
        const image = await ctx.db.get(imageId);
        if (!image || image.accountId !== accountId) throw new Error("image not found");
        return {
          imageId: image._id,
          name: image.name ?? null,
          width: image.width ?? null,
          height: image.height ?? null,
          mimeType: image.mimeType ?? null,
          externalUrl: image.externalUrl ?? null,
          storageId: image.storageId ?? null,
        };
      }),
    );
  },
});

/** Open a run row (the audit trail) after enforcing the per-account rate limit. */
export const beginCodeRun = internalMutation({
  args: {
    accountId: v.id("accounts"),
    code: v.string(),
    description: v.string(),
    threadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"codeRuns">> => {
    if (!(await ctx.db.get(args.accountId))) throw new Error("account not found");
    const windowStart = Date.now() - CODE_RUN_RATE_WINDOW_MS;
    const recent = await ctx.db
      .query("codeRuns")
      .withIndex("by_account_created", (q) =>
        q.eq("accountId", args.accountId).gte("createdAt", windowStart),
      )
      .collect();
    if (recent.length >= CODE_RUN_RATE_LIMIT) {
      throw new Error("muitas execuções de código em sequência — aguarde alguns minutos");
    }
    return ctx.db.insert("codeRuns", {
      accountId: args.accountId,
      code: args.code,
      description: args.description,
      status: "running",
      ...(args.threadId ? { threadId: args.threadId } : {}),
      createdAt: Date.now(),
    });
  },
});

/** Close a run row with its outcome. Output text arrives pre-truncated. */
export const finishCodeRun = internalMutation({
  args: {
    codeRunId: v.id("codeRuns"),
    status: v.union(v.literal("ok"), v.literal("failed")),
    stdout: v.optional(v.string()),
    stderr: v.optional(v.string()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    imageIds: v.optional(v.array(v.id("images"))),
  },
  handler: async (ctx, { codeRunId, ...outcome }) => {
    const run = await ctx.db.get(codeRunId);
    if (!run || run.status !== "running") return;
    await ctx.db.patch(codeRunId, outcome);
  },
});
