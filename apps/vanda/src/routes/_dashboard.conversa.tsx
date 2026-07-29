import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import {
  Archive,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Images,
  Paperclip,
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
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@vanda-studio/ui/components/attachment";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import { VandaMark } from "../components/vanda-mark";
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
  paint: "Criando imagem",
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

interface PaintedImageView {
  imageId: string;
  url: string;
  width: number;
  height: number;
}

const paintedImageOf = (part: ToolPartView): PaintedImageView | null => {
  if (toolNameOf(part) !== "paint" || part.state !== "output-available") return null;
  const output = part.output;
  if (!output || typeof output !== "object") return null;
  const value = output as Record<string, unknown>;
  return typeof value.imageId === "string" &&
    typeof value.url === "string" &&
    typeof value.width === "number" &&
    typeof value.height === "number"
    ? {
        imageId: value.imageId,
        url: value.url,
        width: value.width,
        height: value.height,
      }
    : null;
};

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
    <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
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
interface ReadyComposerAttachment {
  imageId: Id<"images">;
  url: string;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
}

interface ComposerAttachment {
  clientId: string;
  fileName: string;
  previewUrl: string;
  mimeType: string;
  width: number;
  height: number;
  state: "uploading" | "error" | "done";
  imageId?: Id<"images">;
  url?: string;
  error?: string;
}

const imageDimensions = async (file: File): Promise<{ width: number; height: number }> => {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
};

const readyAttachment = (attachment: ComposerAttachment): ReadyComposerAttachment | undefined =>
  attachment.state === "done" && attachment.imageId && attachment.url
    ? {
        imageId: attachment.imageId,
        url: attachment.url,
        mimeType: attachment.mimeType,
        fileName: attachment.fileName,
        width: attachment.width,
        height: attachment.height,
      }
    : undefined;

let firstSendHandoff: {
  threadId: string;
  text: string;
  attachments: ReadyComposerAttachment[];
} | null = null;

function MessageImageAttachments({
  attachments,
}: {
  attachments: ReadonlyArray<Pick<ReadyComposerAttachment, "url" | "fileName">>;
}) {
  if (attachments.length === 0) return null;
  return (
    <AttachmentGroup className="justify-end">
      {attachments.map((attachment) => (
        <Attachment key={attachment.url} orientation="vertical" size="sm" className="w-28">
          <AttachmentMedia variant="image" className="w-full">
            <img src={attachment.url} alt={attachment.fileName} loading="lazy" />
          </AttachmentMedia>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}

/** The user's just-sent message plus a thinking marker — the pre-history echo. */
function PendingFirstMessage({
  text,
  attachments,
}: {
  text: string;
  attachments: ReadyComposerAttachment[];
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
          <Marker role="status">
            <MarkerIcon>
              <Spinner />
            </MarkerIcon>
            <MarkerContent className="shimmer">Pensando…</MarkerContent>
          </Marker>
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
    attachments: ReadyComposerAttachment[];
  } | null>(null);

  const send = async (text: string, attachments: ReadyComposerAttachment[]) => {
    const prompt = text.trim();
    if ((!prompt && attachments.length === 0) || pending !== null) return;
    setDraft("");
    setPending({ text: prompt, attachments });
    try {
      const { threadId } = await sendMessage({
        accountId,
        prompt,
        ...(attachments.length > 0
          ? { imageIds: attachments.map((attachment) => attachment.imageId) }
          : {}),
      });
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
        <ChatComposer
          accountId={accountId}
          draft={draft}
          onDraftChange={setDraft}
          onSend={send}
          disabled={pending !== null}
          autoFocus
        />
      </div>
    </div>
  );
}

/** The shared image-capable message composer. */
function ChatComposer({
  accountId,
  draft,
  onDraftChange,
  onSend,
  disabled,
  autoFocus,
}: {
  accountId: Id<"accounts">;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (text: string, attachments: ReadyComposerAttachment[]) => Promise<void>;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const generateUploadUrl = useMutation(api.imageUploads.generateUploadUrl);
  const addImage = useMutation(api.imageUploads.addImage);
  const removeImage = useMutation(api.imageUploads.removeImage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const cancelledUploads = useRef(new Set<string>());
  const uploadControllers = useRef(new Map<string, AbortController>());

  useEffect(
    () => () => {
      for (const attachment of attachmentsRef.current) {
        URL.revokeObjectURL(attachment.previewUrl);
        cancelledUploads.current.add(attachment.clientId);
      }
      for (const controller of uploadControllers.current.values()) controller.abort();
    },
    [],
  );

  const updateAttachment = (clientId: string, patch: Partial<ComposerAttachment>) => {
    setAttachments((current) =>
      current.map((attachment) =>
        attachment.clientId === clientId ? { ...attachment, ...patch } : attachment,
      ),
    );
  };

  const uploadFile = async (file: File) => {
    const clientId = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);
    const initial: ComposerAttachment = {
      clientId,
      fileName: file.name,
      previewUrl,
      mimeType: file.type || "image/jpeg",
      width: 1,
      height: 1,
      state: "uploading",
    };
    setAttachments((current) => [...current, initial]);

    if (!file.type.startsWith("image/")) {
      updateAttachment(clientId, { state: "error", error: "Formato não suportado" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      updateAttachment(clientId, { state: "error", error: "Máximo de 10 MB" });
      return;
    }

    const controller = new AbortController();
    uploadControllers.current.set(clientId, controller);
    try {
      const dimensions = await imageDimensions(file);
      updateAttachment(clientId, dimensions);
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`upload HTTP ${response.status}`);
      const payload = (await response.json()) as { storageId?: Id<"_storage"> };
      if (!payload.storageId) throw new Error("upload returned no storageId");
      const stored = await addImage({
        accountId,
        storageId: payload.storageId,
        mimeType: file.type,
        ...dimensions,
      });
      if (cancelledUploads.current.has(clientId)) {
        await removeImage({ accountId, imageId: stored.imageId });
        return;
      }
      updateAttachment(clientId, {
        state: "done",
        imageId: stored.imageId,
        url: stored.url,
        ...dimensions,
      });
    } catch (error) {
      if (!cancelledUploads.current.has(clientId)) {
        updateAttachment(clientId, {
          state: "error",
          error: error instanceof Error ? error.message : "Falha no envio",
        });
      }
    } finally {
      uploadControllers.current.delete(clientId);
    }
  };

  const selectFiles = (files: Iterable<File> | null) => {
    if (!files) return;
    const remaining = Math.max(0, 4 - attachments.length);
    for (const file of Array.from(files).slice(0, remaining)) void uploadFile(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    const images =
      clipboardFiles.length > 0
        ? clipboardFiles
        : Array.from(event.clipboardData.items).flatMap((item) => {
            if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
            const file = item.getAsFile();
            return file ? [file] : [];
          });
    if (images.length === 0) return;
    event.preventDefault();
    selectFiles(images);
  };

  const removeAttachment = (attachment: ComposerAttachment) => {
    cancelledUploads.current.add(attachment.clientId);
    uploadControllers.current.get(attachment.clientId)?.abort();
    URL.revokeObjectURL(attachment.previewUrl);
    setAttachments((current) =>
      current.filter((candidate) => candidate.clientId !== attachment.clientId),
    );
    if (attachment.imageId) {
      void removeImage({ accountId, imageId: attachment.imageId });
    }
  };

  const readyAttachments = attachments
    .map(readyAttachment)
    .filter((attachment): attachment is ReadyComposerAttachment => attachment !== undefined);
  const attachmentsSettled = attachments.every((attachment) => attachment.state === "done");
  const canSend =
    !disabled &&
    !submitting &&
    attachmentsSettled &&
    (draft.trim().length > 0 || readyAttachments.length > 0);

  const submit = async () => {
    if (!canSend) return;
    setSubmitting(true);
    try {
      await onSend(draft, readyAttachments);
      for (const attachment of attachments) URL.revokeObjectURL(attachment.previewUrl);
      setAttachments([]);
    } catch {
      // Parent restores the draft; attachments remain available for retry.
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <footer className="shrink-0 bg-app px-4 py-3 md:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface p-2 focus-within:border-border-strong"
        >
          {attachments.length > 0 ? (
            <AttachmentGroup className="w-full">
              {attachments.map((attachment) => (
                <Attachment
                  key={attachment.clientId}
                  orientation="vertical"
                  size="sm"
                  state={attachment.state}
                  className="w-24"
                >
                  <AttachmentMedia variant="image" className="w-full">
                    <img src={attachment.previewUrl} alt={attachment.fileName} />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{attachment.fileName}</AttachmentTitle>
                    <AttachmentDescription>
                      {attachment.state === "uploading"
                        ? "Enviando…"
                        : attachment.state === "error"
                          ? (attachment.error ?? "Falha no envio")
                          : `${attachment.width}×${attachment.height}`}
                    </AttachmentDescription>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      type="button"
                      aria-label={`Remover ${attachment.fileName}`}
                      disabled={submitting}
                      onClick={() => removeAttachment(attachment)}
                      className="bg-surface/90 shadow-sm"
                    >
                      <X />
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          ) : null}

          <div className="flex items-end gap-1">
            <ActionTooltip label="Adicionar imagens" side="top">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Adicionar imagens"
                disabled={disabled || submitting || attachments.length >= 4}
                onClick={() => inputRef.current?.click()}
                className="text-text-4"
              >
                <Paperclip />
              </Button>
            </ActionTooltip>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => selectFiles(event.target.files)}
            />
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder="Mande uma mensagem para a Vanda…"
              aria-label="Mensagem para a Vanda"
              rows={1}
              autoFocus={autoFocus}
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-5"
            />
            <ActionTooltip label="Enviar" side="top">
              <span className="inline-flex">
                <Button type="submit" size="icon" aria-label="Enviar" disabled={!canSend}>
                  <ArrowUp />
                </Button>
              </span>
            </ActionTooltip>
          </div>
        </form>
      </div>
    </footer>
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

/** Hide the canned greeting stored by the pre-empty-state thread model. */
function isDefaultWelcome(message: UIMessage): boolean {
  if (message.role !== "assistant") return false;
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
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
  const [canvasProjectId, setCanvasProjectId] = useState<Id<"contentProjects"> | null>(null);

  const messages = useUIMessages(
    api.chat.listMessages,
    { accountId, threadId },
    { initialNumItems: 60, stream: true },
  );

  const send = async (text: string, attachments: ReadyComposerAttachment[]) => {
    const prompt = text.trim();
    if (!prompt && attachments.length === 0) return;
    setDraft("");
    try {
      await sendMessage({
        accountId,
        threadId,
        prompt,
        ...(attachments.length > 0
          ? { imageIds: attachments.map((attachment) => attachment.imageId) }
          : {}),
      });
    } catch (error) {
      setDraft(prompt);
      throw error;
    }
  };

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
                      visibleMessages.map((message) => (
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

          <ChatComposer
            accountId={accountId}
            draft={draft}
            onDraftChange={setDraft}
            onSend={send}
          />
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

const visibleUserText = (text: string): string =>
  text.replace(/\s*<vanda_attachment_context>[\s\S]*?<\/vanda_attachment_context>/g, "").trim();

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
    const text = visibleUserText(
      message.parts
        .filter((part) => part.type === "text")
        .map((part) => (part as { text: string }).text)
        .join("\n"),
    );
    const attachments = message.parts.flatMap((part) => {
      if (part.type !== "file") return [];
      const file = part as { mediaType: string; url: string; filename?: string };
      return file.mediaType.startsWith("image/")
        ? [{ url: file.url, fileName: file.filename ?? "Imagem anexada" }]
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
  // Tool calls collapse into a single "Trabalhou" trace; answer text, carousel
  // previews, and approval cards stay visible.
  const answers: Array<{ key: number; text: string }> = [];
  const toolRows: ToolPartView[] = [];
  const approvals: ToolPartView[] = [];
  const previewProjectIds: Id<"contentProjects">[] = [];
  const paintedImages: PaintedImageView[] = [];
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
      const painted = paintedImageOf(p);
      if (painted && !paintedImages.some((image) => image.imageId === painted.imageId)) {
        paintedImages.push(painted);
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
        {paintedImages.map((image) => (
          <PaintedImage key={image.imageId} image={image} />
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

/** A loose image returned directly by the synchronous paint tool. */
function PaintedImage({ image }: { image: PaintedImageView }) {
  const enter = useEntranceOnMount();
  return (
    <Attachment
      orientation="vertical"
      className={cn("w-full max-w-sm", enter && "animate-attachment-in")}
    >
      <AttachmentMedia
        variant="image"
        className="w-full"
        style={{ aspectRatio: `${image.width} / ${image.height}` }}
      >
        <img
          src={image.url}
          alt="Imagem criada pela Vanda"
          loading="lazy"
          className="size-full object-cover"
        />
      </AttachmentMedia>
    </Attachment>
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
            <ActionTooltip label={`Abrir slide ${index + 1}`} side="top">
              <AttachmentTrigger aria-label={`Abrir slide ${index + 1}`} onClick={onOpen} />
            </ActionTooltip>
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
  const sendMessage = useMutation(api.chat.sendMessage).withOptimisticUpdate((store, args) => {
    if (!args.threadId) return;
    optimisticallySendMessage(api.chat.listMessages)(store, {
      threadId: args.threadId,
      prompt: args.prompt,
    });
  });
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
        <ActionTooltip label="Fechar" side="bottom">
          <Button variant="ghost" size="icon-sm" aria-label="Fechar" onClick={onClose}>
            <X />
          </Button>
        </ActionTooltip>
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
                  <ActionTooltip label="Slide anterior" side="right">
                    <button
                      type="button"
                      aria-label="Slide anterior"
                      disabled={slideIndex === 0}
                      onClick={() => setSlideIndex((index) => Math.max(0, index - 1))}
                      className="absolute top-1/2 left-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-text shadow-sm backdrop-blur-sm disabled:opacity-40"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                  </ActionTooltip>
                  <ActionTooltip label="Próximo slide" side="left">
                    <button
                      type="button"
                      aria-label="Próximo slide"
                      disabled={slideIndex >= slideCount - 1}
                      onClick={() => setSlideIndex((index) => Math.min(slideCount - 1, index + 1))}
                      className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-text shadow-sm backdrop-blur-sm disabled:opacity-40"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </ActionTooltip>
                  <span className="absolute right-2 bottom-2 rounded-md bg-surface/90 px-2 py-0.5 font-mono text-[11px] text-text shadow-sm backdrop-blur-sm">
                    {slideIndex + 1}/{slideCount}
                  </span>
                </>
              ) : null}
            </div>

            {slideCount > 1 ? (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {Array.from({ length: slideCount }, (_, index) => (
                  <ActionTooltip key={index} label={`Slide ${index + 1}`} side="top">
                    <button
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
                  </ActionTooltip>
                ))}
              </div>
            ) : null}

            {currentSlide ? (
              <div className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm leading-snug font-medium text-text">
                    {currentSlide.headline}
                  </p>
                  <ActionTooltip label="Pedir alteração" side="left">
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
                  </ActionTooltip>
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
          <ActionTooltip label="Descartar projeto" side="top">
            <span className="inline-flex">
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
            </span>
          </ActionTooltip>
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
