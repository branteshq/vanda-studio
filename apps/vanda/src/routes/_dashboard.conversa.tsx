import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Download,
  ImageOff,
  Paperclip,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
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
} from "@vanda-studio/ui/components/attachment";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import { ImageLightbox, type ImageLightboxData } from "../components/image-lightbox";
import {
  ActionStateIcon,
  MediaTile,
  MediaTileAction,
  MediaTileActions,
  MediaTileBadge,
  MediaTileCaption,
  MediaTileMedia,
  copyImageToClipboard,
  downloadImageFile,
  useMediaAction,
} from "../components/media-tile";
import { resourcesForMessage, ThreadResourceList } from "../components/thread-resources";
import { VandaMark } from "../components/vanda-mark";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { imageModelLabel } from "../convex/imageModels";
import type { ThreadResource } from "../convex/resourceRefs";

export const Route = createFileRoute("/_dashboard/conversa")({
  component: ConversaPage,
  validateSearch: (search: Record<string, unknown>): { t?: string } =>
    typeof search.t === "string" && search.t ? { t: search.t } : {},
});

const TOOL_LABEL: Record<string, string> = {
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
const TOOL_ORB_STATE: Record<string, OrbState> = {
  list: "searching",
  read: "searching",
  write: "composing",
  start_market_scan: "searching",
  paint: "shaping",
  run_code: "solving",
  create_post: "composing",
  schedule_post: "connecting",
};

const orbStateOf = (name: string): OrbState => TOOL_ORB_STATE[name] ?? "working";

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
  const input = part.input;
  if (!input || typeof input !== "object") return null;
  const path = (input as { path?: unknown }).path;
  return typeof path === "string" ? path : null;
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

const toolDataOf = (part: ToolPartView): unknown => {
  const output = part.output;
  if (output && typeof output === "object" && "data" in output) {
    return (output as { data: unknown }).data;
  }
  return output;
};

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

/** Images produced by a completed run_code call (no frozen URL — gallery is live source). */
const codeImagesOf = (part: ToolPartView): PaintedImageView[] => {
  if (toolNameOf(part) !== "run_code" || part.state !== "output-available") return [];
  const output = toolDataOf(part);
  if (!output || typeof output !== "object") return [];
  const images = (output as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  return images.flatMap((image) => {
    const value = image as Record<string, unknown>;
    return typeof value.imageId === "string" &&
      typeof value.width === "number" &&
      typeof value.height === "number"
      ? [{ imageId: value.imageId, width: value.width, height: value.height }]
      : [];
  });
};

/** The agent-facing fields of a run_code part, for the expandable code trace. */
const codeRunViewOf = (part: ToolPartView) => {
  const input = (part.input ?? {}) as { code?: unknown; description?: unknown };
  const output = (toolDataOf(part) ?? {}) as {
    ok?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  };
  return {
    code: typeof input.code === "string" ? input.code : "",
    description: typeof input.description === "string" ? input.description : "",
    ok: typeof output.ok === "boolean" ? output.ok : null,
    stdout: typeof output.stdout === "string" ? output.stdout : "",
    stderr: typeof output.stderr === "string" ? output.stderr : "",
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
/** The composer stops growing here (~8 lines) and scrolls internally instead. */
const MAX_COMPOSER_HEIGHT = 224;

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
  working,
  onStop,
}: {
  accountId: Id<"accounts">;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (text: string, attachments: ReadyComposerAttachment[]) => Promise<void>;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Vanda is mid-turn — the send affordance becomes a stop button. */
  working?: boolean;
  onStop?: () => void;
}) {
  const generateUploadUrl = useMutation(api.imageUploads.generateUploadUrl);
  const addImage = useMutation(api.imageUploads.addImage);
  const removeImage = useMutation(api.imageUploads.removeImage);
  const usage = useQuery(api.usage.summary);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Auto-grow: the textarea tracks its content height up to the threshold,
  // then freezes and scrolls internally. Layout effect so the height is right
  // before paint (no one-frame jump when a draft is restored).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  }, [draft]);
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

  // Over the usage limit nothing is generated server-side; the composer says
  // so instead of failing sends — a static card, never an LLM-written apology.
  if (usage?.limited) {
    return (
      <footer className="shrink-0 bg-app px-4 py-3 md:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="min-w-0">
              <p className="text-body font-medium text-text">Limite de uso do plano atingido</p>
              <p className="mt-0.5 text-body-sm leading-relaxed text-text-3">
                A Vanda pausa por aqui até a renovação — ou faça upgrade para continuar agora.
              </p>
            </div>
            <Button size="sm" onClick={() => void navigate({ to: "/perfil" })}>
              Ver planos
            </Button>
          </div>
        </div>
      </footer>
    );
  }

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

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Mande uma mensagem para a Vanda…"
            aria-label="Mensagem para a Vanda"
            rows={1}
            autoFocus={autoFocus}
            className="min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-sm text-text outline-none placeholder:text-text-5"
          />

          {/* Amp-style control row: attach on the left, send on the right,
              both riding the input's bottom edge. */}
          <div className="flex items-center justify-between">
            <ActionTooltip label="Adicionar imagens" side="top">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Adicionar imagens"
                disabled={disabled || submitting || attachments.length >= 4}
                onClick={() => inputRef.current?.click()}
                className="text-text-4 hover:text-text"
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
            {working && onStop ? (
              <ActionTooltip label="Parar" side="top">
                <Button type="button" size="icon-sm" aria-label="Parar geração" onClick={onStop}>
                  <Square className="size-3 fill-current" />
                </Button>
              </ActionTooltip>
            ) : (
              <ActionTooltip label="Enviar" side="top">
                <span className="inline-flex">
                  <Button type="submit" size="icon-sm" aria-label="Enviar" disabled={!canSend}>
                    <ArrowUp />
                  </Button>
                </span>
              </ActionTooltip>
            )}
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

  const messages = useUIMessages(
    api.chat.listMessages,
    { accountId, threadId },
    { initialNumItems: 60, stream: true },
  );
  const resourceManifests = useQuery(api.threadResources.listForVanda, {
    accountId,
    threadId,
  });

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

          <ChatComposer
            accountId={accountId}
            draft={draft}
            onDraftChange={setDraft}
            onSend={send}
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
  // Tool calls collapse into a single "Trabalhou" trace; answer text and
  // generated images stay visible. (Historical approval parts from the old
  // gated era render as plain tool rows.)
  const answers: Array<{ key: number; text: string }> = [];
  const toolRows: ToolPartView[] = [];
  const paintedImages: PaintedImageView[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      const text = (part as { text: string }).text;
      if (text.trim()) answers.push({ key: index, text });
      return;
    }
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const p = part as unknown as ToolPartView;
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
          <PaintedImage
            key={image.imageId}
            image={image}
            accountId={accountId}
            onOpen={() => setLightboxId(image.imageId)}
          />
        ))}
        <ThreadResourceList resources={manifestResources} />
        {paintedImages.length > 0 ? (
          <ChatImageLightbox
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
  if (name === "run_code") return <CodeRunRow part={part} />;
  const label = TOOL_LABEL[name] ?? name;
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
        {failed && part.errorText ? ` — ${part.errorText}` : null}
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
            {failed && part.errorText ? ` — ${part.errorText}` : null}
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
          {view.stdout ? (
            <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-body-sm whitespace-pre text-text-4">
              {view.stdout}
            </pre>
          ) : null}
          {view.stderr ? (
            <pre className="max-h-32 overflow-auto rounded-lg border border-destructive/30 bg-destructive/5 p-3 font-mono text-body-sm whitespace-pre text-destructive">
              {view.stderr}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A loose image returned directly by the synchronous paint tool. The transcript
 * freezes the URL at generation time, so liveness comes from the gallery: when
 * the record is gone (deleted from the canvas), the frame gives way to a quiet
 * tombstone instead of a broken image.
 */
/**
 * A generated image in the conversation — the same MediaTile surface as the
 * gallery (hover zoom, copy/download/delete chips, name+model caption scrim),
 * minus the selection toggle: chat has no multi-select. Clicking opens the
 * shared lightbox.
 */
function PaintedImage({
  image,
  accountId,
  onOpen,
}: {
  image: PaintedImageView;
  accountId: Id<"accounts">;
  onOpen: () => void;
}) {
  const enter = useEntranceOnMount();
  const live = useQuery(api.gallery.get, {
    accountId,
    imageId: image.imageId as Id<"images">,
  });
  const url = live?.url ?? image.url;
  const remove = useMutation(api.gallery.remove);
  const copy = useMediaAction(() => copyImageToClipboard(url!));
  const download = useMediaAction(() => downloadImageFile(url!, live?.name ?? null));

  if (live === null) return <DeletedImageNotice />;

  return (
    <MediaTile
      label={live?.name ?? "Imagem criada pela Vanda"}
      {...(url ? { onOpen } : {})}
      className={cn("max-w-sm", enter && "animate-attachment-in")}
    >
      <MediaTileMedia aspectRatio={image.width / image.height}>
        {url ? (
          <img
            src={url}
            alt={live?.name ?? "Imagem criada pela Vanda"}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          // run_code outputs carry no frozen URL — hold the frame until the
          // gallery subscription resolves, with the image "taking shape".
          <span className="relative block size-full">
            <Skeleton className="size-full" />
            <span className="absolute inset-0 flex items-center justify-center">
              <ThinkingOrb state="shaping" size={64} aria-label="Preparando a imagem…" />
            </span>
          </span>
        )}
      </MediaTileMedia>

      {live?.edited ? (
        <MediaTileBadge label="Editada">
          <SquarePen />
        </MediaTileBadge>
      ) : null}

      {url && (
        <MediaTileActions>
          <MediaTileAction label="Copiar imagem" onClick={copy.run}>
            <ActionStateIcon state={copy.state} icon={<Copy />} />
          </MediaTileAction>
          <MediaTileAction label="Baixar" onClick={download.run}>
            <ActionStateIcon state={download.state} icon={<Download />} />
          </MediaTileAction>
          <MediaTileAction
            label="Excluir"
            onClick={() => void remove({ accountId, imageId: image.imageId as Id<"images"> })}
            className="hover:bg-destructive/85"
          >
            <Trash2 />
          </MediaTileAction>
        </MediaTileActions>
      )}

      {live ? (
        <MediaTileCaption>
          <p className="truncate text-body-sm font-medium text-white">{live.name ?? "Sem nome"}</p>
          {live.model ? (
            <p className="truncate text-note text-white/70">{imageModelLabel(live.model)}</p>
          ) : null}
        </MediaTileCaption>
      ) : null}
    </MediaTile>
  );
}

/**
 * Bridges a turn's generated images to the same ImageLightbox the gallery
 * uses — identical panel (rename, copy, download, delete, prompt, cost),
 * arrows navigating the turn's images. `gallery.get` is already subscribed by
 * the inline preview, so opening the viewer costs nothing extra.
 */
function ChatImageLightbox({
  accountId,
  images,
  selectedId,
  onSelect,
  onClose,
}: {
  accountId: Id<"accounts">;
  images: PaintedImageView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const detail = useQuery(
    api.gallery.get,
    selectedId ? { accountId, imageId: selectedId as Id<"images"> } : "skip",
  );
  const rename = useMutation(api.gallery.rename);
  const remove = useMutation(api.gallery.remove);

  // The record vanished under the viewer (deleted from another surface) — close
  // instead of spinning forever on a query that will never resolve.
  useEffect(() => {
    if (selectedId && detail === null) onClose();
  }, [selectedId, detail, onClose]);

  const index = images.findIndex((image) => image.imageId === selectedId);
  const prev = index > 0 ? images[index - 1] : undefined;
  const next = index >= 0 && index < images.length - 1 ? images[index + 1] : undefined;
  const fallback = index >= 0 ? images[index] : undefined;

  const image: ImageLightboxData | null = detail
    ? {
        id: detail.id,
        url: detail.url,
        name: detail.name,
        model: detail.model ? imageModelLabel(detail.model) : null,
        prompt: detail.prompt,
        width: detail.width,
        height: detail.height,
        generationMs: detail.generationMs,
        costUsd: detail.costUsd,
        createdAt: detail.createdAt,
        origin: detail.origin,
        edited: detail.edited,
        promptAuthor: detail.promptAuthor,
      }
    : fallback
      ? {
          id: fallback.imageId,
          url: fallback.url ?? null,
          name: null,
          width: fallback.width,
          height: fallback.height,
        }
      : null;

  return (
    <ImageLightbox
      open={selectedId !== null}
      onClose={onClose}
      image={image}
      loading={detail === undefined}
      onPrev={prev ? () => onSelect(prev.imageId) : undefined}
      onNext={next ? () => onSelect(next.imageId) : undefined}
      onRename={(name) => {
        if (selectedId) void rename({ accountId, imageId: selectedId as Id<"images">, name });
      }}
      onDelete={() => {
        if (!selectedId) return;
        void remove({ accountId, imageId: selectedId as Id<"images"> }).then(onClose);
      }}
    />
  );
}

/** The tombstone left behind when a painted image was deleted from the gallery. */
function DeletedImageNotice() {
  return (
    <div className="flex w-full max-w-sm items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-3.5 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-text-4">
        <ImageOff className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-body font-medium text-text-2">Imagem excluída</p>
        <p className="text-body-sm text-text-4">Esta imagem foi removida da galeria.</p>
      </div>
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
