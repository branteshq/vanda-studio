import { useEffect, useState, type ReactNode } from "react";
import { optimisticallySendMessage, useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { X } from "lucide-react";
import { Bubble, BubbleContent } from "@vanda-studio/ui/components/bubble";
import { Button } from "@vanda-studio/ui/components/button";
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
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ChatMessage, ThinkingMarker } from "../chat/chat-message";
import { ImageMessageComposer, type ReadyImageAttachment } from "../image-message-composer";
import { EntranceReadyContext } from "../thread-entrance";
import { resourcesForMessage } from "../thread-resources";
import { groupWork, WorkGroup } from "./work-group";

/**
 * Caetano in the app: the same thread as his WhatsApp (one conversation across
 * channels). Everything on the Posts automáticos page that changes something
 * goes through here as a message — Caetano acts with his tools and settings.
 */

/** A post (or one slide of it) the owner is talking about: the chat stays on it. */
export interface PostFocus {
  readonly slotId: string;
  /** "Quarta 19h · “3 passos contra fraude”" */
  readonly label: string;
  /** 1-based slide, when the owner picked one image of a carousel. */
  readonly slide?: number | undefined;
  readonly slideCount: number;
  readonly imageUrl?: string | null | undefined;
}

/** The hidden marker Caetano reads ("foco slotId=…") and the chat renders as a chip. */
export const focusRef = (focus: PostFocus): string =>
  ` <caetano_ref>foco slotId=${focus.slotId}${
    focus.slide ? ` slide=${focus.slide}/${focus.slideCount}` : ""
  } rótulo="${focus.label.replaceAll('"', "'")}"</caetano_ref>`;

export interface CaetanoConversation {
  readonly threadId: string | null;
  readonly accountId: Id<"accounts"> | null;
  readonly draft: string;
  readonly setDraft: (draft: string) => void;
  /** Sends a message to Caetano; resolves once it is queued. */
  readonly send: (
    text: string,
    attachments?: ReadyImageAttachment[],
    withFocus?: PostFocus | null,
  ) => Promise<void>;
  readonly busy: boolean;
  /** Caetano is doing posts automáticos work (folded in the chat); the composer stays free. */
  readonly working: boolean;
  readonly stop: () => void;
  readonly focus: PostFocus | null;
  readonly setFocus: (focus: PostFocus | null) => void;
}

export function useCaetanoConversation(): CaetanoConversation {
  const state = useQuery(api.caetano.state, {});
  const threadId = state?.threadId ?? null;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [focus, setFocus] = useState<PostFocus | null>(null);

  // Optimistic once the thread exists; the first message creates it server-side.
  const sendMessage = useMutation(api.caetano.sendMessage).withOptimisticUpdate((store, args) => {
    if (!args.threadId || !args.prompt.trim()) return;
    optimisticallySendMessage(api.caetano.listMessages)(store, {
      threadId: args.threadId,
      prompt: args.prompt,
    });
  });

  const stopGeneration = useMutation(api.caetano.stopGeneration);

  const send = async (
    text: string,
    attachments: ReadyImageAttachment[] = [],
    withFocus: PostFocus | null = focus,
  ) => {
    const prompt = text.trim();

    if (!prompt && attachments.length === 0) return;
    setDraft("");
    setSending(true);

    try {
      // While a post is in focus every message carries it, so Caetano stays on that post.
      const request: Parameters<typeof sendMessage>[0] = {
        prompt: withFocus ? `${prompt}${focusRef(withFocus)}` : prompt,
      };

      if (threadId) request.threadId = threadId;

      if (attachments.length > 0) request.imageIds = attachments.map((item) => item.imageId);

      await sendMessage(request);
    } catch (error) {
      setDraft(prompt);
      throw error;
    } finally {
      setSending(false);
    }
  };

  return {
    threadId,
    accountId: state?.activeAccountId ?? null,
    draft,
    setDraft,
    send,
    busy: sending || (state?.processing ?? false),
    working: state?.working ?? false,
    stop: () => {
      if (threadId) void stopGeneration({ threadId });
    },
    focus,
    setFocus,
  };
}

/** A one-line opener shown on an empty thread; nothing is saved. */
function Welcome({ children }: { children: ReactNode }) {
  return (
    <Message align="start" enter>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent>{children}</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

/** "Falando sobre …": the post the chat is locked on, until the owner clears it. */
function FocusPill({ focus, onClear }: { focus: PostFocus; onClear: () => void }) {
  return (
    <div className="px-4 pb-2 md:px-6">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2 rounded-lg border border-brand-accent/40 bg-creating-bg p-1.5 pr-1">
        {focus.imageUrl ? (
          <img src={focus.imageUrl} alt="" className="aspect-4/5 w-8 rounded-sm object-cover" />
        ) : null}
        <span className="grid min-w-0 flex-1">
          <span className="text-micro font-medium text-brand-accent">Falando sobre</span>
          <span className="truncate text-note text-text">
            {focus.label}
            {focus.slide ? ` · imagem ${focus.slide}/${focus.slideCount}` : ""}
          </span>
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="Sair do foco" onClick={onClear}>
          <X />
        </Button>
      </div>
    </div>
  );
}

export function CaetanoChat({
  conversation,
  welcome,
  replies,
  pinned,
  className,
}: {
  conversation: CaetanoConversation;
  welcome: string;
  /** Guided replies above the composer (see guided-replies.tsx). */
  replies?: ReactNode;
  /** Caetano's live planning, pinned above the conversation: the source of truth. */
  pinned?: ReactNode;
  className?: string;
}) {
  const { threadId, accountId } = conversation;

  const messages = useUIMessages(api.caetano.listMessages, threadId ? { threadId } : "skip", {
    initialNumItems: 60,
    stream: true,
  });

  const manifests = useQuery(api.threadResources.listForCaetano, threadId ? { threadId } : "skip");
  const loading = threadId !== null && messages.status === "LoadingFirstPage";
  const visible = messages.results;
  const streaming = visible.at(-1)?.status === "streaming";
  const waitingFirstToken = conversation.busy && !streaming && visible.at(-1)?.role === "user";

  const renderMessage = (message: UIMessage, index: number) =>
    accountId ? (
      <ChatMessage
        key={message.key}
        message={message}
        accountId={accountId}
        resources={resourcesForMessage(visible, index, manifests ?? [])}
      />
    ) : null;

  // Entrance animations start one frame after the first history paint.
  const [entranceReady, setEntranceReady] = useState(false);

  useEffect(() => {
    if (loading || entranceReady) return;

    const id = requestAnimationFrame(() => setEntranceReady(true));

    return () => cancelAnimationFrame(id);
  }, [loading, entranceReady]);

  return (
    <EntranceReadyContext.Provider value={entranceReady}>
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
        {pinned}
        <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
          {/* A floor for the conversation: the pinned card above gives way first. */}
          <div className="min-h-64 flex-1 overflow-hidden">
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent
                  aria-busy={streaming}
                  className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 md:px-6"
                >
                  {loading ? (
                    <div className="space-y-3" aria-hidden>
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  ) : visible.length === 0 ? (
                    <MessageScrollerItem messageId="caetano-welcome">
                      <Welcome>{welcome}</Welcome>
                    </MessageScrollerItem>
                  ) : (
                    groupWork(visible, conversation.working).map((item) =>
                      item.kind === "message" ? (
                        <MessageScrollerItem
                          key={item.message.key}
                          messageId={item.message.key}
                          scrollAnchor={item.message.role === "user"}
                        >
                          {renderMessage(item.message, item.index)}
                        </MessageScrollerItem>
                      ) : (
                        <MessageScrollerItem key={item.key} messageId={item.key}>
                          <WorkGroup tasks={item.tasks}>
                            {() =>
                              item.entries.map((entry) => renderMessage(entry.message, entry.index))
                            }
                          </WorkGroup>
                        </MessageScrollerItem>
                      ),
                    )
                  )}
                  {waitingFirstToken ? (
                    <MessageScrollerItem messageId="caetano-thinking">
                      <ThinkingMarker />
                    </MessageScrollerItem>
                  ) : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </div>
        </MessageScrollerProvider>

        {conversation.focus ? (
          <FocusPill focus={conversation.focus} onClear={() => conversation.setFocus(null)} />
        ) : null}
        {replies}

        <ImageMessageComposer
          accountId={accountId}
          draft={conversation.draft}
          onDraftChange={conversation.setDraft}
          onSend={conversation.send}
          placeholder="Fale com o Caetano…"
          ariaLabel="Mensagem para o Caetano"
          agentName="O Caetano"
          working={conversation.busy || streaming}
          onStop={conversation.stop}
        />
      </div>
    </EntranceReadyContext.Provider>
  );
}
