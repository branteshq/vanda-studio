// Opt-in brand-memory benchmark on the owner's ChatGPT subscription. Normal runs skip it.
// Run: VANDA_LIVE_EVAL=1 VANDA_EVAL_MEMORY=1 VANDA_EVAL_AUTH_FILE=~/.codex/auth.json \
//      pnpm exec vitest run src/convex/brandMemory.live.test.ts
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createThread, saveMessage } from "@convex-dev/agent";
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { brandFileFor } from "../../evals/brandFile";
import { brands } from "../../evals/fixtures";
import { memorySteps, type MemoryAgent } from "../../evals/memoryBenchmark";
import { components, internal } from "./_generated/api";
import { requireTextModel } from "./agentModels";
import { caetano } from "./caetanoAgent";
import schema from "./schema";
import { vanda } from "./vanda";

const modules = import.meta.glob("./**/*.ts");

const enabled = process.env.VANDA_LIVE_EVAL === "1" && process.env.VANDA_EVAL_MEMORY === "1";

const model = process.env.VANDA_EVAL_MODEL ?? "openai/gpt-6-luna";

const repeats = Number(process.env.VANDA_EVAL_REPEATS ?? "2");

const outputRoot = resolve(
  process.env.VANDA_EVAL_OUTPUT ?? "../../.amp/in/artifacts/brand-memory",
  new Date().toISOString().replaceAll(":", "-"),
);

const authSchema = z.object({
  tokens: z.object({ access_token: z.string(), refresh_token: z.string(), account_id: z.string() }),
});

const toolCallSchema = z.object({ toolName: z.string(), input: z.unknown() });

const brand = brands.find((candidate) => candidate.id === "cafe-caju")!;

interface StepRecord {
  id: string;
  agent: MemoryAgent;
  session: string;
  prompt: string;
  probes: string;
  response: string;
  tools: { name: string; input: string }[];
  checks: { label: string; pass: boolean }[];
  before: string;
  after: string;
  elapsedMs: number;
  error?: string;
}

const lineDiff = (before: string, after: string): string => {
  const old = new Set(before.split("\n"));
  const next = new Set(after.split("\n"));
  const removed = before.split("\n").filter((line) => line.trim() && !next.has(line));
  const added = after.split("\n").filter((line) => line.trim() && !old.has(line));

  return [...removed.map((line) => `- ${line}`), ...added.map((line) => `+ ${line}`)].join("\n");
};

const report = (run: number, steps: StepRecord[], finalFile: string): string =>
  [
    `# Brand memory benchmark · run ${run}`,
    "",
    `Model: ${model} (ChatGPT subscription). Brand: ${brand.name}.`,
    "",
    ...steps.flatMap((step) => [
      `## ${step.id} · ${step.agent} · session ${step.session}`,
      "",
      `_${step.probes}_`,
      "",
      `**Owner:** ${step.prompt}`,
      "",
      `**${step.agent === "vanda" ? "Vanda" : "Caetano"}:** ${step.error ? `ERROR: ${step.error}` : step.response.trim()}`,
      "",
      `Tools: ${step.tools.map((tool) => tool.name).join(", ") || "none"} · ${Math.round(step.elapsedMs / 1000)}s`,
      "",
      ...step.checks.map((check) => `- [${check.pass ? "x" : " "}] ${check.label}`),
      "",
      ...(step.before === step.after
        ? []
        : ["Brand file change:", "", "```diff", lineDiff(step.before, step.after), "```", ""]),
    ]),
    "## Final brand file",
    "",
    "```md",
    finalFile,
    "```",
  ].join("\n");

// Each run wraps streamText and fetch afresh; unwrap so runs never stack wrappers.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.skipIf(!enabled).each(Array.from({ length: repeats }, (_, index) => index + 1))(
  "brand memory benchmark: run %i",
  async (run) => {
    requireTextModel(model, true);
    const authPath = process.env.VANDA_EVAL_AUTH_FILE;

    if (!authPath) throw new Error("Set VANDA_EVAL_AUTH_FILE to a ChatGPT auth JSON");
    const auth = authSchema.parse(JSON.parse(await readFile(authPath, "utf8"))).tokens;
    const directory = resolve(outputRoot, `run-${run}`);
    await mkdir(directory, { recursive: true });

    const t = convexTest(schema, modules);
    agentComponent.register(t);
    vi.stubEnv("OPENAI_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
    const realFetch = globalThis.fetch;

    // Only the subscription provider is reachable; nothing is published or messaged.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));

      if (url.hostname !== "chatgpt.com")
        throw new Error(`Benchmark blocked external request to ${url.hostname}`);

      return realFetch(input, init);
    });

    let calls: { name: string; input: string }[] = [];

    for (const agent of [vanda, caetano]) {
      const stream = agent.streamText.bind(agent);
      vi.spyOn(agent, "streamText").mockImplementation(async (ctx, thread, options, persistence) =>
        stream(
          ctx,
          thread,
          {
            ...options,
            onStepFinish: async (step) => {
              for (const call of step.toolCalls) {
                const parsed = toolCallSchema.parse(call);
                calls.push({
                  name: parsed.toolName,
                  input: JSON.stringify(parsed.input).slice(0, 300),
                });
              }
            },
          },
          persistence,
        ),
      );
    }

    const startedAt = Date.now();

    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Fictional owner",
        email: "fixture@example.invalid",
        clerkId: "eval",
        planId: "conectado",
        orchestratorModel: model,
        caetanoModel: model,
      });

      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        name: brand.name,
        handle: brand.handle.replace(/^@/, ""),
        onboardedAt: startedAt,
        createdAt: startedAt,
        updatedAt: startedAt,
      });

      await ctx.db.patch(userId, { activeAccountId: accountId });

      return { userId, accountId };
    });

    await t.action(internal.openaiSubNode.encryptAndStore, {
      clerkId: "eval",
      access: auth.access_token,
      refresh: auth.refresh_token,
      expiresAt: Date.now() + 3_600_000,
      accountId: auth.account_id,
    });

    for (const [path, content] of [
      ["/brand/marca.md", brandFileFor(brand)],
      ["/brand/kit.json", JSON.stringify(brand.kit)],
    ] as const) {
      const written = await t.mutation(internal.workspaceData.write, {
        accountId: ids.accountId,
        path,
        content,
      });

      expect(written.ok, path).toBe(true);
    }

    const brandFile = async () => {
      const read = await t.query(internal.workspaceData.read, {
        accountId: ids.accountId,
        path: "/brand/marca.md",
      });

      return read.ok && read.file.kind === "text" ? read.file.text : "";
    };

    const threads = new Map<string, string>();
    const records: StepRecord[] = [];

    for (const step of memorySteps) {
      const before = await brandFile();
      calls = [];
      const stepStarted = Date.now();
      let response = "";
      let error: string | undefined;

      try {
        const key = `${step.agent}:${step.session}`;

        const turn = await t.run(async (ctx) => {
          let threadId = threads.get(key);

          if (!threadId) {
            threadId = await createThread(ctx, components.agent, {
              userId: step.agent === "caetano" ? `caetano:${ids.userId}` : ids.accountId,
              title: step.session,
            });
            threads.set(key, threadId);
          }

          const saved = await saveMessage(ctx, components.agent, {
            threadId,
            message: { role: "user", content: step.prompt },
          });

          return { threadId, promptMessageId: saved.messageId };
        });

        if (step.agent === "caetano") {
          const activityId = await t.run(async (ctx) => {
            await ctx.db.patch(ids.userId, { caetanoThreadId: turn.threadId });

            const inboxId = await ctx.db.insert("caetanoInbox", {
              ...turn,
              userId: ids.userId,
              channel: "whatsapp",
              status: "running",
            });

            return ctx.db.insert("caetanoThreadActivity", {
              ...turn,
              userId: ids.userId,
              inboxId,
              startedAt: Date.now(),
            });
          });

          response = await t.action(internal.caetano.generateResponse, {
            ...turn,
            userId: ids.userId,
            activityId,
          });
        } else {
          const activityId = await t.run((ctx) =>
            ctx.db.insert("chatThreadActivity", {
              ...turn,
              accountId: ids.accountId,
              startedAt: Date.now(),
            }),
          );

          response = await t.action(internal.chat.generateResponse, {
            ...turn,
            accountId: ids.accountId,
            activityId,
          });
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }

      const after = await brandFile();
      const user = await t.run((ctx) => ctx.db.get(ids.userId));
      const tools = calls.map((call) => call.name);

      const context = {
        before,
        after,
        response,
        tools,
        theme: user?.theme,
        imageModel: user?.imageModel,
      };

      const record: StepRecord = {
        id: step.id,
        agent: step.agent,
        session: step.session,
        prompt: step.prompt,
        probes: step.probes,
        response,
        tools: calls,
        checks: step.checks.map((check) => ({
          label: check.label,
          pass: !error && check.pass(context),
        })),
        before,
        after,
        elapsedMs: Date.now() - stepStarted,
      };

      if (error) record.error = error;
      records.push(record);
      await writeFile(resolve(directory, "transcript.md"), report(run, records, after));
    }

    const finalFile = await brandFile();
    await writeFile(resolve(directory, "transcript.md"), report(run, records, finalFile));
    await writeFile(
      resolve(directory, "summary.json"),
      JSON.stringify(
        {
          model,
          run,
          steps: records.map(({ id, checks, tools, elapsedMs, error }) => ({
            id,
            passed: checks.filter((check) => check.pass).length,
            total: checks.length,
            failed: checks.filter((check) => !check.pass).map((check) => check.label),
            tools: tools.map((tool) => tool.name),
            elapsedMs,
            error,
          })),
        },
        null,
        2,
      ),
    );

    console.log(`brand memory run ${run}: ${directory}`);
  },
  45 * 60_000,
);
