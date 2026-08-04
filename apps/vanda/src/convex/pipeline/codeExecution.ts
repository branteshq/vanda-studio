"use node";

import { Sandbox } from "@e2b/code-interpreter";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Filesystem contract inside the sandbox — mirrored in the tool description. */
export const SANDBOX_IN_DIR = "/home/user/in";
export const SANDBOX_OUT_DIR = "/home/user/out";

/** Wall-clock budget for the agent's Python; any legit Pillow job is single-digit seconds. */
export const EXECUTION_TIMEOUT_MS = 30_000;
/** Sandbox TTL — the backstop reaper if the orchestrating action dies mid-run. */
const SANDBOX_TTL_MS = 60_000;
/** Ingestion caps: sandbox output is untrusted until validated. */
export const MAX_OUTPUT_FILES = 10;
export const MAX_OUTPUT_FILE_BYTES = 25 * 1024 * 1024;

const OUTPUT_EXTENSIONS = [".png", ".jpg", ".jpeg"];

export interface SandboxInputFile {
  /** Absolute path inside the sandbox. */
  readonly path: string;
  readonly data: Uint8Array | string;
}

export interface SandboxOutputFile {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export interface SandboxRunResult {
  /** False when the Python raised or timed out — an agent-visible outcome, not an infra error. */
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly outputs: ReadonlyArray<SandboxOutputFile>;
  /** Files in out/ that were not ingested, with the reason (relayed via stderr). */
  readonly skipped: ReadonlyArray<string>;
}

export class CodeExecutionFailed extends Data.TaggedError("CodeExecutionFailed")<{
  readonly operation: string;
  readonly message: string;
}> {}

export interface CodeSandboxShape {
  readonly execute: (input: {
    readonly code: string;
    readonly files: ReadonlyArray<SandboxInputFile>;
    /**
     * Hands the caller a kill switch as soon as the sandbox exists, so a
     * cooperative stop can tear the run down mid-flight.
     */
    readonly onSandbox?: ((kill: () => Promise<void>) => void) | undefined;
  }) => Effect.Effect<SandboxRunResult, CodeExecutionFailed>;
}

export class CodeSandbox extends Context.Service<CodeSandbox, CodeSandboxShape>()(
  "@vanda/studio/CodeSandbox",
) {}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

/**
 * E2B-backed sandbox: Firecracker microVM, internet disabled, no credentials
 * inside — the code only ever sees the files we explicitly write.
 */
export const e2bCodeSandboxLayer = (input: {
  readonly apiKey: string;
  /** Custom template (vanda-imaging). Omit for E2B's default code-interpreter image. */
  readonly template?: string | undefined;
}): Layer.Layer<CodeSandbox> =>
  Layer.succeed(CodeSandbox, {
    execute: ({ code, files, onSandbox }) =>
      Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => {
            const opts = {
              apiKey: input.apiKey,
              timeoutMs: SANDBOX_TTL_MS,
              allowInternetAccess: false,
            };
            return input.template ? Sandbox.create(input.template, opts) : Sandbox.create(opts);
          },
          catch: (error) =>
            new CodeExecutionFailed({
              operation: "create",
              message: error instanceof Error ? error.message : String(error),
            }),
        }),
        (sandbox) =>
          Effect.tryPromise({
            try: async () => {
              onSandbox?.(() => sandbox.kill().then(() => {}));
              await sandbox.files.makeDir(SANDBOX_OUT_DIR);
              if (files.length > 0) {
                await sandbox.files.write(
                  files.map((file) => ({
                    path: file.path,
                    data: typeof file.data === "string" ? file.data : toArrayBuffer(file.data),
                  })),
                );
              }

              let execution;
              try {
                execution = await sandbox.runCode(code, { timeoutMs: EXECUTION_TIMEOUT_MS });
              } catch (error) {
                // Execution timeout is an agent-visible outcome (fix the code,
                // retry), not an infra failure.
                if (error instanceof Error && error.name === "TimeoutError") {
                  return {
                    ok: false,
                    stdout: "",
                    stderr: `tempo de execução excedido (${EXECUTION_TIMEOUT_MS / 1000}s)`,
                    outputs: [],
                    skipped: [],
                  };
                }
                throw error;
              }

              const stdout = execution.logs.stdout.join("");
              const stderr = [execution.logs.stderr.join(""), execution.error?.traceback ?? ""]
                .filter(Boolean)
                .join("\n");

              const outputs: SandboxOutputFile[] = [];
              const skipped: string[] = [];
              const entries = await sandbox.files.list(SANDBOX_OUT_DIR).catch(() => []);
              // Deterministic ingestion order regardless of listing order.
              // (lib target predates Array#toSorted, hence copy-then-sort.)
              const candidates = entries.filter(
                (entry) =>
                  entry.type === "file" &&
                  OUTPUT_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext)),
              );
              candidates.sort((a, b) => a.name.localeCompare(b.name));
              for (const entry of candidates) {
                if (outputs.length >= MAX_OUTPUT_FILES) {
                  skipped.push(`${entry.name}: limite de ${MAX_OUTPUT_FILES} arquivos`);
                  continue;
                }
                const bytes = await sandbox.files.read(`${SANDBOX_OUT_DIR}/${entry.name}`, {
                  format: "bytes",
                });
                if (bytes.byteLength > MAX_OUTPUT_FILE_BYTES) {
                  skipped.push(`${entry.name}: maior que 25MB`);
                  continue;
                }
                outputs.push({ filename: entry.name, bytes });
              }

              return { ok: !execution.error, stdout, stderr, outputs, skipped };
            },
            catch: (error) =>
              new CodeExecutionFailed({
                operation: "execute",
                message: error instanceof Error ? error.message : String(error),
              }),
          }),
        (sandbox) => Effect.promise(() => sandbox.kill().then(() => {}, () => {})),
      ),
  });
