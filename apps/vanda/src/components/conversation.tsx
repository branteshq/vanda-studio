import {
  useEffect,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useUser } from "@clerk/tanstack-react-start";
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Check, ChevronDown, Pin, X } from "lucide-react";
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
import {
  ImageMessageComposer,
  MessageImageAttachments,
  type ReadyImageAttachment,
} from "./image-message-composer";
import { Caetano, CaetanoHead, type CaetanoState } from "./caetano";
import { EntranceReadyContext, useEntranceOnMount } from "./thread-entrance";
import { ThreadImage, ThreadImageLightbox, ThreadImageThumb } from "./thread-images";
import { resourcesForMessage, ThreadResourceList } from "./thread-resources";
import { VandaMark } from "./vanda-mark";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { isPlatformTurn } from "../convex/platformTurn";
import type { ThreadResource } from "../convex/resourceRefs";

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
function ThinkingMarker() {
  return (
    <Marker role="status">
      <MarkerIcon>
        <MarkerOrb state="breathing" />
      </MarkerIcon>
      <MarkerContent loading>Pensando…</MarkerContent>
    </Marker>
  );
}

/** The brand guide file; same path as BRAND_FILE_PATH in convex/brandFile.ts. */
const BRAND_FILE_PATH = "/brand/marca.md";

/** The loose view of a tool part — covers `tool-*` and `dynamic-tool` shapes. */
interface ToolPartView {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state: string;
  input?: unknown;
  output?: unknown;
}

const toolNameOf = (part: ToolPartView): string =>
  part.type === "dynamic-tool" ? (part.toolName ?? "tool") : part.type.slice("tool-".length);

/** Workspace tools carry the touched path — surface it in the trace row. */
const toolPathOf = (part: ToolPartView): string | null => {
  const name = toolNameOf(part);

  if (name !== "read" && name !== "list" && name !== "write") return null;
  const parsed = z.object({ path: z.string() }).safeParse(part.input);

  return parsed.success ? parsed.data.path : null;
};

const toolDataSchema = z.union([
  z.object({ data: z.json() }).transform(({ data }) => data),
  z.json(),
]);

const toolDataOf = (part: ToolPartView) => toolDataSchema.safeParse(part.output);

const isRunning = (part: ToolPartView): boolean =>
  part.state === "input-streaming" || part.state === "input-available";

const isBrandWrite = (part: ToolPartView): boolean =>
  toolNameOf(part) === "write" && toolPathOf(part) === BRAND_FILE_PATH;

/** Guide mode shows only failures; reads, writes and saves stay behind Caetano's working line. */
const guideRowOf = (part: ToolPartView): boolean => part.state === "output-error";

/** The tool parts of an assistant message, in their loose view. */
function toolPartsOf(message: UIMessage): ToolPartView[] {
  return message.parts.flatMap((part): ToolPartView[] =>
    part.type === "dynamic-tool" || part.type.startsWith("tool-")
      ? [{ state: "output-available", ...part }]
      : [],
  );
}

const isInstagramRead = (part: ToolPartView): boolean =>
  toolNameOf(part).startsWith("read_instagram_");

/** The images Caetano saved as brand references in this turn, in order. */
function savedReferencesOf(parts: ToolPartView[]): { imageId: string }[] {
  const ids = parts.flatMap((part) => {
    if (toolNameOf(part) !== "reference_save" || part.state !== "output-available") return [];
    const parsed = toolDataOf(part);
    const saved = z.object({ imageId: z.string() }).safeParse(parsed.success ? parsed.data : null);

    return saved.success ? [saved.data.imageId] : [];
  });

  return [...new Set(ids)].map((imageId) => ({ imageId }));
}

interface GuideActivity {
  state: CaetanoState;
  label: string;
}

/** What Caetano is doing in a guide turn, from the tool that runs now (or ran last). */
function guideActivityOf(parts: ToolPartView[]): GuideActivity {
  const current = parts.findLast(isRunning) ?? parts.at(-1);
  const saved = savedReferencesOf(parts).length;

  if (current === undefined) return { state: "read", label: "lendo seu Instagram" };

  if (isBrandWrite(current)) return { state: "think", label: "escrevendo o guia da marca" };

  if (toolNameOf(current) === "reference_save") {
    return { state: "read", label: `guardando referências · ${saved}` };
  }

  if (toolNameOf(current) === "read_instagram_profile")
    return { state: "read", label: "lendo o perfil" };

  if (isInstagramRead(current)) return { state: "read", label: "lendo os posts" };

  return { state: "think", label: "pensando" };
}

/** Caetano at work in the guide: the full figure while he reads, beside what he is doing. */
function GuideWorking({ state, label }: { state: CaetanoState; label: string }) {
  return (
    <div role="status" className="flex items-end gap-3.5">
      <Caetano state={state} size={88} className="-mb-1.5" />
      <Marker className="mb-3">
        <MarkerContent tone="muted" loading>
          {label}…
        </MarkerContent>
      </Marker>
    </div>
  );
}

/** Caetano's name over his messages, with his head cropped from the same frames. */
function CaetanoName({ state, still }: { state: CaetanoState; still: boolean }) {
  return (
    <div className="flex items-center gap-2 text-body-sm text-text-3">
      <CaetanoHead state={state} size={28} still={still} />
      Caetano
    </div>
  );
}

/** The posts Caetano kept as layout references: one quiet line and a row of thumbnails. */
function GuideReferences({
  accountId,
  images,
}: {
  accountId: Id<"accounts">;
  images: { imageId: string }[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-body text-text-3">
        Guardei {images.length === 1 ? "1 post" : `${images.length} posts`} como referência de
        layout.
      </p>
      <div className="flex gap-1.5">
        {images.map((image) => (
          <ThreadImageThumb
            key={image.imageId}
            image={image}
            accountId={accountId}
            onOpen={() => setOpenId(image.imageId)}
          />
        ))}
      </div>
      <ThreadImageLightbox
        accountId={accountId}
        images={images}
        selectedId={openId}
        onSelect={setOpenId}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

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

/** Records the first send so the freshly created thread can show it while its history loads. */
export function handOffFirstSend(handoff: {
  threadId: string;
  text: string;
  attachments: ReadyImageAttachment[];
}) {
  firstSendHandoff = handoff;
}

/** The owner's message: its images, then the text in a muted bubble at the end edge. */
function UserMessage({
  text,
  attachments,
  focus = null,
  enter = false,
}: {
  text: string;
  attachments: ComponentProps<typeof MessageImageAttachments>["attachments"];
  focus?: string | null;
  enter?: boolean;
}) {
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
          <Bubble variant="muted" className="max-w-full sm:max-w-4/5">
            <BubbleContent className="whitespace-pre-wrap">
              <HexText text={text} />
            </BubbleContent>
          </Bubble>
        ) : null}
      </MessageContent>
    </Message>
  );
}

/** The user's just-sent message plus a thinking marker — the pre-history echo. */
export function PendingFirstMessage({
  text,
  attachments,
  guide = false,
}: {
  text: string;
  attachments: ReadyImageAttachment[];
  guide?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <UserMessage text={text} attachments={attachments} />
      <Message align="start">
        <MessageContent>
          {guide ? (
            <>
              <CaetanoName state="think" still={false} />
              <GuideWorking state="think" label="pensando" />
            </>
          ) : (
            <ThinkingMarker />
          )}
        </MessageContent>
      </Message>
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

/** A turn the platform started (the guide's first reading turn): never shown. */
function isPlatformMessage(message: UIMessage): boolean {
  if (message.role !== "user") return false;

  return isPlatformTurn(
    message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n"),
  );
}

export function NewConversationHero() {
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
        className="pointer-events-none absolute h-auto w-3/4 max-w-120 text-brand-accent opacity-5"
      />
      <h1 className="relative max-w-2xl text-2xl leading-tight font-medium tracking-tight text-text md:text-3xl">
        {firstName ? `No que a Vanda pode ajudar, ${firstName}?` : "No que a Vanda pode ajudar?"}
      </h1>
    </section>
  );
}

const VANDA_COMPOSER = {
  placeholder: "Mande uma mensagem para a Vanda…",
  ariaLabel: "Mensagem para a Vanda",
  agentName: "A Vanda",
};

export function Conversation({
  accountId,
  threadId,
  composer = VANDA_COMPOSER,
  actions,
  intro,
  guide = false,
}: {
  accountId: Id<"accounts">;
  threadId: string;
  composer?: {
    placeholder: string;
    ariaLabel: string;
    agentName: string;
    attachLabel?: string | undefined;
  };
  /** Quick replies shown just above the composer, aligned with the messages. */
  actions?: ReactNode;
  /** Shown above the first message. */
  intro?: ReactNode;
  /** The brand guide: Caetano's chat, where only his answers, his reading and the saved references show. */
  guide?: boolean;
}) {
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
      const imageIds = attachments.map((attachment) => attachment.imageId);

      await sendMessage({
        accountId,
        threadId,
        prompt,
        ...(imageIds.length > 0 && { imageIds }),
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

  const visibleMessages = messages.results.filter(
    (message) => !isDefaultWelcome(message) && !isPlatformMessage(message),
  );

  const empty = !loading && visibleMessages.length === 0;
  const streaming = visibleMessages.at(-1)?.status === "streaming";
  const working = processing || streaming;

  // Guide mode: only the newest assistant message carries Caetano's live pose.
  const lastMessage = visibleMessages.at(-1);
  const liveMessage = lastMessage?.role === "assistant" ? lastMessage : undefined;

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
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
              <div className="min-h-0 flex-1 overflow-hidden">
                <MessageScroller>
                  <MessageScrollerViewport>
                    <MessageScrollerContent
                      aria-busy={streaming}
                      className={cn(
                        "mx-auto w-full max-w-3xl gap-6 px-4 py-8 md:px-6",
                        guide && "justify-end",
                      )}
                    >
                      {loading ? (
                        handoff ? (
                          <PendingFirstMessage
                            text={handoff.text}
                            attachments={handoff.attachments}
                            guide={guide}
                          />
                        ) : (
                          <ConversationSkeleton />
                        )
                      ) : empty && !guide ? (
                        <MessageScrollerItem
                          messageId="new-conversation"
                          className="flex flex-1 items-center justify-center"
                        >
                          <NewConversationHero />
                        </MessageScrollerItem>
                      ) : (
                        <>
                          {intro ? (
                            <MessageScrollerItem messageId="intro">{intro}</MessageScrollerItem>
                          ) : null}
                          {visibleMessages.map((message, index) => (
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
                                guide={guide}
                                live={message === liveMessage && working}
                              />
                            </MessageScrollerItem>
                          ))}
                          {guide && working && lastMessage?.role !== "assistant" ? (
                            <MessageScrollerItem messageId="caetano-pending">
                              <Message align="start">
                                <MessageContent>
                                  <CaetanoName state="read" still={false} />
                                  {visibleMessages.length === 0 ? (
                                    <GuideWorking state="read" label="lendo seu Instagram" />
                                  ) : (
                                    <GuideWorking state="think" label="pensando" />
                                  )}
                                </MessageContent>
                              </Message>
                            </MessageScrollerItem>
                          ) : null}
                        </>
                      )}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton />
                </MessageScroller>
              </div>
            </MessageScrollerProvider>

            {actions ? (
              <div className="mx-auto w-full max-w-3xl px-4 md:px-6">{actions}</div>
            ) : null}

            <ImageMessageComposer
              accountId={accountId}
              draft={draft}
              onDraftChange={setDraft}
              onSend={send}
              placeholder={composer.placeholder}
              ariaLabel={composer.ariaLabel}
              agentName={composer.agentName}
              attachLabel={composer.attachLabel}
              working={working}
              onStop={() => void stopGeneration({ accountId, threadId })}
            />
          </div>
        </div>
      </div>
    </EntranceReadyContext.Provider>
  );
}

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

/** A standalone hex color: `#fff` or `#a6874b`, preceded by space, a bracket or line start. */
const HEX_TOKEN = /(^|[\s(])(#(?:[0-9a-f]{6}|[0-9a-f]{3}))\b/gi;

const HEX_ONLY = /^#(?:[0-9a-f]{3}){1,2}$/i;

/** Fenced blocks and inline code spans; odd indices of `split` are these. */
const CODE_SPAN = /(```[\s\S]*?```|`[^`\n]*`)/;

/** Wraps hex colors in inline code so Markdown hands them to InlineCode. Code and link targets stay as written. */
function markHexColors(text: string): string {
  return text
    .split(CODE_SPAN)
    .map((part, index) => {
      if (index % 2 === 1) return part;

      return part.replace(HEX_TOKEN, (match, lead: string, hex: string, offset: number) =>
        lead === "(" && part[offset - 1] === "]" ? match : `${lead}\`${hex}\``,
      );
    })
    .join("");
}

/** A small square of the color, drawn from the hex through a CSS variable. */
function HexSwatch({ hex }: { hex: string }) {
  return (
    <span
      // SAFETY: React accepts custom properties at runtime; CSSProperties omits their open-ended names. The value is a hex matched by HEX_ONLY or HEX_TOKEN.
      style={{ "--swatch": hex } as CSSProperties}
      className="mr-1 inline-block size-3.5 rounded-sm border border-border bg-(--swatch) align-middle"
    />
  );
}

/** Inline code that is only a hex color gets a swatch before the hex; other code is unchanged. */
function InlineCode({ children, className }: ComponentProps<"code">) {
  const text = String(children);

  if (!HEX_ONLY.test(text)) return <code className={className}>{children}</code>;

  return (
    <code className={className}>
      <HexSwatch hex={text} />
      {text}
    </code>
  );
}

const colorComponents = { code: InlineCode };

/** Plain (non-Markdown) text with a swatch before each standalone hex color. */
function HexText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(HEX_TOKEN)) {
    const [, lead = "", hex = ""] = match;
    const index = match.index ?? 0;
    const start = index + lead.length;

    if (lead === "(" && text[index - 1] === "]") continue;

    nodes.push(text.slice(last, start));
    nodes.push(
      <span key={start} className="whitespace-nowrap">
        <HexSwatch hex={hex} />
        {hex}
      </span>,
    );
    last = start + hex.length;
  }

  nodes.push(text.slice(last));

  return <>{nodes}</>;
}

function ChatMessage({
  message,
  accountId,
  resources,
  guide,
  live,
}: {
  message: UIMessage;
  accountId: Id<"accounts">;
  resources: ThreadResource[];
  guide: boolean;
  /** The guide's newest message while Caetano still works on it. */
  live?: boolean;
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

    const attachments = message.parts.flatMap((part) =>
      part.type === "file" && part.mediaType.startsWith("image/")
        ? [{ url: part.url, fileName: part.filename ?? "Imagem anexada" }]
        : [],
    );

    if (!text && attachments.length === 0) return null;

    return <UserMessage text={text} attachments={attachments} focus={focusOf(raw)} enter={enter} />;
  }

  const streaming = message.status === "streaming";

  // Classify the turn's parts. Reasoning is never rendered (no thinking traces).
  // Tool calls collapse into a single "Trabalhou" trace; answer text and
  // generated images stay visible. (Historical approval parts from the old
  // gated era render as plain tool rows.)
  const textAnswers = message.parts.flatMap((part, index) =>
    part.type === "text" && part.text.trim() ? [{ key: index, text: part.text }] : [],
  );

  // The guide shows only the turn's final text: earlier narration before tool calls is dropped.
  const answers = guide ? textAnswers.slice(-1) : textAnswers;

  const toolRows = toolPartsOf(message);
  const traceRows = guide ? toolRows.filter(guideRowOf) : toolRows;

  const paintedImages: PaintedImageView[] = [];

  for (const part of toolRows) {
    for (const image of [paintedImageOf(part), ...codeImagesOf(part)]) {
      if (image && !paintedImages.some((seen) => seen.imageId === image.imageId)) {
        paintedImages.push(image);
      }
    }
  }

  const nothingYet = streaming && answers.length === 0 && traceRows.length === 0;
  const savedReferences = guide ? savedReferencesOf(toolRows) : [];
  const activity = guideActivityOf(toolRows);
  // Caetano shows what he is doing until his answer starts.
  const guideWorking = guide && live === true && answers.length === 0;

  const manifestResources = resources.filter(
    (resource) =>
      (resource.kind !== "image" ||
        !paintedImages.some((image) => image.imageId === resource.imageId)) &&
      !(guide && resource.kind === "document" && resource.path === BRAND_FILE_PATH),
  );

  return (
    <Message align="start" enter={enter}>
      <MessageContent>
        {guide ? (
          <CaetanoName state={guideWorking ? activity.state : "idle"} still={live !== true} />
        ) : null}
        {guideWorking ? <GuideWorking state={activity.state} label={activity.label} /> : null}
        {savedReferences.length > 0 ? (
          <GuideReferences accountId={accountId} images={savedReferences} />
        ) : null}
        {!guide && toolRows.length > 0 ? (
          <ToolTrace parts={toolRows} running={toolRows.some(isRunning)} />
        ) : null}
        {answers.map(({ key, text }) => (
          <Bubble key={key} variant="ghost">
            <BubbleContent>
              <StreamingText text={text} streaming={streaming} />
            </BubbleContent>
          </Bubble>
        ))}
        {guide ? <GuideTrace parts={traceRows} /> : null}
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
        {nothingYet && !guide ? <ThinkingMarker /> : null}
      </MessageContent>
    </Message>
  );
}

/** Assistant text with smooth streaming: reveals chunked deltas at a steady pace
 *  while live, shows full text instantly for completed / historical messages. */
function StreamingText({ text, streaming }: { text: string; streaming: boolean }) {
  const [visible] = useSmoothText(text, { charsPerSec: 900, startStreaming: streaming });

  return <Markdown components={colorComponents}>{markHexColors(visible)}</Markdown>;
}

/** Guide mode: only failed tools keep a row; the rest is Caetano's working line. */
function GuideTrace({ parts }: { parts: ToolPartView[] }) {
  if (parts.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {parts.map((part) => (
        <ToolRow key={part.toolCallId ?? part.type} part={part} />
      ))}
    </div>
  );
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
  const running = isRunning(part);
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
  const running = isRunning(part);
  const failed = part.state === "output-error";
  const view = codeRunViewOf(part);
  const errored = failed || view.ok === false;
  const label = view.description.trim() || TOOL_LABEL.run_code;

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
