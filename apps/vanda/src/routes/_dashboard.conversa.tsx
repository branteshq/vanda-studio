import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { z } from "zod";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import {
  ImageMessageComposer,
  type ReadyImageAttachment,
} from "../components/image-message-composer";
import {
  Conversation,
  NewConversationHero,
  PendingFirstMessage,
  handOffFirstSend,
} from "../components/conversation";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export const Route = createFileRoute("/_dashboard/conversa")({
  component: ConversaPage,
  validateSearch: z.object({ t: z.string().min(1).optional() }),
});

function ConversaPage() {
  const { activeAccount } = useActiveAccount();
  const { t } = Route.useSearch();

  if (!activeAccount) return null;

  // The brand guide only fills marca.md during onboarding, so it never opens here.
  if (t === activeAccount.brandGuideThreadId) {
    return <Navigate to="/onboarding" search={{ accountId: activeAccount.id }} />;
  }

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

      handOffFirstSend({ threadId, text: prompt, attachments });
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
