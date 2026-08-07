import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { usePaginatedQuery, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Copy,
  Download,
  ImagePlus,
  Images,
  PanelLeftOpen,
  Search,
  Sparkles,
  SquarePen,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { useSidebar } from "@vanda-studio/ui/components/sidebar";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { IMAGE_MODELS, imageModelLabel } from "../convex/imageModels";
import { useActiveAccount } from "../components/active-account";
import { FilterMenu, type FilterOption } from "../components/filter-menu";
import { ImageLightbox, type ImageLightboxData } from "../components/image-lightbox";
import {
  ActionStateIcon,
  MediaTile,
  MediaTileAction,
  MediaTileActions,
  MediaTileBadge,
  MediaTileCaption,
  MediaTileMedia,
  MediaTileSelect,
  copyImageToClipboard,
  downloadImageFile,
  useMediaAction,
} from "../components/media-tile";

export const Route = createFileRoute("/_dashboard/galeria")({
  component: GalleryPage,
});

type GalleryItem = FunctionReturnType<typeof api.gallery.list>["page"][number];

function GalleryPage() {
  const { activeAccount } = useActiveAccount();
  if (!activeAccount) return null;
  return <GalleryStudio key={activeAccount.id} accountId={activeAccount.id} />;
}

type OriginFilter = "all" | "generated" | "edited" | "uploaded";
type OrderFilter = "recent" | "oldest";

function GalleryStudio({ accountId }: { accountId: Id<"accounts"> }) {
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [order, setOrder] = useState<OrderFilter>("recent");
  const [model, setModel] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<Id<"images"> | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const removeMany = useMutation(api.gallery.removeMany);

  const { results, status, loadMore } = usePaginatedQuery(
    api.gallery.list,
    { accountId },
    { initialNumItems: 40 },
  );

  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const matchesOrigin = (item: GalleryItem): boolean => {
    switch (origin) {
      case "uploaded":
        return item.origin === "uploaded";
      case "edited":
        return item.edited;
      case "generated":
        return item.origin !== "uploaded";
      default:
        return true;
    }
  };
  const filtered = results.filter(
    (item) =>
      matchesOrigin(item) &&
      (model === "all" || item.model === model) &&
      (!normalized || (item.name ?? "").toLocaleLowerCase("pt-BR").includes(normalized)),
  );
  // The query is newest-first; "oldest" is simply its mirror (copy, then flip —
  // toReversed needs an es2023 lib target we don't have).
  // eslint-disable-next-line unicorn/no-array-reverse -- the spread already copies
  const items = order === "oldest" ? [...filtered].reverse() : filtered;

  // Placeholders and failures aren't selectable or viewable — only real images.
  const readyItems = items.filter((item) => item.status === null);

  const selecting = checked.size > 0;

  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Selection tracks reality: ids deleted elsewhere (another tab, the agent)
  // silently drop out instead of ghosting in the count.
  useEffect(() => {
    setChecked((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(results.map((item) => item.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [results]);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChecked(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  const deleteChecked = async () => {
    const ids = [...checked] as Id<"images">[];
    setDeleting(true);
    try {
      // The mutation caps each batch; chunk so any selection size goes through.
      for (let i = 0; i < ids.length; i += 100) {
        await removeMany({ accountId, imageIds: ids.slice(i, i + 100) });
      }
      setChecked(new Set());
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="animate-mode-in relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <GalleryHeader
        query={query}
        onQuery={setQuery}
        origin={origin}
        onOrigin={setOrigin}
        order={order}
        onOrder={setOrder}
        model={model}
        onModel={setModel}
        accountId={accountId}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {status === "LoadingFirstPage" ? (
            <MasonrySkeleton />
          ) : items.length === 0 ? (
            <EmptyGallery
              hasQuery={normalized.length > 0 || origin !== "all" || model !== "all"}
            />
          ) : (
            <>
              <MasonryGrid
                items={items}
                renderItem={(item) => (
                  <GalleryCard
                    key={item.id}
                    item={item}
                    accountId={accountId}
                    selected={checked.has(item.id)}
                    selecting={selecting}
                    onOpen={() => setSelectedId(item.id as Id<"images">)}
                    onToggleSelect={() => toggleChecked(item.id)}
                  />
                )}
              />
              {status === "CanLoadMore" && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={() => loadMore(40)}>
                    Carregar mais
                  </Button>
                </div>
              )}
              {status === "LoadingMore" && (
                <div className="mt-6 flex justify-center">
                  <Spinner className="size-5 text-text-4" />
                </div>
              )}
            </>
          )}
      </div>

      {selecting && (
        <SelectionBar
          count={checked.size}
          allSelected={checked.size === readyItems.length}
          deleting={deleting}
          onSelectAll={() => setChecked(new Set(readyItems.map((item) => item.id)))}
          onDelete={() => void deleteChecked()}
          onClear={() => setChecked(new Set())}
        />
      )}

      <ImageDetailDialog
        accountId={accountId}
        items={readyItems}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onClose={() => setSelectedId(null)}
      />
    </main>
  );
}

/** The floating bulk bar: appears with the first checked tile, Esc dismisses. */
function SelectionBar({
  count,
  allSelected,
  deleting,
  onSelectAll,
  onDelete,
  onClear,
}: {
  count: number;
  allSelected: boolean;
  deleting: boolean;
  onSelectAll: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
      <div className="animate-card-in pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-surface/95 py-1.5 pr-1.5 pl-4 shadow-lg backdrop-blur-md">
        <span className="text-body font-medium text-text tabular-nums">
          {count} {count === 1 ? "selecionada" : "selecionadas"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAll}
          disabled={allSelected}
          className="rounded-full"
        >
          Selecionar todas
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          disabled={deleting}
          className="rounded-full"
        >
          {deleting ? <Spinner className="size-3.5" /> : <Trash2 className="size-3.5" />}
          Excluir
        </Button>
        <ActionTooltip label="Limpar seleção" side="top">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Limpar seleção"
            onClick={onClear}
            className="rounded-full text-text-4 hover:text-text"
          >
            <X />
          </Button>
        </ActionTooltip>
      </div>
    </div>
  );
}

// --- Header -----------------------------------------------------------------

function GalleryHeader({
  query,
  onQuery,
  origin,
  onOrigin,
  order,
  onOrder,
  model,
  onModel,
  accountId,
}: {
  query: string;
  onQuery: (value: string) => void;
  origin: OriginFilter;
  onOrigin: (value: OriginFilter) => void;
  order: OrderFilter;
  onOrder: (value: OrderFilter) => void;
  model: string;
  onModel: (value: string) => void;
  accountId: Id<"accounts">;
}) {
  const { state, setOpen } = useSidebar();
  return (
    <header className="flex items-center gap-2 px-4 py-2 md:px-6">
      {state === "collapsed" && (
        <ActionTooltip label="Abrir barra lateral" side="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Abrir barra lateral"
            onClick={() => setOpen(true)}
            className="hidden shrink-0 text-text-4 hover:text-text md:inline-flex"
          >
            <PanelLeftOpen />
          </Button>
        </ActionTooltip>
      )}
      <div className="relative w-full max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-4" />
        <input
          id="gallery-search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Buscar imagens…"
          aria-label="Buscar na galeria"
          className="h-9 w-full rounded-md border border-transparent bg-transparent pr-2 pl-8 text-body text-text outline-none transition-colors duration-150 ease-[var(--ease-out)] placeholder:text-text-4 hover:bg-muted focus:border-border-strong focus:bg-muted"
        />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <FilterMenu
          label="Filtrar imagens"
          groups={[
            {
              key: "origin",
              label: "Origem",
              value: origin,
              defaultValue: "all",
              options: ORIGIN_FILTERS,
              onChange: (value) => onOrigin(value as OriginFilter),
            },
            {
              key: "order",
              label: "Ordem",
              value: order,
              defaultValue: "recent",
              options: ORDER_FILTERS,
              onChange: (value) => onOrder(value as OrderFilter),
            },
            {
              key: "model",
              label: "Modelo",
              value: model,
              defaultValue: "all",
              options: MODEL_FILTERS,
              onChange: onModel,
            },
          ]}
        />
        <UploadButton accountId={accountId} />
      </div>
    </header>
  );
}

const ORIGIN_FILTERS: ReadonlyArray<FilterOption<OriginFilter>> = [
  { value: "all", label: "Todas", icon: <Images /> },
  { value: "generated", label: "Geradas", icon: <Sparkles /> },
  { value: "edited", label: "Editadas", icon: <SquarePen /> },
  { value: "uploaded", label: "Enviadas", icon: <Upload /> },
];

const ORDER_FILTERS: ReadonlyArray<FilterOption<OrderFilter>> = [
  { value: "recent", label: "Mais recentes", icon: <ArrowDownWideNarrow /> },
  { value: "oldest", label: "Mais antigas", icon: <ArrowUpNarrowWide /> },
];

const MODEL_FILTERS: ReadonlyArray<FilterOption<string>> = [
  { value: "all", label: "Todos os modelos" },
  ...IMAGE_MODELS.map((model) => ({ value: model.id, label: model.label })),
];

function UploadButton({ accountId }: { accountId: Id<"accounts"> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(api.imageUploads.generateUploadUrl);
  const addImage = useMutation(api.imageUploads.addImage);
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const dims = await imageDimensions(file);
        const url = await generateUploadUrl();
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": file.type },
          body: file,
        });
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await addImage({ accountId, storageId, mimeType: file.type, ...dims });
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => void upload(event.target.files)}
      />
      <ActionTooltip label="Enviar imagens" side="bottom">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Enviar imagens"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="text-text-4 hover:text-text"
        >
          {busy ? <Spinner className="size-4" /> : <ImagePlus className="size-4" />}
        </Button>
      </ActionTooltip>
    </>
  );
}

// --- Grid -------------------------------------------------------------------

/** A generation still in flight: the image's slot, pulsing, at its final ratio. */
function GeneratingCard({ item }: { item: GalleryItem }) {
  const ratio = item.width && item.height ? item.width / item.height : 1;
  return (
    <div
      style={{ aspectRatio: ratio }}
      role="status"
      aria-label="Gerando imagem"
      className="relative w-full overflow-hidden rounded-xl border border-border"
    >
      <Skeleton className="absolute inset-0 rounded-none" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <Spinner className="size-5 text-text-4" />
        {item.model && <p className="text-note text-text-4">{imageModelLabel(item.model)}</p>}
      </div>
    </div>
  );
}

/** A generation that died: what failed, why, and a way to clear the slot. */
function FailedCard({
  item,
  accountId,
  error,
}: {
  item: GalleryItem;
  accountId: Id<"accounts">;
  error: string;
}) {
  const ratio = item.width && item.height ? item.width / item.height : 1;
  const remove = useMutation(api.gallery.remove);
  return (
    <div
      style={{ aspectRatio: ratio }}
      className="relative flex w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center"
    >
      <p className="text-body-sm font-medium text-destructive">Falhou</p>
      <p className="line-clamp-3 max-w-full text-note text-text-4">{error}</p>
      {item.model && <p className="text-note text-text-4">{imageModelLabel(item.model)}</p>}
      <ActionTooltip label="Descartar" side="bottom">
        <button
          type="button"
          aria-label="Descartar geração falha"
          onClick={() => void remove({ accountId, imageId: item.id as Id<"images"> })}
          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-lg text-text-4 outline-none transition-colors duration-150 ease-[var(--ease-out)] hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/50"
        >
          <X className="size-3.5" />
        </button>
      </ActionTooltip>
    </div>
  );
}

/** Generations older than this still marked "generating" are presumed dead. */
const GENERATION_TIMEOUT_MS = 5 * 60_000;

function GalleryCard({
  item,
  accountId,
  selected,
  selecting,
  onOpen,
  onToggleSelect,
}: {
  item: GalleryItem;
  accountId: Id<"accounts">;
  selected: boolean;
  selecting: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
}) {
  const ratio = item.width && item.height ? item.width / item.height : 1;
  const remove = useMutation(api.gallery.remove);
  const copy = useMediaAction(() => copyImageToClipboard(item.url!));
  const download = useMediaAction(() => downloadImageFile(item.url!, item.name));

  if (item.status === "failed") {
    return (
      <FailedCard item={item} accountId={accountId} error={item.generationError ?? "Erro"} />
    );
  }
  if (item.status === "generating") {
    // The action can die without reporting (deploy restart) — after the
    // timeout the slot flips to a dismissible failure instead of pulsing forever.
    return Date.now() - item.createdAt > GENERATION_TIMEOUT_MS ? (
      <FailedCard item={item} accountId={accountId} error="Tempo esgotado" />
    ) : (
      <GeneratingCard item={item} />
    );
  }

  return (
    <MediaTile
      label={item.name ?? "Imagem"}
      selected={selected}
      selecting={selecting}
      onOpen={onOpen}
      onToggleSelect={onToggleSelect}
    >
      <MediaTileMedia aspectRatio={ratio}>
        {item.url && (
          <img
            src={item.url}
            alt={item.name ?? "Imagem"}
            loading="lazy"
            className="size-full object-cover"
          />
        )}
      </MediaTileMedia>

      <MediaTileSelect
        selected={selected}
        onToggle={onToggleSelect}
        label={selected ? "Remover da seleção" : "Selecionar imagem"}
      />

      {item.origin === "uploaded" ? (
        <MediaTileBadge label="Enviada por você">
          <Upload />
        </MediaTileBadge>
      ) : item.edited ? (
        <MediaTileBadge label="Editada">
          <SquarePen />
        </MediaTileBadge>
      ) : null}

      {item.url && (
        <MediaTileActions>
          <MediaTileAction label="Copiar imagem" onClick={copy.run}>
            <ActionStateIcon state={copy.state} icon={<Copy />} />
          </MediaTileAction>
          <MediaTileAction label="Baixar" onClick={download.run}>
            <ActionStateIcon state={download.state} icon={<Download />} />
          </MediaTileAction>
          <MediaTileAction
            label="Excluir"
            onClick={() => void remove({ accountId, imageId: item.id as Id<"images"> })}
            className="hover:bg-destructive/85"
          >
            <Trash2 />
          </MediaTileAction>
        </MediaTileActions>
      )}

      <MediaTileCaption>
        <p className="truncate text-body-sm font-medium text-white">{item.name ?? "Sem nome"}</p>
        {item.model ? (
          <p className="truncate text-note text-white/70">{imageModelLabel(item.model)}</p>
        ) : item.origin === "uploaded" ? (
          <p className="truncate text-note text-white/70">Enviada por você</p>
        ) : null}
      </MediaTileCaption>
    </MediaTile>
  );
}

/**
 * Ordered masonry: CSS `columns-*` flows top-to-bottom per column, which lies
 * about recency — the "newest" corner would be the whole first column. Round-
 * robin distribution across real flex columns keeps reading order left-to-
 * right, row by row, while each column still stacks to its own height.
 */
function MasonryGrid<T extends { id: string }>({
  items,
  renderItem,
}: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
}) {
  const count = useColumnCount();
  const columns = useMemo(() => {
    const cols: T[][] = Array.from({ length: count }, () => []);
    items.forEach((item, index) => cols[index % count]!.push(item));
    return cols;
  }, [items, count]);

  return (
    <div className="mx-auto flex max-w-7xl gap-3">
      {columns.map((column, index) => (
        <div key={index} className="flex min-w-0 flex-1 flex-col gap-3">
          {column.map(renderItem)}
        </div>
      ))}
    </div>
  );
}

/** Mirrors the grid's breakpoints: 2 / sm:3 / lg:4 columns. */
function useColumnCount(): number {
  const [count, setCount] = useState(2);
  useEffect(() => {
    const lg = window.matchMedia("(min-width: 1024px)");
    const sm = window.matchMedia("(min-width: 640px)");
    const update = () => setCount(lg.matches ? 4 : sm.matches ? 3 : 2);
    update();
    lg.addEventListener("change", update);
    sm.addEventListener("change", update);
    return () => {
      lg.removeEventListener("change", update);
      sm.removeEventListener("change", update);
    };
  }, []);
  return count;
}

function MasonrySkeleton() {
  // Enough varied-height placeholders to fill the viewport across all columns
  // (~5 per column at the widest breakpoint), not just the top rows.
  const heights = [220, 300, 180, 260, 340, 200, 280, 240];
  return (
    <div className="mx-auto max-w-7xl columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">
      {Array.from({ length: 20 }, (_, i) => (
        <Skeleton
          key={i}
          className="w-full rounded-xl"
          style={{ height: heights[i % heights.length] }}
        />
      ))}
    </div>
  );
}

function EmptyGallery({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-xl border border-border bg-surface text-text-3">
        <Sparkles className="size-5" />
      </span>
      <h2 className="mt-4 text-card-title font-semibold text-text">
        {hasQuery ? "Nada encontrado" : "Sua galeria está vazia"}
      </h2>
      <p className="mt-1.5 max-w-xs text-body text-text-4">
        {hasQuery
          ? "Nenhuma imagem com esse nome."
          : "Use o painel Criar ao lado para gerar imagens, ou envie as suas próprias."}
      </p>
    </div>
  );
}

// --- Detail lightbox --------------------------------------------------------

/**
 * Bridges the gallery's data to the generic ImageLightbox: the grid row renders
 * the viewer instantly while `gallery.get` streams in the generation record
 * (prompt, cost, timing), which fills the panel's skeletons in place.
 */
function ImageDetailDialog({
  accountId,
  items,
  selectedId,
  onSelect,
  onClose,
}: {
  accountId: Id<"accounts">;
  items: GalleryItem[];
  selectedId: Id<"images"> | null;
  onSelect: (id: Id<"images">) => void;
  onClose: () => void;
}) {
  const detail = useQuery(
    api.gallery.get,
    selectedId ? { accountId, imageId: selectedId } : "skip",
  );
  const rename = useMutation(api.gallery.rename);
  const remove = useMutation(api.gallery.remove);

  // The record vanished under the viewer (deleted from another surface) — close
  // instead of spinning forever on a query that will never resolve.
  useEffect(() => {
    if (selectedId && detail === null) onClose();
  }, [selectedId, detail, onClose]);

  const index = useMemo(
    () => items.findIndex((item) => item.id === selectedId),
    [items, selectedId],
  );
  const prev = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : undefined;
  const gridItem: GalleryItem | undefined = index >= 0 ? items[index] : undefined;

  const source = detail ?? gridItem;
  const image: ImageLightboxData | null = source
    ? {
        id: source.id,
        url: source.url,
        name: source.name,
        model: source.model ? imageModelLabel(source.model) : null,
        prompt: detail?.prompt,
        width: source.width,
        height: source.height,
        generationMs: detail?.generationMs,
        costUsd: detail?.costUsd,
        createdAt: source.createdAt,
        origin: source.origin,
        edited: source.edited,
        promptAuthor: detail?.promptAuthor,
      }
    : null;

  return (
    <ImageLightbox
      open={selectedId !== null}
      onClose={onClose}
      image={image}
      loading={detail === undefined}
      onPrev={prev ? () => onSelect(prev.id as Id<"images">) : undefined}
      onNext={next ? () => onSelect(next.id as Id<"images">) : undefined}
      onRename={(name) => {
        if (selectedId) void rename({ accountId, imageId: selectedId, name });
      }}
      onDelete={() => {
        if (!selectedId) return;
        void remove({ accountId, imageId: selectedId }).then(onClose);
      }}
    />
  );
}

// --- helpers ----------------------------------------------------------------

function imageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
