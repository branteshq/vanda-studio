import { useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { optimisticallySendMessage, useUIMessages, type UIMessage } from "@convex-dev/agent/react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { z } from "zod";
import { Bubble, BubbleContent } from "@vanda-studio/ui/components/bubble";
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
import { ChatMessage, ThinkingMarker } from "../components/chat/chat-message";
import {
  ImageMessageComposer,
  MessageImageAttachments,
  type ReadyImageAttachment,
} from "../components/image-message-composer";
import { EntranceReadyContext } from "../components/thread-entrance";
import { resourcesForMessage } from "../components/thread-resources";
import { VandaMark } from "../components/vanda-mark";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export const Route = createFileRoute("/_dashboard/conversa")({
  component: ConversaPage,
  validateSearch: z.object({ t: z.string().min(1).optional() }),
});

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
        className="pointer-events-none absolute h-auto w-3/4 max-w-120 text-brand-accent opacity-5"
      />
      <h1 className="relative max-w-2xl text-2xl leading-tight font-medium tracking-tight text-text md:text-3xl">
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
