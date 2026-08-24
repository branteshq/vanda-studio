"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import {
  CodeSandbox,
  e2bCodeSandboxLayer,
  type SandboxInputFile,
  type SandboxRunResult,
} from "./pipeline/codeExecution";
import { CODE_IMAGE_MODEL } from "./imageModels";
import { USAGE_LIMIT_MESSAGE } from "./usage";
import { sniffImage } from "./pipeline/imageBytes";
import { entityName } from "./workspace/types";

/** Sandbox output above this is rejected: nothing legitimate composes >32MP. */
const MAX_OUTPUT_PIXELS = 32_000_000;
const MAX_TEXT_ARTIFACT_BYTES = 1024 * 1024;
/** Agent-visible text budget for stdout/stderr; the tail carries the traceback. */
const MAX_LOG_CHARS = 8 * 1024;
/** 2 vCPU + 2 GiB at E2B per-second rates — recorded, not billed to the user. */
const SANDBOX_USD_PER_MS = 3.7e-8;

const truncateKeepTail = (text: string, max = MAX_LOG_CHARS): string =>
  text.length <= max ? text : `…${text.slice(text.length - max)}`;

/** `promo-agosto.png` → "promo agosto" — the filename is the gallery name. */
const filenameToName = (filename: string): string =>
  filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim() || "imagem";

type ResolvedSource = {
  readonly externalUrl: string | null;
  readonly storageId: Id<"_storage"> | null;
};

const resolveSourceUrl = async (ctx: ActionCtx, source: ResolvedSource): Promise<string> => {
  if (source.externalUrl) return source.externalUrl;
  if (source.storageId) {
    const url = await ctx.storage.getUrl(source.storageId);
    if (url) return url;
  }
  throw new Error("image has no resolvable URL");
};

const bytesBlob = (bytes: Uint8Array, mimeType: string): Blob => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mimeType });
};

const artifactMimeType = (filename: string): string | null => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  return null;
};

/**
 * Execute agent-authored Python against account-owned images in an isolated
 * sandbox. Python failures are results (ok: false + traceback), not errors —
 * the agent reads the traceback, fixes the code, and retries within the turn.
 * Only infra failures (sandbox provisioning, rate limit, cancellation) throw.
 */
export const run = internalAction({
  args: {
    accountId: v.id("accounts"),
    code: v.string(),
    description: v.string(),
    // Workspace paths (/images/…, /brand/references/…, /projects/…/renders/NN)
    // or bare imageIds (attachments). Each mirrors into the sandbox at the
    // same path under /home/user.
    inputPaths: v.optional(v.array(v.string())),
    // Chat runs carry their thread so the owner's stop cancels them mid-flight.
    threadId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { accountId, code, description, inputPaths, threadId },
  ): Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
    images: Array<{ imageId: Id<"images">; name: string; width: number; height: number }>;
    artifacts: Array<{
      artifactId: Id<"codeRunArtifacts">;
      filename: string;
      mimeType: string;
      path: string;
    }>;
  }> => {
    const budget = await ctx.runQuery(internal.usage.budget, { accountId });
    if (!budget.ok) throw new Error(USAGE_LIMIT_MESSAGE);
    const trimmedCode = code.trim();
    if (!trimmedCode) throw new Error("código vazio");
    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) throw new Error("E2B_API_KEY is not set on the Convex deployment");

    // Identity wall + rate limit before any bytes move.
    const inputs = await ctx.runQuery(internal.codeRunsData.resolveCodeRunInput, {
      accountId,
      inputs: inputPaths ?? [],
    });
    const codeRunId = await ctx.runMutation(internal.codeRunsData.beginCodeRun, {
      accountId,
      code: trimmedCode,
      description,
      ...(threadId ? { threadId } : {}),
    });

    const fail = async (error: string): Promise<never> => {
      await ctx.runMutation(internal.codeRunsData.finishCodeRun, {
        codeRunId,
        status: "failed",
        error: error.slice(0, 300),
      });
      throw new Error(error);
    };

    // Materialize inputs at their workspace mirror path — the path the agent
    // read in conversation is the path its Python opens. meta.json lists them.
    const files: SandboxInputFile[] = [];
    const meta: Array<Record<string, unknown>> = [];
    for (const input of inputs) {
      if (input.kind === "text") {
        files.push({ path: input.sandboxPath, data: input.content });
        meta.push({ path: input.sandboxPath, kind: "text", mimeType: input.mimeType });
        continue;
      }
      const url = await resolveSourceUrl(ctx, input);
      const response = await fetch(url);
      if (!response.ok) return fail(`falha ao carregar imagem de entrada (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const sniffed = sniffImage(bytes);
      files.push({ path: input.sandboxPath, data: bytes });
      meta.push({
        path: input.sandboxPath,
        kind: "image",
        imageId: input.imageId,
        name: input.name,
        width: sniffed?.width ?? input.width,
        height: sniffed?.height ?? input.height,
        mimeType: sniffed?.mimeType ?? input.mimeType ?? "image/jpeg",
      });
    }
    files.push({ path: "/home/user/meta.json", data: JSON.stringify(meta, null, 2) });

    // Cooperative stop, same shape as paint: the owner's stop button deletes
    // the thread's activity row; a watcher polls it and kills the sandbox.
    let cancelled = false;
    let killSandbox: (() => Promise<void>) | null = null;
    const watcher = threadId
      ? setInterval(() => {
          ctx
            .runQuery(internal.chat.threadHasActivity, { accountId, threadId })
            .then((active) => {
              if (!active) {
                cancelled = true;
                killSandbox?.().catch(() => {});
              }
            })
            .catch(() => {});
        }, 2500)
      : undefined;

    const startedAt = Date.now();
    let result: SandboxRunResult;
    try {
      result = await Effect.runPromise(
        Effect.flatMap(CodeSandbox, (sandbox) =>
          sandbox.execute({
            code: trimmedCode,
            files,
            onSandbox: (kill) => {
              killSandbox = kill;
            },
          }),
        ).pipe(
          Effect.provide(
            e2bCodeSandboxLayer({ apiKey, template: process.env.E2B_TEMPLATE || undefined }),
          ),
        ),
      );
    } catch (error) {
      if (cancelled) return fail("execução interrompida pelo dono");
      return fail(
        `falha na execução do sandbox: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (watcher) clearInterval(watcher);
    }
    // The run may have finished in the polling gap — never save results the
    // owner already walked away from.
    if (
      cancelled ||
      (threadId && !(await ctx.runQuery(internal.chat.threadHasActivity, { accountId, threadId })))
    ) {
      return fail("execução interrompida pelo dono");
    }
    const durationMs = Date.now() - startedAt;
    const costUsd = durationMs * SANDBOX_USD_PER_MS;

    // Sandbox output is untrusted: images are sniffed; structured text is
    // UTF-8 decoded and capped before it enters the workspace.
    const skipped = [...result.skipped];
    const images: Array<{ imageId: Id<"images">; name: string; width: number; height: number }> =
      [];
    const artifacts: Array<{
      artifactId: Id<"codeRunArtifacts">;
      filename: string;
      mimeType: string;
      path: string;
    }> = [];
    const runName = entityName(description, codeRunId);
    for (const output of result.outputs) {
      const sniffed = sniffImage(output.bytes);
      if (sniffed) {
        if (sniffed.width * sniffed.height > MAX_OUTPUT_PIXELS) {
          skipped.push(`${output.filename}: maior que ${MAX_OUTPUT_PIXELS / 1_000_000}MP`);
          continue;
        }
        const storageId = await ctx.storage.store(bytesBlob(output.bytes, sniffed.mimeType));
        const imageId = await ctx.runMutation(internal.imagesData.savePaintedImage, {
          accountId,
          storageId,
          prompt: description,
          mimeType: sniffed.mimeType,
          width: sniffed.width,
          height: sniffed.height,
          model: CODE_IMAGE_MODEL,
          generationMs: durationMs,
          costUsd: costUsd / result.outputs.length,
          name: filenameToName(output.filename),
          promptAuthor: "vanda",
          codeRunId,
        });
        images.push({
          imageId,
          name: filenameToName(output.filename),
          width: sniffed.width,
          height: sniffed.height,
        });
        continue;
      }

      const mimeType = artifactMimeType(output.filename);
      if (!mimeType) {
        skipped.push(`${output.filename}: extensão de saída não permitida`);
        continue;
      }
      if (output.bytes.byteLength > MAX_TEXT_ARTIFACT_BYTES) {
        skipped.push(`${output.filename}: maior que 1MB`);
        continue;
      }
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(output.bytes);
      } catch {
        skipped.push(`${output.filename}: texto não é UTF-8 válido`);
        continue;
      }
      if (mimeType === "application/json") {
        try {
          JSON.parse(content);
        } catch {
          skipped.push(`${output.filename}: JSON inválido`);
          continue;
        }
      }
      const artifactId = await ctx.runMutation(internal.codeRunsData.saveCodeRunArtifact, {
        codeRunId,
        filename: output.filename,
        mimeType,
        content,
      });
      artifacts.push({
        artifactId,
        filename: output.filename,
        mimeType,
        path: `/runs/${runName}/outputs/${output.filename}`,
      });
    }

    const stdout = truncateKeepTail(result.stdout);
    const stderr = truncateKeepTail(
      [result.stderr, ...skipped.map((note) => `arquivo ignorado — ${note}`)]
        .filter(Boolean)
        .join("\n"),
    );
    await ctx.runMutation(internal.codeRunsData.finishCodeRun, {
      codeRunId,
      status: result.ok ? "ok" : "failed",
      stdout,
      stderr,
      durationMs,
      costUsd,
      imageIds: images.map((image) => image.imageId),
    });
    return { ok: result.ok, stdout, stderr, images, artifacts };
  },
});
