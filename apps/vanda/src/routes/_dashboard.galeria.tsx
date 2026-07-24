import { useDeferredValue, useEffect, useState, type ComponentType, type MouseEvent } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Archive,
  CircleDashed,
  FileText,
  Film,
  Grid2X2,
  ImageIcon,
  Images,
  Layers3,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { Button, buttonVariants } from "@vanda-studio/ui/components/button";
import { card } from "@vanda-studio/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@vanda-studio/ui/components/dropdown-menu";
import { Input } from "@vanda-studio/ui/components/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@vanda-studio/ui/components/sheet";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import { VandaMark } from "../components/vanda-mark";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export const Route = createFileRoute("/_dashboard/galeria")({
  component: GaleriaPage,
});

type GalleryItems = FunctionReturnType<typeof api.contentStudio.gallery>;
type GalleryItem = GalleryItems[number];
type GalleryKind = "post" | "image" | "reel" | "story" | "tweet";
type GalleryStatus =
  | "planning"
  | "draft"
  | "blocked"
  | "ready_for_render"
  | "rendering"
  | "ready"
  | "scheduled"
  | "published"
  | "failed"
  | "archived";

type StatusTone = "neutral" | "creating" | "needs" | "scheduled" | "done";

const STATUS_META: Record<string, { readonly label: string; readonly tone: StatusTone }> = {
  planning: { label: "Planejando", tone: "creating" },
  draft: { label: "Rascunho", tone: "neutral" },
  blocked: { label: "Precisa de você", tone: "needs" },
  ready_for_render: { label: "Pronto para renderizar", tone: "creating" },
  rendering: { label: "Renderizando", tone: "creating" },
  ready: { label: "Pronto", tone: "done" },
  scheduled: { label: "Agendado", tone: "scheduled" },
  published: { label: "Publicado", tone: "done" },
  failed: { label: "Falhou", tone: "needs" },
  archived: { label: "Arquivado", tone: "neutral" },
};

const KIND_META: Record<
  GalleryKind,
  {
    readonly label: string;
    readonly plural: string;
    readonly icon: ComponentType<{ className?: string }>;
  }
> = {
  post: { label: "Post", plural: "Posts", icon: Images },
  image: { label: "Imagem", plural: "Imagens", icon: ImageIcon },
  reel: { label: "Reel", plural: "Reels", icon: Film },
  story: { label: "Story", plural: "Stories", icon: CircleDashed },
  tweet: { label: "Tweet", plural: "Tweets", icon: MessageSquareText },
};

const FILTERS: ReadonlyArray<{
  readonly kind: GalleryKind | null;
  readonly label: string;
  readonly countKey?: GalleryKind;
}> = [
  { kind: null, label: "Tudo" },
  { kind: "post", label: "Posts", countKey: "post" },
  { kind: "image", label: "Imagens", countKey: "image" },
  { kind: "reel", label: "Reels", countKey: "reel" },
  { kind: "story", label: "Stories", countKey: "story" },
  { kind: "tweet", label: "Tweets", countKey: "tweet" },
];

const STATUS_FILTERS: ReadonlyArray<{
  readonly value: GalleryStatus | null;
  readonly label: string;
}> = [
  { value: null, label: "Todos os status" },
  { value: "draft", label: "Rascunhos" },
  { value: "blocked", label: "Precisam de você" },
  { value: "ready_for_render", label: "Prontos para renderizar" },
  { value: "rendering", label: "Renderizando" },
  { value: "ready", label: "Prontos" },
  { value: "scheduled", label: "Agendados" },
  { value: "published", label: "Publicados" },
  { value: "failed", label: "Com falha" },
];

function GaleriaPage() {
  const { activeAccount } = useActiveAccount();
  const [kind, setKind] = useState<GalleryKind | null>(null);
  const [status, setStatus] = useState<GalleryStatus | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<GalleryItem | null>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const summary = useQuery(
    api.contentStudio.gallerySummary,
    activeAccount ? { accountId: activeAccount.id } : "skip",
  );
  const items = useQuery(
    api.contentStudio.gallery,
    activeAccount
      ? {
          accountId: activeAccount.id,
          ...(kind ? { kind } : {}),
          ...(status ? { status } : {}),
          ...(deferredSearch ? { search: deferredSearch } : {}),
        }
      : "skip",
  );

  useEffect(() => {
    setKind(null);
    setStatus(null);
    setSearch("");
    setSelected(null);
  }, [activeAccount?.id]);

  if (!activeAccount) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border bg-app px-5 pt-5 md:px-6 md:pt-6">
        <div className="mx-auto w-full max-w-[1500px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight text-text">Galeria</h1>
              <p className="mt-1 text-sm text-text-4">
                {summary === undefined
                  ? "Carregando sua biblioteca…"
                  : summary.total === 1
                    ? "1 item na sua biblioteca"
                    : `${summary.total} itens na sua biblioteca`}
              </p>
            </div>

            <div className="flex items-center gap-2 sm:w-auto">
              <label className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-5" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar na galeria…"
                  aria-label="Buscar na galeria"
                  className="h-9 rounded-lg bg-surface pr-3 pl-9"
                />
              </label>
              <Link to="/automatico" className={buttonVariants({ size: "lg" })}>
                <Plus />
                Criar
              </Link>
            </div>
          </div>

          <div className="mt-5 flex items-end gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <nav
              className="flex min-w-max flex-1 items-center gap-1"
              aria-label="Tipos de conteúdo"
            >
              {FILTERS.map((filter) => {
                const active = filter.kind === kind;
                const count =
                  filter.countKey === undefined ? summary?.total : summary?.counts[filter.countKey];
                return (
                  <button
                    key={filter.label}
                    type="button"
                    onClick={() => setKind(filter.kind)}
                    aria-pressed={active}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-none transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.97]",
                      active
                        ? "bg-text text-surface"
                        : "text-text-3 hover:bg-accent hover:text-text",
                    )}
                  >
                    {filter.label}
                    {count !== undefined ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none",
                          active ? "bg-surface/15 text-surface" : "bg-inset text-text-4",
                        )}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant={status ? "soft" : "ghost"}
                    size="sm"
                    className="mb-1 shrink-0"
                    aria-label="Filtrar por status"
                  />
                }
              >
                <SlidersHorizontal />
                {status ? STATUS_META[status]?.label : "Status"}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {STATUS_FILTERS.map((filter) => (
                  <DropdownMenuItem
                    key={filter.label}
                    onClick={() => setStatus(filter.value)}
                    className={cn(filter.value === status && "bg-accent text-text")}
                  >
                    {filter.label}
                    {filter.value === status ? (
                      <span className="ml-auto size-1.5 rounded-full bg-brand-accent" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1500px] p-5 md:p-6">
          {items === undefined ? (
            <GallerySkeleton />
          ) : items.length === 0 ? (
            <EmptyGallery
              filtered={kind !== null || status !== null || deferredSearch.length > 0}
            />
          ) : (
            <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
              {items.map((item) => (
                <GalleryCard
                  key={`${item.entity}:${item.id}`}
                  item={item}
                  onOpen={() => setSelected(item)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      <GalleryInspector item={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}

function GalleryCard({ item, onOpen }: { item: GalleryItem; onOpen: () => void }) {
  const kind = item.kind as GalleryKind;
  const meta = KIND_META[kind] ?? KIND_META.post;
  const Icon = meta.icon;
  const status = STATUS_META[item.status];
  const compact = kind === "tweet";

  return (
    <article
      className={card({
        className:
          "mb-4 inline-block w-full break-inside-avoid overflow-hidden rounded-xl shadow-sm transition-[border-color,transform] duration-150 ease-[var(--ease-out)] hover:border-border-strong",
      })}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group relative block w-full overflow-hidden bg-inset text-left outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/40 active:scale-[0.995]",
          compact ? "min-h-36" : kind === "image" ? "aspect-square" : "aspect-[4/5]",
        )}
      >
        <PreviewFallback kind={kind} />
        {item.previewUrl ? (
          <img
            src={item.previewUrl}
            alt=""
            className="absolute inset-0 size-full object-cover transition-transform duration-200 ease-[var(--ease-out)] group-hover:scale-[1.01]"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        ) : null}
        {compact ? (
          <p className="relative z-10 px-5 pt-16 pb-5 text-[15px] leading-relaxed text-text">
            {item.title}
          </p>
        ) : null}

        <span className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 rounded-md bg-surface/90 px-2 py-1 text-[11px] font-medium text-text shadow-sm backdrop-blur-sm">
          <Icon className="size-3" />
          {meta.label}
        </span>
        {item.itemCount > 1 ? (
          <span className="absolute top-3 right-3 z-20 inline-flex items-center gap-1 rounded-md bg-surface/90 px-2 py-1 font-mono text-[11px] text-text shadow-sm backdrop-blur-sm">
            <Layers3 className="size-3" />
            {item.itemCount}
          </span>
        ) : null}
      </button>

      <div className="flex items-start gap-2 border-t border-border px-3.5 py-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left outline-none">
          <h2 className="truncate text-sm font-semibold text-text">{item.title}</h2>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-text-4">
            {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
            <span className="truncate">{formatDate(item.updatedAt)}</span>
          </div>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`Ações de ${item.title}`} />}
            onClick={(event: MouseEvent) => event.stopPropagation()}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={onOpen}>
              <Pencil />
              {item.entity === "content_project" ? "Abrir projeto" : "Ver detalhes"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

function PreviewFallback({ kind }: { kind: GalleryKind }) {
  const meta = KIND_META[kind] ?? KIND_META.post;
  const Icon = meta.icon;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-inset">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-surface text-text-5 shadow-sm">
        <Icon className="size-6" />
      </div>
      <span className="absolute top-1/4 left-1/4 size-20 rounded-full border border-border opacity-60" />
      <span className="absolute right-1/4 bottom-1/4 size-10 rounded-lg border border-border opacity-60" />
    </div>
  );
}

function GalleryInspector({
  item,
  onOpenChange,
}: {
  item: GalleryItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const projectId =
    item?.entity === "content_project" ? (item.entityId as Id<"contentProjects">) : null;
  const data = useQuery(api.contentStudio.project, projectId ? { projectId } : "skip");
  const reviewDraft = useAction(api.contentStudioNode.reviewDraft);
  const regenerateSlide = useAction(api.contentStudioNode.regenerateSlide);
  const retryPlanning = useAction(api.contentStudioActions.createFromBrief);
  const archiveProject = useMutation(api.contentStudio.archiveProject);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    setBusy(null);
    setError(null);
    setRegenerating(null);
    setInstruction("");
  }, [item?.id]);

  if (!item) return null;

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

  const project = data?.project;
  const document = data?.document;
  const status = project ? STATUS_META[project.status] : STATUS_META[item.status];
  const previewUrl = data?.coverUrl ?? item.previewUrl;
  const canReview = document?.reviewStatus === "pending";
  const canRetry = project?.status === "failed" && project.creativeBriefId !== undefined;

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(92vw,36rem)] gap-0 sm:max-w-xl" showCloseButton>
        <SheetHeader className="border-b border-border px-5 py-4 pr-12">
          <div className="flex items-center gap-2">
            <SheetTitle className="truncate">{item.title}</SheetTitle>
            {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
          </div>
          <SheetDescription>
            {item.entity === "content_project"
              ? `${item.itemCount} slides · versão ${project?.latestVersion ?? "—"}`
              : `${KIND_META[item.kind as GalleryKind]?.label ?? "Conteúdo"} · ${formatDate(item.updatedAt)}`}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {item.entity === "content_project" && data === undefined ? (
            <InspectorSkeleton />
          ) : (
            <div className="space-y-5 p-5">
              <div className="relative mx-auto aspect-[4/5] w-full max-w-72 overflow-hidden rounded-xl border border-border bg-inset">
                <PreviewFallback kind={item.kind as GalleryKind} />
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-x-6 bottom-7 rounded-lg border border-border bg-surface/90 p-4 shadow-sm backdrop-blur-sm">
                    <p className="text-xs font-medium text-text-4">Capa planejada</p>
                    <p className="mt-1 text-base font-semibold leading-snug text-text">
                      {document?.slides[0]?.headline ?? item.title}
                    </p>
                  </div>
                )}
              </div>

              {document ? (
                <>
                  <section>
                    <div className="mb-2.5 flex items-center gap-2">
                      <FileText className="size-4 text-text-4" />
                      <h3 className="text-sm font-semibold text-text">Slides</h3>
                      <span className="text-xs text-text-5">{document.slides.length}</span>
                    </div>
                    <div className="space-y-2">
                      {document.slides.map((slide) => (
                        <div
                          key={slide.slideId}
                          className="rounded-lg border border-border bg-surface p-3"
                        >
                          <div className="flex items-start gap-3">
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-inset font-mono text-[11px] text-text-3">
                              {slide.position}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium leading-snug text-text">
                                {slide.headline}
                              </p>
                              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-4">
                                {slide.body || slide.bullets.join(" · ") || slide.visual.altText}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Regenerar slide ${slide.position}`}
                              onClick={() => {
                                setRegenerating(slide.slideId);
                                setInstruction("");
                              }}
                            >
                              <Sparkles />
                            </Button>
                          </div>
                          {regenerating === slide.slideId ? (
                            <div className="mt-3 flex gap-2 border-t border-border pt-3">
                              <Input
                                value={instruction}
                                onChange={(event) => setInstruction(event.target.value)}
                                placeholder="O que deve mudar neste slide?"
                                aria-label={`Instrução para o slide ${slide.position}`}
                                autoFocus
                              />
                              <Button
                                variant="soft"
                                disabled={!instruction.trim() || busy === `slide:${slide.slideId}`}
                                onClick={() =>
                                  void run(`slide:${slide.slideId}`, async () => {
                                    await regenerateSlide({
                                      projectId: project!._id,
                                      slideId: slide.slideId,
                                      instruction: instruction.trim(),
                                    });
                                    setRegenerating(null);
                                    setInstruction("");
                                  })
                                }
                              >
                                {busy === `slide:${slide.slideId}` ? (
                                  <RefreshCw className="animate-spin" />
                                ) : (
                                  <Sparkles />
                                )}
                                Aplicar
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-xl border border-border bg-inset p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-brand-accent shadow-sm">
                        <VandaMark size={15} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-text">Revisão editorial</h3>
                        <p className="mt-1 text-xs leading-relaxed text-text-3">
                          {document.reviewSummary}
                        </p>
                        {document.deterministicIssues.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-xs text-amber">
                            {document.deterministicIssues.slice(0, 4).map((issue) => (
                              <li key={issue}>• {humanizeIssue(issue)}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-text">Legenda</h3>
                    <p className="mt-2 rounded-lg border border-border bg-surface p-3 text-sm leading-relaxed whitespace-pre-wrap text-text-3">
                      {document.caption}
                    </p>
                  </section>
                </>
              ) : (
                <section className="rounded-xl border border-border bg-inset p-4">
                  <h3 className="text-sm font-semibold text-text">Detalhes</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-text-3">{item.title}</p>
                </section>
              )}

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
          <SheetFooter className="border-t border-border bg-surface p-4">
            <div className="flex w-full items-center gap-2">
              {canReview ? (
                <Button
                  className="flex-1"
                  disabled={busy !== null}
                  onClick={() => void run("review", () => reviewDraft({ projectId: project._id }))}
                >
                  {busy === "review" ? <RefreshCw className="animate-spin" /> : <Sparkles />}
                  Revisar alterações
                </Button>
              ) : canRetry && project.creativeBriefId ? (
                <Button
                  className="flex-1"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("retry", () =>
                      retryPlanning({ creativeBriefId: project.creativeBriefId!, retry: true }),
                    )
                  }
                >
                  {busy === "retry" ? <RefreshCw className="animate-spin" /> : <RefreshCw />}
                  Tentar novamente
                </Button>
              ) : (
                <Button variant="outline" className="flex-1" disabled>
                  <CircleDashed />
                  {project.status === "ready_for_render"
                    ? "Aguardando renderer"
                    : project.status === "rendering"
                      ? "Renderizando"
                      : "Abrir no editor"}
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="icon" aria-label="Ações do projeto" />}
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem disabled>
                    <Pencil />
                    Editar documento
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={busy !== null}
                    onClick={() =>
                      void run("archive", async () => {
                        await archiveProject({ projectId: project._id });
                        onOpenChange(false);
                      })
                    }
                  >
                    <Archive />
                    Arquivar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function EmptyGallery({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-surface text-text-4 shadow-sm">
        {filtered ? <Search className="size-5" /> : <Grid2X2 className="size-5" />}
      </div>
      <h2 className="mt-4 text-base font-semibold text-text">
        {filtered ? "Nenhum item encontrado" : "Sua galeria está vazia"}
      </h2>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-text-4">
        {filtered
          ? "Tente outro termo ou remova um dos filtros."
          : "Quando a Vanda criar um carrossel ou você adicionar uma imagem, ele aparece aqui."}
      </p>
      {!filtered ? (
        <Link to="/automatico" className={cn(buttonVariants(), "mt-4")}>
          <Sparkles />
          Criar com a Vanda
        </Link>
      ) : null}
    </div>
  );
}

function GallerySkeleton() {
  return (
    <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4" aria-hidden>
      {[
        { id: "portrait-a", square: false },
        { id: "square-a", square: true },
        { id: "portrait-b", square: false },
        { id: "portrait-c", square: false },
        { id: "square-b", square: true },
        { id: "portrait-d", square: false },
        { id: "portrait-e", square: false },
        { id: "square-c", square: true },
      ].map((item) => (
        <div
          key={item.id}
          className="mb-4 inline-block w-full break-inside-avoid overflow-hidden rounded-xl border border-border bg-surface"
        >
          <Skeleton
            className={cn("w-full rounded-none", item.square ? "aspect-square" : "aspect-[4/5]")}
          />
          <div className="space-y-2 p-3.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function InspectorSkeleton() {
  return (
    <div className="space-y-5 p-5" aria-hidden>
      <Skeleton className="mx-auto aspect-[4/5] w-full max-w-72 rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        {[1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" })
    .format(timestamp)
    .replace(".", "");
}

function humanizeIssue(issue: string): string {
  return issue
    .replace(/^[^:]+:/, "")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toLocaleUpperCase());
}
