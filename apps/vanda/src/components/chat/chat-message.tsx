import { useState } from "react";
import { useSmoothText, type UIMessage } from "@convex-dev/agent/react";
import { Check, ChevronDown, Pin, X } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { z } from "zod";
import { Bubble, BubbleContent } from "@vanda-studio/ui/components/bubble";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import { Marker, MarkerContent, MarkerIcon } from "@vanda-studio/ui/components/marker";
import { Message, MessageContent } from "@vanda-studio/ui/components/message";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { Id } from "../../convex/_generated/dataModel";
import type { ThreadResource } from "../../convex/resourceRefs";
import { MessageImageAttachments } from "../image-message-composer";
import { useEntranceOnMount } from "../thread-entrance";
import { ThreadImage, ThreadImageLightbox } from "../thread-images";
import { ThreadResourceList } from "../thread-resources";

/**
 * One chat turn as Vanda and Caetano render it: the user's bubble, or the
 * agent's tool trace, answer text, generated images and presented resources.
 * Shared by the Conversa page and Caetano's chat in Posts automáticos.
 */

const TOOL_LABEL = {
  get_brand_memory: "Consultando a memória da marca",
  list_opportunities: "Listando oportunidades",
  get_market_status: "Verificando a varredura de mercado",
  start_market_scan: "Iniciando varredura de mercado",
  create_post: "Montando post",
  schedule_post: "Agendando publicação",
  cancel_schedule: "Cancelando agendamento",
  delete_post: "Apagando post",
  paint: "Criando imagem",
  weave_infinite_carousel: "Costurando carrossel infinito",
  extend_infinite_carousel: "Continuando carrossel infinito",
  run_code: "Editando imagem com código",
  list: "Explorando",
  read: "Lendo",
  write: "Gravando",
  present: "Mostrando resultado",
  settings_get: "Lendo as configurações",
  settings_set: "Mudando uma configuração",
  autopilot_read: "Lendo a programação",
  autopilot_update_slot: "Mudando um post",
  autopilot_skip_slot: "Pulando um post",
  autopilot_approve_slot: "Aprovando um post",
  autopilot_reject_slot: "Registrando a recusa",
  autopilot_regenerate_slot: "Refazendo um post",
  autopilot_reanalyze: "Reanalisando a conta",
  autopilot_measure_account: "Medindo a conta",
  autopilot_save_audit: "Gravando o diagnóstico",
  autopilot_save_plan: "Gravando o plano da semana",
};

/**
 * Which orb animates while a tool runs — the motion mirrors the verb:
 * reading scans, writing composes, code solves, images take shape,
 * publishing connects.
 */
const TOOL_ORB_STATE = {
  list: "searching",
  read: "searching",
  write: "composing",
  start_market_scan: "searching",
  paint: "shaping",
  weave_infinite_carousel: "shaping",
  extend_infinite_carousel: "shaping",
  run_code: "solving",
  create_post: "composing",
  schedule_post: "connecting",
} satisfies Record<string, OrbState>;

const orbStateOf = (name: string): OrbState =>
  Object.entries(TOOL_ORB_STATE).find(([toolName]) => toolName === name)?.[1] ?? "working";

const toolLabelOf = (name: string): string =>
  Object.entries(TOOL_LABEL).find(([toolName]) => toolName === name)?.[1] ?? name;

/** A 20px-preset orb scaled into the 16px marker-icon slot. */
function MarkerOrb({ state }: { state: OrbState }) {
  return <ThinkingOrb state={state} size={20} className="!size-4" />;
}

/** The shared thinking state: a breathing orb where the answer will appear. */
export function ThinkingMarker() {
  return (
    <Marker role="status">
      <MarkerIcon>
        <MarkerOrb state="breathing" />
      </MarkerIcon>
      <MarkerContent loading>Pensando…</MarkerContent>
    </Marker>
  );
}

/** Workspace tools carry the touched path — surface it in the trace row. */
const toolPathOf = (part: ToolPartView): string | null => {
  const name = toolNameOf(part);

  if (name !== "read" && name !== "list" && name !== "write") return null;
  const parsed = z.object({ path: z.string() }).safeParse(part.input);

  return parsed.success ? parsed.data.path : null;
};

/** The loose view of a tool part — covers `tool-*` and `dynamic-tool` shapes. */
interface ToolPartView {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean };
}

const toolNameOf = (part: ToolPartView): string =>
  part.type === "dynamic-tool" ? (part.toolName ?? "tool") : part.type.slice("tool-".length);

const toolDataSchema = z.union([
  z.object({ data: z.json() }).transform(({ data }) => data),
  z.json(),
]);

const toolDataOf = (part: ToolPartView) => toolDataSchema.safeParse(part.output);

interface PaintedImageView {
  imageId: string;
  /** Frozen at generation time by paint; run_code images resolve live from the gallery. */
  url?: string | undefined;
  width: number;
  height: number;
}

const paintedImageOf = (part: ToolPartView): PaintedImageView | null => {
  if (toolNameOf(part) !== "paint" || part.state !== "output-available") return null;
  const output = toolDataOf(part);

  if (!output.success) return null;

  const image = z
    .object({ imageId: z.string(), url: z.string(), width: z.number(), height: z.number() })
    .safeParse(output.data);

  return image.success ? image.data : null;
};

/** Images produced by a completed run_code call (no frozen URL — gallery is live source). */
const codeImagesOf = (part: ToolPartView): PaintedImageView[] => {
  if (toolNameOf(part) !== "run_code" || part.state !== "output-available") return [];
  const output = toolDataOf(part);

  if (!output.success) return [];

  const parsed = z
    .object({
      images: z.array(z.object({ imageId: z.string(), width: z.number(), height: z.number() })),
    })
    .safeParse(output.data);

  return parsed.success ? parsed.data.images : [];
};

/** The agent-facing fields of a run_code part, for the expandable code trace. */
const codeRunViewOf = (part: ToolPartView) => {
  const input = z
    .object({ code: z.string().optional(), description: z.string().optional() })
    .catch({})
    .parse(part.input);

  const data = toolDataOf(part);

  const output = z
    .object({
      ok: z.boolean().optional(),
      stdout: z.string().optional(),
      stderr: z.string().optional(),
    })
    .catch({})
    .parse(data.success ? data.data : undefined);

  return {
    code: input.code ?? "",
    description: input.description ?? "",
    ok: output.ok ?? null,
    stdout: output.stdout ?? "",
    stderr: output.stderr ?? "",
  };
};

/** The post a message was about ("foco … rótulo=…"), shown as a chip above the bubble. */
const focusOf = (text: string): string | null => {
  const match =
    /<caetano_ref>foco [^<]*?(?:slide=(\d+)\/(\d+) )?rótulo="([^"]+)"<\/caetano_ref>/.exec(text);

  if (!match) return null;

  return match[1] ? `${match[3]} · imagem ${match[1]}/${match[2]}` : (match[3] ?? null);
};

const visibleUserText = (text: string): string =>
  text
    .replace(/\s*<vanda_attachment_context>[\s\S]*?<\/vanda_attachment_context>/g, "")
    .replace(/\s*<caetano_ref>[\s\S]*?<\/caetano_ref>/g, "")
    // Early guided messages wrote setting names and ids inline: never show them.
    .replace(
      /\s*\((?:autopilot\.\w+|desligue autopilot\.\w+|ligue autopilot\.\w+|slotId [\w-]+|ruleId [\w-]+)\)/g,
      "",
    )
    .trim();

export function ChatMessage({
  message,
  accountId,
  resources,
}: {
  message: UIMessage;
  accountId: Id<"accounts">;
  resources: ThreadResource[];
}) {
  const enter = useEntranceOnMount();
  // Which of this turn's generated images is expanded in the lightbox.
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  if (message.role === "user") {
    const raw = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    const text = visibleUserText(raw);
    const focus = focusOf(raw);

    const attachments = message.parts.flatMap((part) => {
      if (part.type !== "file") return [];

      return part.mediaType.startsWith("image/")
        ? [{ url: part.url, fileName: part.filename ?? "Imagem anexada" }]
        : [];
    });

    if (!text && attachments.length === 0) return null;

    return (
      <Message align="end" enter={enter}>
        <MessageContent>
          <MessageImageAttachments attachments={attachments} />
          {focus ? (
            <span className="inline-flex items-center gap-1 self-end rounded-full bg-creating-bg px-2 py-0.5 text-micro text-brand-accent">
              <Pin className="size-3" aria-hidden="true" />
              {focus}
            </span>
          ) : null}
          {text ? (
            <Bubble variant="muted">
              <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
            </Bubble>
          ) : null}
        </MessageContent>
      </Message>
    );
  }

  const streaming = message.status === "streaming";

  // Classify the turn's parts. Reasoning is never rendered (no thinking traces).
  // Tool calls collapse into a single "Trabalhou" trace; answer text and
  // generated images stay visible. (Historical approval parts from the old
  // gated era render as plain tool rows.)
  const answers: Array<{ key: number; text: string }> = [];
  const toolRows: ToolPartView[] = [];
  const paintedImages: PaintedImageView[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      const { text } = part;

      if (text.trim()) answers.push({ key: index, text });

      return;
    }

    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const p: ToolPartView = {
        type: part.type,
        state: "state" in part ? part.state : "output-available",
      };

      if ("toolName" in part) p.toolName = part.toolName;

      if ("toolCallId" in part) p.toolCallId = part.toolCallId;

      if ("input" in part) p.input = part.input;

      if ("output" in part) p.output = part.output;

      if ("errorText" in part) p.errorText = part.errorText;

      if ("approval" in part) p.approval = part.approval;

      toolRows.push(p);
      const painted = paintedImageOf(p);

      if (painted && !paintedImages.some((image) => image.imageId === painted.imageId)) {
        paintedImages.push(painted);
      }

      for (const codeImage of codeImagesOf(p)) {
        if (!paintedImages.some((image) => image.imageId === codeImage.imageId)) {
          paintedImages.push(codeImage);
        }
      }
    }
    // reasoning and any other part type are intentionally hidden.
  });

  const anyToolRunning = toolRows.some(
    (p) => p.state === "input-streaming" || p.state === "input-available",
  );

  const nothingYet = streaming && answers.length === 0 && toolRows.length === 0;
  const legacyImageIds = new Set(paintedImages.map((image) => image.imageId));

  const manifestResources = resources.filter(
    (resource) => resource.kind !== "image" || !legacyImageIds.has(resource.imageId),
  );

  return (
    <Message align="start" enter={enter}>
      <MessageContent>
        {toolRows.length > 0 ? <ToolTrace parts={toolRows} running={anyToolRunning} /> : null}
        {answers.map(({ key, text }) => (
          <Bubble key={key} variant="ghost">
            <BubbleContent>
              <StreamingText text={text} streaming={streaming} />
            </BubbleContent>
          </Bubble>
        ))}
        {paintedImages.map((image) => (
          <ThreadImage
            key={image.imageId}
            image={image}
            accountId={accountId}
            onOpen={() => setLightboxId(image.imageId)}
          />
        ))}
        <ThreadResourceList resources={manifestResources} />
        {paintedImages.length > 0 ? (
          <ThreadImageLightbox
            accountId={accountId}
            images={paintedImages}
            selectedId={lightboxId}
            onSelect={setLightboxId}
            onClose={() => setLightboxId(null)}
          />
        ) : null}
        {nothingYet ? <ThinkingMarker /> : null}
      </MessageContent>
    </Message>
  );
}

/** Assistant text with smooth streaming: reveals chunked deltas at a steady pace
 *  while live, shows full text instantly for completed / historical messages. */
function StreamingText({ text, streaming }: { text: string; streaming: boolean }) {
  const [visible] = useSmoothText(text, { charsPerSec: 900, startStreaming: streaming });

  return <Markdown>{visible}</Markdown>;
}

/**
 * The turn's tool work, collapsed behind an Amp-style "Trabalhou" divider. Live
 * while running (auto-expanded, so the owner watches progress), then it settles
 * closed on completion — clickable to reopen. Reasoning never appears here.
 */
function ToolTrace({ parts, running }: { parts: ToolPartView[]; running: boolean }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? running;

  const label = running
    ? "Trabalhando…"
    : `Trabalhou · ${parts.length} ${parts.length === 1 ? "ação" : "ações"}`;

  return (
    <div className="w-full">
      <Marker variant="separator" asChild>
        <button
          type="button"
          onClick={() => setOverride((o) => !(o ?? running))}
          aria-expanded={open}
          className="cursor-pointer transition-colors hover:text-text-3"
        >
          <MarkerContent inline loading={running}>
            {label}
            <ChevronDown
              className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
            />
          </MarkerContent>
        </button>
      </Marker>
      {open ? (
        <div className="mt-1.5 space-y-1 pl-1">
          {parts.map((part) => (
            <ToolRow
              key={part.toolCallId ?? `${part.type}-${part.state}-${toolPathOf(part) ?? ""}`}
              part={part}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolRow({ part }: { part: ToolPartView }) {
  const name = toolNameOf(part);

  if (name === "run_code") return <CodeRunRow part={part} />;
  const label = toolLabelOf(name);
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";

  return (
    <Marker role={running ? "status" : undefined}>
      <MarkerIcon>
        {running ? (
          <MarkerOrb state={orbStateOf(name)} />
        ) : failed ? (
          <X className="text-destructive" />
        ) : (
          <Check className="text-text-5" />
        )}
      </MarkerIcon>
      <MarkerContent tone={failed ? "destructive" : "muted"} loading={running}>
        {label}
        {toolPathOf(part) ? <span className="font-mono"> {toolPathOf(part)}</span> : null}
        {failed ? " — Não foi possível concluir esta etapa." : null}
      </MarkerContent>
    </Marker>
  );
}

/**
 * A run_code call in the trace: the description is the row label; expanding it
 * reveals the Python and, once finished, its stdout/stderr — the traceback the
 * agent self-corrects from is the same one the owner can inspect.
 */
function CodeRunRow({ part }: { part: ToolPartView }) {
  const [open, setOpen] = useState(false);
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  const view = codeRunViewOf(part);
  const errored = failed || view.ok === false;
  const label = view.description.trim() || TOOL_LABEL.run_code!;

  return (
    <div>
      <Marker role={running ? "status" : undefined}>
        <MarkerIcon>
          {running ? (
            <MarkerOrb state="solving" />
          ) : errored ? (
            <X className="text-destructive" />
          ) : (
            <Check className="text-text-5" />
          )}
        </MarkerIcon>
        <MarkerContent tone={errored ? "destructive" : "muted"} loading={running}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex cursor-pointer items-center gap-1 text-left transition-colors hover:text-text-3"
          >
            {label}
            {failed ? " — Não foi possível concluir esta etapa." : null}
            <ChevronDown
              className={cn("size-3 transition-transform duration-200", open && "rotate-180")}
            />
          </button>
        </MarkerContent>
      </Marker>
      {open && view.code ? (
        <div className="mt-1.5 mb-1 ml-5 space-y-1.5">
          <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-body-sm whitespace-pre text-text-3">
            {view.code}
          </pre>
          {view.stdout && !errored ? (
            <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-body-sm whitespace-pre text-text-4">
              {view.stdout}
            </pre>
          ) : null}
          {view.stderr && !errored ? (
            <pre className="max-h-32 overflow-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 font-mono text-body-sm whitespace-pre text-destructive">
              {view.stderr}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
