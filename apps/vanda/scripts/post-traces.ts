/**
 * Post traces: one block per agent turn that made (or tried to make) a post.
 *
 * For each turn it lists the skills read, the tool_search queries and the skills
 * they surfaced, what /images held, every paint call with its reference count and
 * whether it edited an earlier image, the review passes over painted images, and
 * whether create_post ran.
 *
 * Read-only: it only runs `convex data` on the agent component's messages table,
 * or reads a JSONL dump of that table.
 *
 *   node scripts/post-traces.ts                       # your dev deployment
 *   CONVEX_DEPLOY_KEY="$CONVEX_PROD_DEPLOY_KEY" node scripts/post-traces.ts --prod
 *   node scripts/post-traces.ts --file /tmp/agentall.jsonl --thread m57…
 *   node scripts/post-traces.ts --prod --limit 8000 --json
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const TextPart = z.object({ type: z.literal("text"), text: z.string() });

const ToolCall = z.object({
  type: z.literal("tool-call"),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown().optional(),
  args: z.unknown().optional(),
});

const ToolResult = z.object({
  type: z.literal("tool-result"),
  toolCallId: z.string(),
  toolName: z.string(),
  output: z.unknown().optional(),
  result: z.unknown().optional(),
});

/** Parts this script reads; reasoning, images and the rest are dropped at parse time. */
const Part = z.union([TextPart, ToolCall, ToolResult]);

type Part = z.infer<typeof Part>;

/** One row of the agent component's messages table, as `convex data` prints it. */
const AgentMessage = z.object({
  _creationTime: z.number(),
  threadId: z.string(),
  userId: z.string().optional(),
  order: z.number().default(0),
  stepOrder: z.number().default(0),
  message: z
    .object({
      role: z.string().optional(),
      content: z
        .union([
          z.string().transform((text): Part[] => [{ type: "text", text }]),
          z.array(z.unknown()).transform((parts) =>
            parts.flatMap((part) => {
              const parsed = Part.safeParse(part);

              return parsed.success ? [parsed.data] : [];
            }),
          ),
        ])
        .default([]),
    })
    .default({ content: [] }),
});

export type AgentMessage = z.input<typeof AgentMessage>;

type Message = z.infer<typeof AgentMessage>;

const PathArgs = z.object({ path: z.string().default("") });

const SearchArgs = z.object({ query: z.string().default("") });

const PaintArgs = z.object({
  name: z.string().default(""),
  aspectRatio: z.string().default(""),
  referenceImageIds: z.array(z.string()).default([]),
  editOfImageId: z.string().default(""),
});

/** The AI SDK's tool output envelope: `{ type: "json" | "text" | "error-text" | …, value }`. */
const Output = z.object({ type: z.string(), value: z.unknown().optional() });

const Named = z.array(z.object({ name: z.string() })).default([]);

const SearchHits = z.object({ skills: Named, tools: Named });

export type PaintCall = {
  name: string;
  aspectRatio: string;
  references: number;
  edit: boolean;
  outcome: "ok" | "error" | "pending";
};

export type PostTurn = {
  threadId: string;
  account: string;
  order: number;
  startedAt: number;
  prompt: string;
  skillsRead: string[];
  searches: { query: string; skills: string[]; tools: string[] }[];
  imagesListed: number | null;
  paints: PaintCall[];
  reviews: string[];
  createPost: "ok" | "error" | "not run";
  reply: string;
};

type ToolResultPart = z.infer<typeof ToolResult>;

const outputOf = (part: ToolResultPart) => {
  const parsed = Output.safeParse(part.output ?? part.result);

  return parsed.success
    ? { failed: parsed.data.type.startsWith("error"), value: parsed.data.value }
    : { failed: false, value: undefined };
};

// "/skills/post/SKILL.md" is "post"; a resource keeps its path ("post/formats/meme.md").
const skillName = (path: string): string | null =>
  /^\/skills\/(.+)\/SKILL\.md$/.exec(path)?.[1] ?? /^\/skills\/(.+\.md)$/.exec(path)?.[1] ?? null;

/** "/images\n(vazio)" is 0; otherwise one entry per listed line. */
const listedCount = (listing: string): number => {
  const lines = listing.split("\n").slice(1).filter(Boolean);

  return lines.length === 1 && lines[0] === "(vazio)" ? 0 : lines.length;
};

const IMAGE_READ = /^\/(images|posts)\//;

/** A turn's trace plus every tool name it called, in order. */
type TracedTurn = { turn: PostTurn; calls: string[] };

/** Folds one turn's steps into its trace. */
function traceTurn(steps: readonly Message[]): TracedTurn {
  const first = steps[0]!;

  const turn: PostTurn = {
    threadId: first.threadId,
    account: first.userId ?? "",
    order: first.order,
    startedAt: first._creationTime,
    prompt: "",
    skillsRead: [],
    searches: [],
    imagesListed: null,
    paints: [],
    reviews: [],
    createPost: "not run",
    reply: "",
  };

  const calls: string[] = [];
  const pending = new Map<string, (result: ToolResultPart) => void>();

  for (const step of steps) {
    const role = step.message.role;

    for (const part of step.message.content) {
      if (part.type === "text") {
        if (role === "user" && !turn.prompt) turn.prompt = part.text;

        if (role === "assistant") turn.reply = part.text;

        continue;
      }

      if (part.type === "tool-result") {
        pending.get(part.toolCallId)?.(part);

        continue;
      }

      const input = part.input ?? part.args;

      calls.push(part.toolName);

      if (part.toolName === "read") {
        const { path } = PathArgs.parse(input ?? {});
        const skill = skillName(path);

        if (skill && !turn.skillsRead.includes(skill)) turn.skillsRead.push(skill);

        if (IMAGE_READ.test(path) && turn.paints.length > 0) turn.reviews.push(`read ${path}`);
      }

      if (part.toolName === "inspect_image" && turn.paints.length > 0)
        turn.reviews.push("inspect_image");

      if (part.toolName === "tool_search") {
        const search: PostTurn["searches"][number] = {
          query: SearchArgs.parse(input ?? {}).query,
          skills: [],
          tools: [],
        };

        turn.searches.push(search);
        pending.set(part.toolCallId, (result) => {
          const hits = SearchHits.safeParse(outputOf(result).value);

          if (!hits.success) return;

          search.skills = hits.data.skills.map((skill) => skill.name);
          search.tools = hits.data.tools.map((tool) => tool.name);
        });
      }

      if (
        part.toolName === "list" &&
        PathArgs.parse(input ?? {}).path.replace(/\/$/, "") === "/images"
      )
        pending.set(part.toolCallId, (result) => {
          const listing = z.string().safeParse(outputOf(result).value);

          turn.imagesListed = listing.success ? listedCount(listing.data) : null;
        });

      if (part.toolName === "paint") {
        const args = PaintArgs.parse(input ?? {});

        const paint: PaintCall = {
          name: args.name,
          aspectRatio: args.aspectRatio,
          references: args.referenceImageIds.length,
          edit: args.editOfImageId.length > 0,
          outcome: "pending",
        };

        if (paint.edit) turn.reviews.push(`edit ${paint.name}`);

        turn.paints.push(paint);
        pending.set(part.toolCallId, (result) => {
          paint.outcome = outputOf(result).failed ? "error" : "ok";
        });
      }

      if (part.toolName === "create_post") {
        // Until its result lands, a create_post call counts as failed, never as not run.
        turn.createPost = "error";
        pending.set(part.toolCallId, (result) => {
          turn.createPost = outputOf(result).failed ? "error" : "ok";
        });
      }
    }
  }

  return { turn, calls };
}

/** Groups messages into turns (thread + order) and keeps the turns that worked on a post. */
export function postTurns(messages: readonly AgentMessage[]): PostTurn[] {
  const turns = new Map<string, Message[]>();

  for (const raw of messages) {
    const message = AgentMessage.parse(raw);
    const key = `${message.threadId} ${message.order}`;

    turns.set(key, [...(turns.get(key) ?? []), message]);
  }

  return [...turns.values()]
    .flatMap((steps) => {
      const { turn, calls } = traceTurn(
        steps.toSorted((a, b) => a.stepOrder - b.stepOrder || a._creationTime - b._creationTime),
      );

      const worked =
        calls.includes("paint") ||
        calls.includes("create_post") ||
        // "post-production" is the skill older turns read before "post" replaced it.
        turn.skillsRead.includes("post") ||
        turn.skillsRead.includes("post-production");

      return worked ? [turn] : [];
    })
    .toSorted((a, b) => a.startedAt - b.startedAt);
}

const clip = (value: string, length: number): string => {
  const flat = value.replace(/\s+/g, " ").trim();

  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
};

export function formatTurn(turn: PostTurn): string {
  const when = `${new Date(turn.startedAt).toISOString().replace("T", " ").slice(0, 16)} UTC`;

  const lines = [
    `## ${when} · thread ${turn.threadId} · turn ${turn.order} · account ${turn.account}`,
    `prompt: ${clip(turn.prompt, 100) || "(none)"}`,
    `skills read: ${turn.skillsRead.join(", ") || "none"}`,
  ];

  for (const search of turn.searches) {
    const tools = search.tools.length ? ` · tools: ${search.tools.join(", ")}` : "";

    lines.push(
      `tool_search "${clip(search.query, 90)}" → ${search.skills.join(", ") || "no skills"}${tools}`,
    );
  }

  lines.push(
    `/images listed: ${turn.imagesListed === null ? "not listed" : `${turn.imagesListed} item(s)`}`,
  );

  for (const paint of turn.paints)
    lines.push(
      `paint "${paint.name}" ${paint.aspectRatio} refs=${paint.references}${paint.edit ? " edit" : ""} ${paint.outcome}`,
    );

  if (turn.paints.length === 0) lines.push("paint: none");

  lines.push(`review passes: ${turn.reviews.length ? turn.reviews.join("; ") : "none"}`);
  lines.push(`create_post: ${turn.createPost}`);

  return lines.join("\n");
}

export function summarize(turns: readonly PostTurn[]): string {
  const paints = turns.flatMap((turn) => turn.paints);
  const fresh = paints.filter((paint) => !paint.edit);
  const listed = turns.filter((turn) => turn.imagesListed !== null);

  return [
    `post turns: ${turns.length}`,
    `paint calls: ${paints.length} (${paints.length - fresh.length} edits)`,
    `new paints with references: ${fresh.filter((paint) => paint.references > 0).length} of ${fresh.length}`,
    `turns with a review pass: ${turns.filter((turn) => turn.reviews.length > 0).length} of ${turns.length}`,
    `turns that listed /images: ${listed.length}, of which empty: ${listed.filter((turn) => turn.imagesListed === 0).length}`,
    `create_post ran: ${turns.filter((turn) => turn.createPost !== "not run").length} of ${turns.length}`,
  ].join("\n");
}

type Options = {
  file: string | null;
  thread: string | null;
  json: boolean;
  limit: number;
  convexArgs: string[];
};

/** Only read-only `convex data` deployment flags pass through; anything else is refused. */
export function parseOptions(argv: readonly string[]): Options {
  const options: Options = { file: null, thread: null, json: false, limit: 5000, convexArgs: [] };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const next = () => argv[++index] ?? "";

    if (arg === "--file") options.file = next();
    else if (arg === "--thread") options.thread = next();
    else if (arg === "--json") options.json = true;
    else if (arg === "--limit") options.limit = Number(next());
    else if (arg === "--prod") options.convexArgs.push("--prod");
    else if (arg === "--deployment-name" || arg === "--url") options.convexArgs.push(arg, next());
    else throw new Error(`unknown option ${arg}`);
  }

  return options;
}

const JsonLine = z.string().transform((line, context) => {
  try {
    return AgentMessage.parse(JSON.parse(line));
  } catch {
    context.addIssue({ code: "custom", message: "not an agent message" });

    return z.NEVER;
  }
});

const parseLines = (raw: string): Message[] =>
  raw.split("\n").flatMap((line) => {
    const parsed = JsonLine.safeParse(line);

    return parsed.success ? [parsed.data] : [];
  });

/** Reads the agent component's messages: the newest `limit`, via `convex data` (read-only). */
function loadMessages(options: Options): Message[] {
  if (options.file) return parseLines(readFileSync(options.file, "utf8"));

  const raw = execFileSync(
    "pnpm",
    [
      "exec",
      "convex",
      "data",
      "messages",
      "--component",
      "agent",
      "--format",
      "jsonLines",
      "--limit",
      String(options.limit),
      ...options.convexArgs,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
  );

  return parseLines(raw);
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));

  const messages = loadMessages(options).filter(
    (message) => !options.thread || message.threadId === options.thread,
  );

  const turns = postTurns(messages);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(turns, null, 2)}\n`);

    return;
  }

  const blocks = turns.map(formatTurn).join("\n\n");

  process.stdout.write(
    `${blocks}\n\n# Summary (${messages.length} messages read)\n${summarize(turns)}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
