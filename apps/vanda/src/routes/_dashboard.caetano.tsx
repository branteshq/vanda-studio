import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  optimisticallySendMessage,
  useSmoothText,
  useUIMessages,
  type UIMessage,
} from "@convex-dev/agent/react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { ArrowUp, Square } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import { Bubble, BubbleContent } from "@vanda-studio/ui/components/bubble";
import { Button } from "@vanda-studio/ui/components/button";
import { Markdown } from "@vanda-studio/ui/components/markdown";
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
import { resourcesForMessage, ThreadResourceList } from "../components/thread-resources";
import { api } from "../convex/_generated/api";

export const Route = createFileRoute("/_dashboard/caetano")({ component: CaetanoPage });

interface ToolPart {
  type: string;
  toolName?: string;
  toolCallId?: string;
  state: string;
}

const TOOL_LABELS: Record<string, string> = {
  list_accounts: "Conferindo seus negócios",
  select_account: "Trocando o negócio ativo",
  account_status: "Conferindo a conta",
  usage_status: "Consultando seu uso",
  model_preferences: "Conferindo os modelos",
  set_model_preferences: "Atualizando os modelos",
  list_vanda_threads: "Procurando conversas da Vanda",
  ask_vanda: "Vanda está trabalhando",
};

const toolName = (part: ToolPart): string =>
  part.type === "dynamic-tool" ? (part.toolName ?? "tool") : part.type.slice("tool-".length);

const runningTool = (part: ToolPart): boolean =>
  part.state === "input-streaming" || part.state === "input-available";

function CaetanoPage() {
  const state = useQuery(api.caetano.state, {});
  const sendMessage = useMutation(api.caetano.sendMessage);
  const [pending, setPending] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || state?.processing) return;
    setDraft("");
    setPending(prompt);
    setError(null);
    try {
      await sendMessage({ ...(state?.threadId ? { threadId: state.threadId } : {}), prompt });
    } catch (cause) {
      setDraft(prompt);
      setError(cause instanceof Error ? cause.message : "Não consegui enviar agora.");
    } finally {
      setPending(null);
    }
  };

  if (state === undefined) return <CaetanoSkeleton />;
  if (!state.threadId) {
    return (
      <CaetanoFrame>
        <div className="flex min-h-0 flex-1 items-center justify-center px-5">
          <CaetanoWelcome />
        </div>
        {pending ? (
          <div className="mx-auto w-full max-w-3xl px-4 pb-3 text-right text-sm text-text-3">
            Enviando…
          </div>
        ) : null}
        <CaetanoComposer
          draft={draft}
          onDraftChange={setDraft}
          onSend={send}
          working={pending !== null}
          error={error}
        />
      </CaetanoFrame>
    );
  }
  return <CaetanoConversation threadId={state.threadId} processing={state.processing} />;
}

function CaetanoConversation({ threadId, processing }: { threadId: string; processing: boolean }) {
  const sendMessage = useMutation(api.caetano.sendMessage).withOptimisticUpdate((store, args) => {
    if (!args.threadId || !args.prompt.trim()) return;
    optimisticallySendMessage(api.caetano.listMessages)(store, {
      threadId: args.threadId,
      prompt: args.prompt,
    });
  });
  const stop = useMutation(api.caetano.stopGeneration);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const messages = useUIMessages(
    api.caetano.listMessages,
    { threadId },
    { initialNumItems: 80, stream: true },
  );
  const resourceManifests = useQuery(api.threadResources.listForCaetano, { threadId });
  const loading = messages.status === "LoadingFirstPage";
  const streaming = messages.results.at(-1)?.status === "streaming";

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || processing || streaming) return;
    setDraft("");
    setError(null);
    try {
      await sendMessage({ threadId, prompt });
    } catch (cause) {
      setDraft(prompt);
      setError(cause instanceof Error ? cause.message : "Não consegui enviar agora.");
    }
  };

  return (
    <CaetanoFrame>
      <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
        <div className="min-h-0 flex-1 overflow-hidden">
          <MessageScroller>
            <MessageScrollerViewport>
              <MessageScrollerContent
                aria-busy={streaming}
                className="mx-auto w-full max-w-3xl gap-6 px-4 py-8 md:px-6"
              >
                {loading ? (
                  <CaetanoMessagesSkeleton />
                ) : messages.results.length === 0 ? (
                  <MessageScrollerItem messageId="caetano-welcome">
                    <CaetanoWelcome />
                  </MessageScrollerItem>
                ) : (
                  messages.results.map((message, index) => (
                    <MessageScrollerItem
                      key={message.key}
                      messageId={message.key}
                      scrollAnchor={message.role === "user"}
                    >
                      <CaetanoMessage
                        message={message}
                        resources={resourcesForMessage(
                          messages.results,
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
      <CaetanoComposer
        draft={draft}
        onDraftChange={setDraft}
        onSend={send}
        working={processing || streaming}
        onStop={() => void stop({ threadId })}
        error={error}
      />
    </CaetanoFrame>
  );
}

function CaetanoFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-center border-b border-border/60 px-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-1">
          <span className="flex size-7 items-center justify-center rounded-full bg-brand-accent/12 text-base">
            🐒
          </span>
          Caetano
        </div>
      </header>
      {children}
    </div>
  );
}

function CaetanoWelcome() {
  return (
    <div className="mx-auto max-w-xl text-center">
      <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-border bg-surface-2 text-4xl shadow-sm">
        🐒
      </div>
      <h1 className="text-2xl font-semibold tracking-tight text-text-1">Fala com o Caetano</h1>
      <p className="mt-2 text-sm leading-6 text-text-3">
        Ele conhece o Vanda Studio, cuida das configurações e chama a Vanda quando tem trabalho de
        marketing para fazer.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-text-3">
        {[
          "Prepare um post para amanhã",
          "Quanto do plano eu usei?",
          "Troque meu modelo de imagem",
        ].map((suggestion) => (
          <span
            key={suggestion}
            className="rounded-full border border-border bg-surface-1 px-3 py-1.5"
          >
            {suggestion}
          </span>
        ))}
      </div>
    </div>
  );
}

function CaetanoMessage({
  message,
  resources,
}: {
  message: UIMessage;
  resources: Parameters<typeof ThreadResourceList>[0]["resources"];
}) {
  const textParts = message.parts.flatMap((part) =>
    part.type === "text" && (part as { text: string }).text.trim()
      ? [(part as { text: string }).text]
      : [],
  );
  if (message.role === "user") {
    if (textParts.length === 0) return null;
    return (
      <Message align="end" className="animate-message-in">
        <MessageContent>
          <Bubble variant="muted">
            <BubbleContent className="whitespace-pre-wrap">{textParts.join("\n")}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  const tools = message.parts.filter(
    (part) => part.type === "dynamic-tool" || part.type.startsWith("tool-"),
  ) as unknown as ToolPart[];
  const streaming = message.status === "streaming";
  const nothingYet = streaming && textParts.length === 0 && tools.length === 0;
  return (
    <Message align="start" className="animate-message-in">
      <MessageContent>
        {tools.length > 0 ? (
          <div className="space-y-1.5 py-1 text-xs text-text-3">
            {tools.map((part) => {
              const name = toolName(part);
              return (
                <div
                  key={part.toolCallId ?? `${name}-${part.state}`}
                  className="flex items-center gap-2"
                >
                  {runningTool(part) ? (
                    <ThinkingOrb state="working" size={20} style={{ width: 16, height: 16 }} />
                  ) : (
                    <span className="flex size-4 items-center justify-center text-[10px] text-positive">
                      ✓
                    </span>
                  )}
                  <span>{TOOL_LABELS[name] ?? "Trabalhando"}</span>
                </div>
              );
            })}
          </div>
        ) : null}
        {textParts.map((text) => (
          <Bubble key={`${text.length}-${text.slice(0, 48)}`} variant="ghost">
            <BubbleContent>
              <CaetanoStreamingText text={text} streaming={streaming} />
            </BubbleContent>
          </Bubble>
        ))}
        <ThreadResourceList resources={resources} />
        {nothingYet ? (
          <div className="flex items-center gap-2 text-sm text-text-3">
            <ThinkingOrb state="breathing" size={20} style={{ width: 18, height: 18 }} />
            <span className="shimmer">Pensando…</span>
          </div>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function CaetanoStreamingText({ text, streaming }: { text: string; streaming: boolean }) {
  const [visible] = useSmoothText(text, { charsPerSec: 900, startStreaming: streaming });
  return <Markdown>{visible}</Markdown>;
}

function CaetanoComposer({
  draft,
  onDraftChange,
  onSend,
  working,
  onStop,
  error,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => Promise<void>;
  working: boolean;
  onStop?: (() => void) | undefined;
  error: string | null;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [draft]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSend();
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!working) void onSend();
    }
  };

  return (
    <div className="shrink-0 px-3 pb-4 md:px-6 md:pb-6">
      <form
        onSubmit={submit}
        className={cn(
          "mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-border bg-surface-1 p-2 shadow-sm transition-shadow focus-within:shadow-md",
          error && "border-danger/50",
        )}
      >
        <textarea
          ref={textarea}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={keyDown}
          rows={1}
          placeholder="Fala com o Caetano…"
          aria-label="Mensagem para o Caetano"
          className="max-h-[180px] min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-text-1 outline-none placeholder:text-text-3"
        />
        {working && onStop ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label="Interromper"
            onClick={onStop}
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label="Enviar" disabled={!draft.trim() || working}>
            <ArrowUp className="size-4" />
          </Button>
        )}
      </form>
      {error ? <p className="mx-auto mt-2 max-w-3xl px-2 text-xs text-danger">{error}</p> : null}
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-text-3">
        Caetano pode errar. Confira publicações e configurações importantes.
      </p>
    </div>
  );
}

function CaetanoMessagesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Skeleton className="h-12 w-52 rounded-2xl" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-20 w-4/5 rounded-2xl" />
      </div>
    </div>
  );
}

function CaetanoSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Skeleton className="h-14 w-full rounded-none" />
      <div className="flex flex-1 items-center justify-center">
        <Skeleton className="size-16 rounded-2xl" />
      </div>
    </div>
  );
}
