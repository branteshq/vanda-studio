import { useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { optimisticallySendMessage } from "@convex-dev/agent/react";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

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

/**
 * Carousel project review, living inside the global right rail (the frame —
 * header, back navigation, width — belongs to the rail). Slide viewer with
 * per-slide revision requests, caption, editorial review, and the approve /
 * re-render / archive actions. Revision requests ride the chat, so the
 * affordance only exists when the rail was opened from a conversation.
 */
export function ProjectReview({
  projectId,
  accountId,
  threadId,
  onClose,
}: {
  projectId: Id<"contentProjects">;
  accountId: Id<"accounts">;
  threadId?: string | undefined;
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
    if (!slide || !text || threadId === undefined) return;
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {data === undefined ? (
          <div className="space-y-4">
            <Skeleton className="mx-auto aspect-[4/5] w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : !project ? (
          <p className="text-sm text-text-4">Projeto não encontrado.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
                {project.title ?? "Carrossel"}
              </h3>
              {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
            </div>

            <div className="relative mx-auto aspect-[4/5] w-full overflow-hidden rounded-xl border border-border bg-inset">
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
                  <ActionTooltip key={`slide-${index}`} label={`Slide ${index + 1}`} side="top">
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
                  {threadId !== undefined ? (
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
                  ) : null}
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
    </div>
  );
}
