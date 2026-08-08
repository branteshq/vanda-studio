import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { chargeUsage } from "./usage";
import { resolveImagePath } from "./workspace/resolveImage";
import { entityName, imageFileParts } from "./workspace/types";

/** Max run_code executions per account inside the rate window. */
export const CODE_RUN_RATE_LIMIT = 20;
export const CODE_RUN_RATE_WINDOW_MS = 5 * 60_000;

/** Where the workspace mirrors into the sandbox: /images/x.jpg → /home/user/images/x.jpg. */
const SANDBOX_HOME = "/home/user";

/** The canonical workspace path for an image row (used when input was a bare id). */
const canonicalPath = (image: Doc<"images">): string => {
  const extension = imageFileParts(image.mimeType).extension;
  const name = `${entityName(image.name ?? image.prompt?.split(/\s+/).slice(0, 4).join(" ") ?? "imagem", image._id)}.${extension}`;
  return image.purpose === "reference" ? `/brand/references/${name}` : `/images/${name}`;
};

/**
 * Identity wall for run_code inputs, sibling of resolvePaintInput: only images
 * the account owns may be materialized into the sandbox. Each input is a
 * workspace path (/images/…, /brand/references/…, /projects/…/renders/NN) or a
 * bare imageId (attachments). Returns the sandbox mirror path plus the
 * metadata meta.json is built from.
 */
export const resolveCodeRunInput = internalQuery({
  args: {
    accountId: v.id("accounts"),
    inputs: v.array(v.string()),
  },
  handler: async (ctx, { accountId, inputs }) => {
    if (!(await ctx.db.get(accountId))) throw new Error("account not found");
    return Promise.all(
      inputs.map(async (input) => {
        let image: Doc<"images"> | null = null;
        let sandboxPath: string;
        if (input.startsWith("/")) {
          image = await resolveImagePath(ctx, accountId, input);
          if (!image) throw new Error(`imagem não encontrada no workspace: ${input}`);
          sandboxPath = `${SANDBOX_HOME}/${input.split("/").filter(Boolean).join("/")}`;
        } else {
          const imageId = ctx.db.normalizeId("images", input);
          image = imageId ? await ctx.db.get(imageId) : null;
          if (!image) throw new Error(`imagem não encontrada: ${input}`);
          sandboxPath = `${SANDBOX_HOME}${canonicalPath(image)}`;
        }
        if (image.accountId !== accountId) throw new Error("image not found");
        return {
          sandboxPath,
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
    if (outcome.costUsd) {
      await chargeUsage(ctx, {
        accountId: run.accountId,
        kind: "run_code",
        usd: outcome.costUsd,
        ref: String(codeRunId),
      });
    }
  },
});
