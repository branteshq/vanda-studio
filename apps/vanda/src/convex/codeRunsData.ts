import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { chargeUsage } from "./usage";
import { readPath } from "./workspace";
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
 * Identity wall for run_code inputs. Account-owned images and any text file
 * visible through the account's workspace may be materialized; credentials and
 * provider internals never appear in the workspace, so they cannot cross into
 * Python. Bare ids remain image attachment ids for backwards compatibility.
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
        if (input.startsWith("/")) {
          const sandboxPath = `${SANDBOX_HOME}/${input.split("/").filter(Boolean).join("/")}`;
          const image = await resolveImagePath(ctx, accountId, input);
          if (image) {
            if (image.accountId !== accountId) throw new Error("image not found");
            return {
              kind: "image" as const,
              sandboxPath,
              imageId: image._id,
              name: image.name ?? null,
              width: image.width ?? null,
              height: image.height ?? null,
              mimeType: image.mimeType ?? null,
              externalUrl: image.externalUrl ?? null,
              storageId: image.storageId ?? null,
            };
          }
          const resolved = await readPath(ctx, accountId, input);
          if (!resolved.ok || resolved.file.kind !== "text") {
            throw new Error(`arquivo de entrada não encontrado no workspace: ${input}`);
          }
          if (resolved.file.text.length > 2 * 1024 * 1024) {
            throw new Error(`arquivo de entrada maior que 2MB: ${input}`);
          }
          return {
            kind: "text" as const,
            sandboxPath,
            content: resolved.file.text,
            mimeType: input.endsWith(".json")
              ? "application/json"
              : input.endsWith(".csv")
                ? "text/csv"
                : input.endsWith(".md")
                  ? "text/markdown"
                  : "text/plain",
          };
        }

        const imageId = ctx.db.normalizeId("images", input);
        const image: Doc<"images"> | null = imageId ? await ctx.db.get(imageId) : null;
        if (!image || image.accountId !== accountId)
          throw new Error(`imagem não encontrada: ${input}`);
        return {
          kind: "image" as const,
          sandboxPath: `${SANDBOX_HOME}${canonicalPath(image)}`,
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

export const saveCodeRunArtifact = internalMutation({
  args: {
    codeRunId: v.id("codeRuns"),
    filename: v.string(),
    mimeType: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.codeRunId);
    if (!run) throw new Error("code run not found");
    if (args.content.length > 1024 * 1024) throw new Error("artifact larger than 1MB");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(args.filename)) {
      throw new Error("invalid artifact filename");
    }
    return ctx.db.insert("codeRunArtifacts", {
      accountId: run.accountId,
      codeRunId: run._id,
      filename: args.filename,
      mimeType: args.mimeType,
      content: args.content,
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
