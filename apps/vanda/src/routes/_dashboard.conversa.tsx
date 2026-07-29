import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSmoothText, useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Images,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
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
import {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTrigger,
} from "@vanda-studio/ui/components/attachment";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export const Route = createFileRoute("/_dashboard/conversa")({
  component: ConversaPage,
  validateSearch: (search: Record<string, unknown>): { t?: string } =>
    typeof search.t === "string" && search.t ? { t: search.t } : {},
});

type StatusTone = "neutral" | "creating" | "needs" | "scheduled" | "done";

const STATUS_META: Record<string, { readonly label: string; readonly tone: StatusTone }> = {
  planning: { label: "Planejando", tone: "creating" },
  draft: { label: "Rascunho", tone: "neutral" },
  blocked: { label: "Precisa de você", tone: "needs" },
  ready_for_render: { label: "Pronto para renderizar", tone: "creating" },
  rendering: { label: "Renderizando", tone: "creating" },
  ready: { label: "Pronto para revisão", tone: "done" },
  scheduled: { label: "Agendado", tone: "scheduled" },
  published: { label: "Publicado", tone: "done" },
  failed: { label: "Falhou", tone: "needs" },
  archived: { label: "Arquivado", tone: "neutral" },
};

const TOOL_LABEL: Record<string, string> = {
  get_brand_memory: "Consultando a memória da marca",
  list_opportunities: "Listando oportunidades",
  get_market_status: "Verificando a varredura de mercado",
  start_market_scan: "Iniciando varredura de mercado",
  list_projects: "Listando projetos",
  get_project: "Abrindo projeto",
  create_carousel: "Iniciando criação do carrossel",
  revise_slide: "Enviando revisão de slide",
  request_render: "Enfileirando render",
  publish_project: "Publicação no Instagram",
  discard_project: "Arquivando projeto",
};

const SUGGESTIONS = [
  "Procure uma oportunidade no meu mercado",
  "O que você sabe sobre a minha marca?",
  "Mostre meus projetos de conteúdo",
];

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

const projectIdOf = (part: ToolPartView): Id<"contentProjects"> | null => {
  for (const value of [part.input, part.output]) {
    if (value && typeof value === "object" && "projectId" in value) {
      const id = (value as { projectId?: unknown }).projectId;
      if (typeof id === "string") return id as Id<"contentProjects">;
    }
  }
  return null;
};

function ConversaPage() {
  const { activeAccount } = useActiveAccount();
  if (!activeAccount) return null;
  return <ConversationShell key={activeAccount.id} accountId={activeAccount.id} />;
}

/**
 * Resolves the active conversation from the URL. Thread navigation lives in the
 * global app sidebar; this route only selects and renders the transcript.
 */
function ConversationShell({ accountId }: { accountId: Id<"accounts"> }) {
  const threads = useQuery(api.chat.listThreads, { accountId });
  const createNewThread = useMutation(api.chat.createNewThread);
  const { t } = Route.useSearch();
  const navigate = Route.useNavigate();
  const creatingRef = useRef(false);

  const threadId =
    threads === undefined
      ? undefined
      : t && threads.some((thread) => thread.threadId === t)
        ? t
        : (threads[0]?.threadId ?? null);

  // First visit (or everything archived): open a fresh conversation.
  useEffect(() => {
    if (threads === undefined || threads.length > 0 || creatingRef.current) return;
    creatingRef.current = true;
    void createNewThread({ accountId })
      .then((id) => navigate({ search: { t: id }, replace: true }))
      .finally(() => {
        creatingRef.current = false;
      });
  }, [threads, createNewThread, accountId, navigate]);

  return threadId ? (
    <Conversation key={threadId} accountId={accountId} threadId={threadId} />
  ) : (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Spinner className="size-5 text-text-4" />
    </div>
  );
}

/**
 * True once the initial history has painted, so entrance animations fire only for
 * content that arrives afterward — never the whole thread cascading in on load.
 * Components freeze the value at their own mount, so a row/card/attachment animates
 * iff it mounted after first paint.
 */
const EntranceReadyContext = createContext(false);
function useEntranceOnMount(): boolean {
  const ready = useContext(EntranceReadyContext);
  return useState(ready)[0];
}

function Conversation({ accountId, threadId }: { accountId: Id<"accounts">; threadId: string }) {
  const sendMessage = useMutation(api.chat.sendMessage);
  const [draft, setDraft] = useState("");
  const [canvasProjectId, setCanvasProjectId] = useState<Id<"contentProjects"> | null>(null);

  const messages = useUIMessages(
    api.chat.listMessages,
    { accountId, threadId },
    { initialNumItems: 60, stream: true },
  );

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    setDraft("");
    await sendMessage({ accountId, threadId, prompt });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  };

  const loading = messages.status === "LoadingFirstPage";
  const showSuggestions = !loading && messages.results.length <= 1;
  const streaming = messages.results.at(-1)?.status === "streaming";

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
                      <ConversationSkeleton />
                    ) : (
                      messages.results.map((message) => (
                        <MessageScrollerItem
                          key={message.key}
                          messageId={message.key}
                          scrollAnchor={message.role === "user"}
                        >
                          <ChatMessage
                            message={message}
                            accountId={accountId}
                            threadId={threadId}
                            onOpenProject={setCanvasProjectId}
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

          <footer className="shrink-0 border-t border-border bg-app px-4 py-3 md:px-6">
            <div className="mx-auto w-full max-w-3xl">
              {showSuggestions ? (
                <div className="mb-2.5 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-text-3 transition-colors hover:border-border-strong hover:text-text"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
              <form
                onSubmit={onSubmit}
                className="flex items-end gap-2 rounded-xl border border-border bg-surface p-2 focus-within:border-border-strong"
              >
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onComposerKeyDown}
                  placeholder="Mande uma mensagem para a Vanda…"
                  aria-label="Mensagem para a Vanda"
                  rows={1}
                  className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-5"
                />
                <Button type="submit" size="icon" aria-label="Enviar" disabled={!draft.trim()}>
                  <ArrowUp />
                </Button>
              </form>
            </div>
          </footer>
        </div>

        {canvasProjectId ? (
          <CarouselCanvas
            projectId={canvasProjectId}
            accountId={accountId}
            threadId={threadId}
            onClose={() => setCanvasProjectId(null)}
          />
        ) : null}
      </div>
    </EntranceReadyContext.Provider>
  );
}

function ChatMessage({
  message,
  accountId,
  threadId,
  onOpenProject,
}: {
  message: UIMessage;
  accountId: Id<"accounts">;
  threadId: string;
  onOpenProject: (projectId: Id<"contentProjects">) => void;
}) {
  const enter = useEntranceOnMount();

  if (message.role === "user") {
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => (part as { text: string }).text)
      .join("\n");
    if (!text.trim()) return null;
    return (
      <Message align="end" className={cn(enter && "animate-message-in")}>
        <MessageContent>
          <Bubble variant="muted">
            <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  const streaming = message.status === "streaming";

  // Classify the turn's parts. Reasoning is never rendered (no thinking traces).
  // Tool calls collapse into a single "Trabalhou" trace; answer text, carousel
  // previews, and approval cards stay visible.
  const answers: Array<{ key: number; text: string }> = [];
  const toolRows: ToolPartView[] = [];
  const approvals: ToolPartView[] = [];
  const previewProjectIds: Id<"contentProjects">[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      const text = (part as { text: string }).text;
      if (text.trim()) answers.push({ key: index, text });
      return;
    }
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const p = part as unknown as ToolPartView;
      if (p.state === "approval-requested" || p.state === "approval-responded") {
        approvals.push(p);
      } else {
        toolRows.push(p);
      }
      const pid = projectIdOf(p);
      if (pid && p.state === "output-available" && !previewProjectIds.includes(pid)) {
        previewProjectIds.push(pid);
      }
    }
    // reasoning and any other part type are intentionally hidden.
  });

  const anyToolRunning = toolRows.some(
    (p) => p.state === "input-streaming" || p.state === "input-available",
  );
  const nothingYet =
    streaming && answers.length === 0 && toolRows.length === 0 && approvals.length === 0;

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
        {previewProjectIds.map((pid) => (
          <ProjectPreview key={pid} projectId={pid} onOpen={() => onOpenProject(pid)} />
        ))}
        {approvals.map((p, index) =>
          p.state === "approval-requested" && p.approval ? (
            <ApprovalRequest
              key={p.approval.id}
              part={p}
              accountId={accountId}
              threadId={threadId}
              approvalId={p.approval.id}
              projectId={projectIdOf(p)}
              onOpenProject={onOpenProject}
            />
          ) : (
            <ApprovalResponded key={index} approved={p.approval?.approved === true} />
          ),
        )}
        {nothingYet ? (
          <Marker role="status">
            <MarkerIcon>
              <Spinner />
            </MarkerIcon>
            <MarkerContent className="shimmer">Pensando…</MarkerContent>
          </Marker>
        ) : null}
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
          {parts.map((part, index) => (
            <ToolRow key={index} part={part} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ToolRow({ part }: { part: ToolPartView }) {
  const name = toolNameOf(part);
  const label = TOOL_LABEL[name] ?? name;
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  return (
    <Marker role={running ? "status" : undefined}>
      <MarkerIcon>
        {running ? (
          <Spinner />
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
        {failed && part.errorText ? ` — ${part.errorText}` : null}
      </MarkerContent>
    </Marker>
  );
}

function ApprovalResponded({ approved }: { approved: boolean }) {
  return (
    <Marker>
      <MarkerIcon>{approved ? <Check className="text-green" /> : <X />}</MarkerIcon>
      <MarkerContent>
        {approved ? "Publicação aprovada por você" : "Publicação negada por você"}
      </MarkerContent>
    </Marker>
  );
}

/** Inline rendered-slide preview: the exact media, as image attachments. */
function ProjectPreview({
  projectId,
  onOpen,
}: {
  projectId: Id<"contentProjects">;
  onOpen: () => void;
}) {
  const enter = useEntranceOnMount();
  const data = useQuery(api.contentStudio.project, { projectId });
  const slides = data?.renderedSlideUrls ?? [];

  if (slides.length === 0) {
    return (
      <Button variant="soft" size="sm" className="self-start" onClick={onOpen}>
        <Images />
        Abrir carrossel
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <AttachmentGroup className="max-w-md">
        {slides.slice(0, 8).map((url, index) => (
          <Attachment
            key={index}
            orientation="vertical"
            size="sm"
            className={cn(enter && "animate-attachment-in")}
            style={enter ? { animationDelay: `${Math.min(index, 6) * 45}ms` } : undefined}
          >
            <AttachmentMedia variant="image">
              <img src={url} alt={`Slide ${index + 1}`} />
            </AttachmentMedia>
            <AttachmentTrigger aria-label={`Abrir slide ${index + 1}`} onClick={onOpen} />
          </Attachment>
        ))}
      </AttachmentGroup>
      <Button variant="soft" size="sm" className="self-start" onClick={onOpen}>
        <Images />
        Revisar carrossel
      </Button>
    </div>
  );
}

function ApprovalRequest({
  part,
  accountId,
  threadId,
  approvalId,
  projectId,
  onOpenProject,
}: {
  part: ToolPartView;
  accountId: Id<"accounts">;
  threadId: string;
  approvalId: string;
  projectId: Id<"contentProjects"> | null;
  onOpenProject: (projectId: Id<"contentProjects">) => void;
}) {
  const enter = useEntranceOnMount();
  const respond = useMutation(api.chat.respondToApproval);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const scheduledFor =
    part.input && typeof part.input === "object" && "scheduledFor" in part.input
      ? (part.input as { scheduledFor?: string }).scheduledFor
      : undefined;

  const answer = async (approve: boolean) => {
    setBusy(approve ? "approve" : "deny");
    try {
      await respond({ accountId, threadId, approvalId, approve });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-brand-accent/30 bg-brand-accent/5 p-4",
        enter && "animate-card-in",
      )}
    >
      <div className="flex items-center gap-2">
        <Send className="size-4 text-brand-accent" />
        <h3 className="text-sm font-semibold text-text">
          Vanda quer publicar este carrossel no Instagram
        </h3>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-text-3">
        {scheduledFor
          ? `Publicação agendada para ${new Date(scheduledFor).toLocaleString("pt-BR")}.`
          : "Publicação imediata após a aprovação."}{" "}
        Revise o carrossel exato antes de aprovar — nada é publicado sem a sua decisão.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {projectId ? (
          <Button variant="outline" size="sm" onClick={() => onOpenProject(projectId)}>
            <Images />
            Revisar carrossel
          </Button>
        ) : null}
        <Button size="sm" disabled={busy !== null} onClick={() => void answer(true)}>
          {busy === "approve" ? <Spinner className="size-3.5" /> : <Check />}
          Aprovar e publicar
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void answer(false)}
        >
          <X />
          Negar
        </Button>
      </div>
    </div>
  );
}

// --- Carousel canvas --------------------------------------------------------

function CarouselCanvas({
  projectId,
  accountId,
  threadId,
  onClose,
}: {
  projectId: Id<"contentProjects">;
  accountId: Id<"accounts">;
  threadId: string;
  onClose: () => void;
}) {
  const data = useQuery(api.contentStudio.project, { projectId });
  const sendMessage = useMutation(api.chat.sendMessage);
  const reviewDraft = useAction(api.contentStudioNode.reviewDraft);
  const requestRender = useMutation(api.contentStudio.requestRender);
  const archiveProject = useMutation(api.contentStudio.archiveProject);
  const approveProject = useMutation(api.contentStudio.approveProject);
  const [slideIndex, setSlideIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisingSlideId, setRevisingSlideId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    setSlideIndex(0);
    setRevisingSlideId(null);
    setInstruction("");
    setError(null);
  }, [projectId]);

  const project = data?.project;
  const document = data?.document;
  const rendered = data?.renderedSlideUrls ?? [];
  const slides = document?.slides ?? [];
  const slideCount = Math.max(rendered.length, slides.length);
  const status = project ? STATUS_META[project.status] : undefined;
  const currentSlide = slides[slideIndex];
  const currentUrl = rendered[slideIndex] ?? null;

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A ação não terminou.");
    } finally {
      setBusy(null);
    }
  };

  const requestRevision = async () => {
    const slide = currentSlide;
    const text = instruction.trim();
    if (!slide || !text) return;
    await run("revise", async () => {
      await sendMessage({
        accountId,
        threadId,
        prompt: `Refaça o slide ${slide.position} do projeto ${projectId} com esta instrução: ${text}`,
      });
      setRevisingSlideId(null);
      setInstruction("");
    });
  };

  return (
    <aside className="animate-canvas-in absolute inset-0 z-30 flex flex-col border-border bg-app md:static md:z-auto md:w-[26rem] md:shrink-0 md:border-l xl:w-[30rem]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
          {project?.title ?? "Carrossel"}
        </h2>
        {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
        <Button variant="ghost" size="icon-sm" aria-label="Fechar" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {data === undefined ? (
          <div className="space-y-4">
            <Skeleton className="mx-auto aspect-[4/5] w-full max-w-80 rounded-xl" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : !project ? (
          <p className="text-sm text-text-4">Projeto não encontrado.</p>
        ) : (
          <div className="space-y-4">
            <div className="relative mx-auto aspect-[4/5] w-full max-w-80 overflow-hidden rounded-xl border border-border bg-inset">
              {currentUrl ? (
                <img
                  src={currentUrl}
                  alt={`Slide ${slideIndex + 1}`}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : currentSlide ? (
                <div className="absolute inset-0 flex flex-col justify-end p-6">
                  <p className="text-xs font-medium text-text-4">
                    Pré-visualização (ainda sem render)
                  </p>
                  <p className="mt-1 text-lg leading-snug font-semibold text-text">
                    {currentSlide.headline}
                  </p>
                  <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-text-3">
                    {currentSlide.body || currentSlide.bullets.join(" · ")}
                  </p>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-text-5">
                  <CircleDashed className="size-6" />
                </div>
              )}

              {slideCount > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label="Slide anterior"
                    disabled={slideIndex === 0}
                    onClick={() => setSlideIndex((index) => Math.max(0, index - 1))}
                    className="absolute top-1/2 left-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-text shadow-sm backdrop-blur-sm disabled:opacity-40"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Próximo slide"
                    disabled={slideIndex >= slideCount - 1}
                    onClick={() => setSlideIndex((index) => Math.min(slideCount - 1, index + 1))}
                    className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-text shadow-sm backdrop-blur-sm disabled:opacity-40"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                  <span className="absolute right-2 bottom-2 rounded-md bg-surface/90 px-2 py-0.5 font-mono text-[11px] text-text shadow-sm backdrop-blur-sm">
                    {slideIndex + 1}/{slideCount}
                  </span>
                </>
              ) : null}
            </div>

            {slideCount > 1 ? (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {Array.from({ length: slideCount }, (_, index) => (
                  <button
                    key={index}
                    type="button"
                    aria-label={`Ir para o slide ${index + 1}`}
                    onClick={() => setSlideIndex(index)}
                    className={cn(
                      "relative aspect-[4/5] w-14 shrink-0 overflow-hidden rounded-md border",
                      index === slideIndex
                        ? "border-brand-accent ring-1 ring-brand-accent"
                        : "border-border",
                    )}
                  >
                    {rendered[index] ? (
                      <img src={rendered[index]} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-center justify-center bg-inset font-mono text-[10px] text-text-4">
                        {index + 1}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : null}

            {currentSlide ? (
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm leading-snug font-medium text-text">
                    {currentSlide.headline}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Pedir alteração no slide ${currentSlide.position}`}
                    onClick={() => {
                      setRevisingSlideId(
                        revisingSlideId === currentSlide.slideId ? null : currentSlide.slideId,
                      );
                      setInstruction("");
                    }}
                  >
                    <Sparkles />
                  </Button>
                </div>
                {revisingSlideId === currentSlide.slideId ? (
                  <div className="mt-2 flex gap-2 border-t border-border pt-2">
                    <input
                      value={instruction}
                      onChange={(event) => setInstruction(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void requestRevision();
                      }}
                      placeholder="O que deve mudar neste slide?"
                      aria-label="Instrução de alteração"
                      className="h-8 min-w-0 flex-1 rounded-md border border-border bg-inset px-2 text-sm text-text outline-none placeholder:text-text-5"
                      autoFocus
                    />
                    <Button
                      variant="soft"
                      size="sm"
                      disabled={!instruction.trim() || busy === "revise"}
                      onClick={() => void requestRevision()}
                    >
                      {busy === "revise" ? <Spinner className="size-3.5" /> : <Sparkles />}
                      Pedir
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {document ? (
              <section>
                <h3 className="text-sm font-semibold text-text">Legenda</h3>
                <div className="mt-1.5 rounded-lg border border-border bg-surface p-3">
                  <Markdown variant="reading" className="text-text-3">
                    {document.caption}
                  </Markdown>
                </div>
              </section>
            ) : null}

            {document?.reviewSummary ? (
              <section className="rounded-lg border border-border bg-inset p-3">
                <h3 className="text-xs font-semibold text-text-2">Revisão editorial</h3>
                <p className="mt-1 text-xs leading-relaxed text-text-3">{document.reviewSummary}</p>
              </section>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {project ? (
        <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-surface p-3">
          {project.status === "ready" ? (
            <Button
              className="flex-1"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm("Aprovar este carrossel e publicar no Instagram conectado?"))
                  void run("approve", () => approveProject({ projectId }));
              }}
            >
              {busy === "approve" ? <Spinner className="size-4" /> : <Send />}
              Aprovar e publicar
            </Button>
          ) : document?.reviewStatus === "pending" ? (
            <Button
              className="flex-1"
              disabled={busy !== null}
              onClick={() => void run("review", () => reviewDraft({ projectId }))}
            >
              {busy === "review" ? <Spinner className="size-4" /> : <Sparkles />}
              Revisar alterações
            </Button>
          ) : project.status === "failed" ? (
            <Button
              className="flex-1"
              disabled={busy !== null}
              onClick={() => void run("render", () => requestRender({ projectId }))}
            >
              <RefreshCw />
              Tentar renderizar de novo
            </Button>
          ) : (
            <Button variant="outline" className="flex-1" disabled>
              <CircleDashed />
              {status?.label ?? project.status}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            aria-label="Descartar projeto"
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm("Arquivar este carrossel?"))
                void run("archive", async () => {
                  await archiveProject({ projectId });
                  onClose();
                });
            }}
          >
            <Archive />
          </Button>
        </footer>
      ) : null}
    </aside>
  );
}

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
