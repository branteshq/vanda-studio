import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Check, ChevronDown, X } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { z } from "zod";
import { Bubble, BubbleContent } from "@vanda-studio/ui/components/bubble";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import { Marker, MarkerContent, MarkerIcon } from "@vanda-studio/ui/components/marker";
import { Message, MessageContent } from "@vanda-studio/ui/components/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@vanda-studio/ui/components/message-scroller";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import {
  ImageMessageComposer,
  MessageImageAttachments,
  type ReadyImageAttachment,
} from "../components/image-message-composer";
import { EntranceReadyContext, useEntranceOnMount } from "../components/thread-entrance";
import { ThreadImage, ThreadImageLightbox } from "../components/thread-images";
import { resourcesForMessage, ThreadResourceList } from "../components/thread-resources";
import { VandaMark } from "../components/vanda-mark";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { ThreadResource } from "../convex/resourceRefs";

export const Route = createFileRoute("/_dashboard/conversa")({
  component: ConversaPage,
  validateSearch: z.object({ t: z.string().min(1).optional() }),
});

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
  run_code: "Editando imagem com código",
  list: "Explorando",
  read: "Lendo",
  write: "Gravando",
  present: "Mostrando resultado",
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
  return <ThinkingOrb state={state} size={20} style={{ width: 16, height: 16 }} />;
}

/** The shared thinking state: a breathing orb where the answer will appear. */
function ThinkingMarker() {
  return (
    <Marker role="status">
      <MarkerIcon>
        <MarkerOrb state="breathing" />
      </MarkerIcon>
      <MarkerContent className="shimmer">Pensando…</MarkerContent>
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

function ConversaPage() {
  const { activeAccount } = useActiveAccount();

  if (!activeAccount) return null;

  return <ConversationShell key={activeAccount.id} accountId={activeAccount.id} />;
}

/**
 * Resolves the active conversation from the URL. Thread navigation lives in the
 * global app sidebar; this route only selects and renders the transcript.
 *
 * The URL is trusted immediately: a `t` param renders its transcript this frame
 * instead of waiting for `listThreads` to confirm it — that validation happens
 * lazily in the background and only redirects when the id stays invalid (stale
 * bookmark, thread archived elsewhere).
 *
 * No `t` means "new conversation": a purely client-side hero + composer, like
 * t3.chat — no thread exists until the first message is actually sent.
 *
 * Conversations visited this session stay mounted in hidden panes (visibility,
 * not display, so scroll positions survive): their message subscriptions stay
 * live and switching between threads is a pure CSS toggle — instant, and the
 * transcript is already up to date when it reappears.
 */
const MAX_WARM_CONVERSATIONS = 4;

function ConversationShell({ accountId }: { accountId: Id<"accounts"> }) {
  const threads = useQuery(api.chat.listThreads, { accountId });
  const { t } = Route.useSearch();
  const navigate = Route.useNavigate();

  const threadId = t ?? null;

  // LRU of mounted conversations, most recent first. Render-phase update keeps
  // the active thread visible on the very first frame of a switch.
  const [visited, setVisited] = useState<string[]>(threadId ? [threadId] : []);

  if (threadId !== null && visited[0] !== threadId) {
    setVisited(
      [threadId, ...visited.filter((id) => id !== threadId)].slice(0, MAX_WARM_CONVERSATIONS),
    );
  }

  // Drop panes for threads that no longer exist (archived / renamed away),
  // keeping the one the URL still points at until validation settles.
  useEffect(() => {
    if (threads === undefined) return;
    setVisited((prev) =>
      prev.filter((id) => id === t || threads.some((thread) => thread.threadId === id)),
    );
  }, [threads, t]);

  // Lazy validation with a grace period: a thread created milliseconds ago may
  // not be reflected in the (cached) list yet, so never redirect on the first
  // sight of an unknown id — only if it is still unknown shortly after.
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  useEffect(() => {
    if (!t || threads === undefined) return;

    if (threads.some((thread) => thread.threadId === t)) return;

    const timer = setTimeout(() => {
      const latest = threadsRef.current;

      if (latest !== undefined && !latest.some((thread) => thread.threadId === t)) {
        void navigate({ search: {}, replace: true });
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [t, threads, navigate]);

  return (
    <div className="animate-mode-in relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {visited.map((id) => (
        <div
          key={id}
          inert={id !== threadId}
          className={cn("absolute inset-0 flex", id !== threadId && "invisible")}
        >
          <Conversation accountId={accountId} threadId={id} />
        </div>
      ))}
      {threadId === null ? (
        <div className="absolute inset-0 flex">
          <NewConversation accountId={accountId} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Bridges the first send into the freshly created thread: `Conversation` shows
 * this echo instead of a skeleton while the new thread's history subscription
 * makes its first round-trip, so the transition is seamless.
 */
let firstSendHandoff: {
  threadId: string;
  text: string;
  attachments: ReadyImageAttachment[];
} | null = null;

/** The user's just-sent message plus a thinking marker — the pre-history echo. */
function PendingFirstMessage({
  text,
  attachments,
}: {
  text: string;
  attachments: ReadyImageAttachment[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <Message align="end">
        <MessageContent>
          <MessageImageAttachments attachments={attachments} />
          {text ? (
            <Bubble variant="muted">
              <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
            </Bubble>
          ) : null}
        </MessageContent>
      </Message>
      <Message align="start">
        <MessageContent>
          <ThinkingMarker />
        </MessageContent>
      </Message>
    </div>
  );
}

/**
 * The "Nova conversa" state: hero + composer, zero server work. The thread is
 * only created when the first message is sent — the send mutation creates it,
 * then the URL flips to the new id.
 */
function NewConversation({ accountId }: { accountId: Id<"accounts"> }) {
  const sendMessage = useMutation(api.chat.sendMessage);
  const navigate = Route.useNavigate();
  const [draft, setDraft] = useState("");

  const [pending, setPending] = useState<{
    text: string;
    attachments: ReadyImageAttachment[];
  } | null>(null);

  const send = async (text: string, attachments: ReadyImageAttachment[]) => {
    const prompt = text.trim();

    if ((!prompt && attachments.length === 0) || pending !== null) return;
    setDraft("");
    setPending({ text: prompt, attachments });

    try {
      const request: Parameters<typeof sendMessage>[0] = {
        accountId,
        prompt,
      };

      if (attachments.length > 0) {
        request.imageIds = attachments.map((attachment) => attachment.imageId);
      }

      const { threadId } = await sendMessage(request);

      firstSendHandoff = { threadId, text: prompt, attachments };
      await navigate({ search: { t: threadId }, replace: true });
    } catch (error) {
      setPending(null);
      setDraft(prompt);
      throw error;
    }
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {pending === null ? (
            <div className="flex h-full items-center justify-center">
              <NewConversationHero />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
              <PendingFirstMessage text={pending.text} attachments={pending.attachments} />
            </div>
          )}
        </div>
        <ImageMessageComposer
          accountId={accountId}
          draft={draft}
          onDraftChange={setDraft}
          onSend={send}
          placeholder="Mande uma mensagem para a Vanda…"
          ariaLabel="Mensagem para a Vanda"
          agentName="A Vanda"
          disabled={pending !== null}
          autoFocus
        />
      </div>
    </div>
  );
}

/** Hide the canned greeting stored by the pre-empty-state thread model. */
function isDefaultWelcome(message: UIMessage): boolean {
  if (message.role !== "assistant") return false;

  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  return text.startsWith("Oi! Eu sou a Vanda, sua operadora de crescimento no Instagram.");
}

function NewConversationHero() {
  const { user } = useUser();

  const firstName =
    user?.firstName?.trim() ||
    user?.fullName?.trim().split(/\s+/)[0] ||
    user?.username?.trim() ||
    null;

  return (
    <section className="relative flex min-h-72 w-full items-center justify-center px-4 py-16 text-center">
      <VandaMark
        size={500}
        from="currentColor"
        to="currentColor"
        className="pointer-events-none absolute h-auto w-[min(30rem,76vw)] text-brand-accent opacity-[0.035]"
      />
      <h1 className="relative max-w-2xl text-2xl leading-tight font-medium tracking-tight text-text md:text-[28px]">
        {firstName ? `No que a Vanda pode ajudar, ${firstName}?` : "No que a Vanda pode ajudar?"}
      </h1>
    </section>
  );
}

function Conversation({ accountId, threadId }: { accountId: Id<"accounts">; threadId: string }) {
  // Optimistic: the user's text bubble renders the frame Enter is pressed, then
  // the server copy (including any image parts) replaces it after the round-trip.
  const sendMessage = useMutation(api.chat.sendMessage).withOptimisticUpdate((store, args) => {
    if (!args.threadId || !args.prompt.trim()) return;
    optimisticallySendMessage(api.chat.listMessages)(store, {
      threadId: args.threadId,
      prompt: args.prompt,
    });
  });

  const [draft, setDraft] = useState("");

  const messages = useUIMessages(
    api.chat.listMessages,
    { accountId, threadId },
    { initialNumItems: 60, stream: true },
  );

  const resourceManifests = useQuery(api.threadResources.listForVanda, {
    accountId,
    threadId,
  });

  const send = async (text: string, attachments: ReadyImageAttachment[]) => {
    const prompt = text.trim();

    if (!prompt && attachments.length === 0) return;
    setDraft("");

    try {
      const request: Parameters<typeof sendMessage>[0] = {
        accountId,
        threadId,
        prompt,
      };

      if (attachments.length > 0) {
        request.imageIds = attachments.map((attachment) => attachment.imageId);
      }

      await sendMessage(request);
    } catch (error) {
      setDraft(prompt);
      throw error;
    }
  };

  const stopGeneration = useMutation(api.chat.stopGeneration);
  // The activity row covers the whole turn (tool phases included), while the
  // message status only covers streamed text — the stop affordance needs both.
  const threads = useQuery(api.chat.listThreads, { accountId });

  const processing =
    threads?.some((thread) => thread.threadId === threadId && thread.processing) ?? false;

  const loading = messages.status === "LoadingFirstPage";

  // Seamless first-send: while the fresh thread's history loads, keep showing
  // the message the user just sent instead of flashing a skeleton.
  const handoff =
    firstSendHandoff !== null && firstSendHandoff.threadId === threadId ? firstSendHandoff : null;

  useEffect(() => {
    if (!loading && handoff !== null) firstSendHandoff = null;
  }, [loading, handoff]);
  const visibleMessages = messages.results.filter((message) => !isDefaultWelcome(message));
  const empty = !loading && visibleMessages.length === 0;
  const streaming = visibleMessages.at(-1)?.status === "streaming";

  // Flip entrance animations on one frame after the first history paint.
  const [entranceReady, setEntranceReady] = useState(false);
  useEffect(() => {
    if (loading || entranceReady) return;
    const id = requestAnimationFrame(() => setEntranceReady(true));

    return () => cancelAnimationFrame(id);
  }, [loading, entranceReady]);

  return (
    <EntranceReadyContext.Provider value={entranceReady}>
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
            <div className="min-h-0 flex-1 overflow-hidden">
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent
                    aria-busy={streaming}
                    className="mx-auto w-full max-w-3xl gap-6 px-4 py-8 md:px-6"
                  >
                    {loading ? (
                      handoff ? (
                        <PendingFirstMessage
                          text={handoff.text}
                          attachments={handoff.attachments}
                        />
                      ) : (
                        <ConversationSkeleton />
                      )
                    ) : empty ? (
                      <MessageScrollerItem
                        messageId="new-conversation"
                        className="flex flex-1 items-center justify-center"
                      >
                        <NewConversationHero />
                      </MessageScrollerItem>
                    ) : (
                      visibleMessages.map((message, index) => (
                        <MessageScrollerItem
                          key={message.key}
                          messageId={message.key}
                          scrollAnchor={message.role === "user"}
                        >
                          <ChatMessage
                            message={message}
                            accountId={accountId}
                            resources={resourcesForMessage(
                              visibleMessages,
                              index,
                              resourceManifests ?? [],
                            )}
                          />
                        </MessageScrollerItem>
                      ))
                    )}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </div>
          </MessageScrollerProvider>

          <ImageMessageComposer
            accountId={accountId}
            draft={draft}
            onDraftChange={setDraft}
            onSend={send}
            placeholder="Mande uma mensagem para a Vanda…"
            ariaLabel="Mensagem para a Vanda"
            agentName="A Vanda"
            working={processing || streaming}
            onStop={() => void stopGeneration({ accountId, threadId })}
          />
        </div>
      </div>
    </EntranceReadyContext.Provider>
  );
}

const visibleUserText = (text: string): string =>
  text.replace(/\s*<vanda_attachment_context>[\s\S]*?<\/vanda_attachment_context>/g, "").trim();

function ChatMessage({
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
    const text = visibleUserText(
      message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    );

    const attachments = message.parts.flatMap((part) => {
      if (part.type !== "file") return [];

      return part.mediaType.startsWith("image/")
        ? [{ url: part.url, fileName: part.filename ?? "Imagem anexada" }]
        : [];
    });

    if (!text && attachments.length === 0) return null;

    return (
      <Message align="end" className={cn(enter && "animate-message-in")}>
        <MessageContent>
          <MessageImageAttachments attachments={attachments} />
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
    <Message align="start" className={cn(enter && "animate-message-in")}>
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
          <MarkerContent className={cn("inline-flex items-center gap-1", running && "shimmer")}>
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
      <MarkerContent
        className={cn("text-text-4", running && "shimmer", failed && "text-destructive")}
      >
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
        <MarkerContent
          className={cn("text-text-4", running && "shimmer", errored && "text-destructive")}
        >
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

// --- Carousel canvas --------------------------------------------------------

function ConversationSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="flex gap-3">
        <Skeleton className="size-7 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-9 w-1/3 rounded-2xl" />
      </div>
    </div>
  );
}
