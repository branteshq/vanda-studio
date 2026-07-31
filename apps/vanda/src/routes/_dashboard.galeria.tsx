import { createFileRoute } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { usePaginatedQuery, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  PanelLeftOpen,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@vanda-studio/ui/components/dialog";
import { useSidebar } from "@vanda-studio/ui/components/sidebar";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { imageModelLabel } from "../convex/imageModels";
import { useActiveAccount } from "../components/active-account";

export const Route = createFileRoute("/_dashboard/galeria")({
  component: GalleryPage,
});

type GalleryItem = FunctionReturnType<typeof api.gallery.list>["page"][number];
type GalleryDetail = NonNullable<FunctionReturnType<typeof api.gallery.get>>;

function GalleryPage() {
  const { activeAccount } = useActiveAccount();
  if (!activeAccount) return null;
  return <GalleryStudio key={activeAccount.id} accountId={activeAccount.id} />;
}

function GalleryStudio({ accountId }: { accountId: Id<"accounts"> }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<Id<"images"> | null>(null);

  const { results, status, loadMore } = usePaginatedQuery(
    api.gallery.list,
    { accountId },
    { initialNumItems: 40 },
  );

  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const items = normalized
    ? results.filter((item) => (item.name ?? "").toLocaleLowerCase("pt-BR").includes(normalized))
    : results;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <GalleryHeader query={query} onQuery={setQuery} accountId={accountId} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {status === "LoadingFirstPage" ? (
            <MasonrySkeleton />
          ) : items.length === 0 ? (
            <EmptyGallery hasQuery={normalized.length > 0} />
          ) : (
            <>
              <div className="mx-auto max-w-[1600px] columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">
                {items.map((item) => (
                  <GalleryCard
                    key={item.id}
                    item={item}
                    onOpen={() => setSelectedId(item.id as Id<"images">)}
                  />
                ))}
              </div>
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

      <ImageDetailDialog
        accountId={accountId}
        items={items}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onClose={() => setSelectedId(null)}
      />
    </main>
  );
}

// --- Header -----------------------------------------------------------------

function GalleryHeader({
  query,
  onQuery,
  accountId,
}: {
  query: string;
  onQuery: (value: string) => void;
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
          className="h-8 w-full rounded-lg border border-border bg-surface-2 pl-8 pr-3 text-sm text-text outline-none transition-colors placeholder:text-text-4 hover:border-border-strong focus-visible:border-border-strong focus-visible:ring-2 focus-visible:ring-brand-accent/30"
        />
      </div>
      <div className="ml-auto">
        <UploadButton accountId={accountId} />
      </div>
    </header>
  );
}

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

function GalleryCard({ item, onOpen }: { item: GalleryItem; onOpen: () => void }) {
  const ratio = item.width && item.height ? item.width / item.height : 1;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block w-full overflow-hidden rounded-xl border border-border bg-surface text-left transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/50"
    >
      <div style={{ aspectRatio: ratio }} className="w-full bg-surface-2">
        {item.url && (
          <img
            src={item.url}
            alt={item.name ?? "Imagem"}
            loading="lazy"
            className="size-full object-cover"
          />
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5 opacity-0 transition-opacity group-hover:opacity-100">
        <p className="truncate text-xs font-medium text-white">{item.name ?? "Sem nome"}</p>
        {item.model && (
          <p className="truncate text-[11px] text-white/70">{imageModelLabel(item.model)}</p>
        )}
      </div>
    </button>
  );
}

function MasonrySkeleton() {
  const heights = [220, 300, 180, 260, 340, 200, 280, 240];
  return (
    <div className="mx-auto max-w-[1600px] columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">
      {heights.map((h, i) => (
        <Skeleton key={i} className="w-full rounded-xl" style={{ height: h }} />
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
      <h2 className="mt-4 text-base font-semibold text-text">
        {hasQuery ? "Nada encontrado" : "Sua galeria está vazia"}
      </h2>
      <p className="mt-1.5 max-w-xs text-sm text-text-4">
        {hasQuery
          ? "Nenhuma imagem com esse nome."
          : "Use o painel Criar ao lado para gerar imagens, ou envie as suas próprias."}
      </p>
    </div>
  );
}

// --- Detail dialog ----------------------------------------------------------

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

  const index = useMemo(
    () => items.findIndex((item) => item.id === selectedId),
    [items, selectedId],
  );
  const prev = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : undefined;

  // Show the grid thumbnail instantly while the full detail loads.
  const gridItem: GalleryItem | undefined = index >= 0 ? items[index] : undefined;
  const item = detail ?? undefined;
  const url = item?.url ?? gridItem?.url ?? null;

  return (
    <Dialog open={selectedId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{item?.name ?? "Imagem"}</DialogTitle>
        <div className="flex max-h-[85vh] flex-col md:flex-row">
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/40 p-3">
            {url ? (
              <img
                src={url}
                alt={item?.name ?? "Imagem"}
                className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
              />
            ) : (
              <Spinner className="size-6 text-white/70" />
            )}
            {prev && (
              <button
                type="button"
                aria-label="Anterior"
                onClick={() => onSelect(prev.id as Id<"images">)}
                className="absolute left-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <ChevronLeft className="size-5" />
              </button>
            )}
            {next && (
              <button
                type="button"
                aria-label="Próxima"
                onClick={() => onSelect(next.id as Id<"images">)}
                className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <ChevronRight className="size-5" />
              </button>
            )}
          </div>

          <aside className="flex w-full shrink-0 flex-col border-t border-border md:w-80 md:border-l md:border-t-0">
            {item ? (
              <DetailBody
                accountId={accountId}
                item={item}
                onRename={(name) => void rename({ accountId, imageId: item.id as Id<"images">, name })}
                onDelete={async () => {
                  await remove({ accountId, imageId: item.id as Id<"images"> });
                  onClose();
                }}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8">
                <Spinner className="size-5 text-text-4" />
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  item,
  onRename,
  onDelete,
}: {
  accountId: Id<"accounts">;
  item: GalleryDetail;
  onRename: (name: string) => void;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(item.name ?? "");
  const ratio =
    item.width && item.height
      ? closestAspect(item.width / item.height)
      : "—";

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => name.trim() && name.trim() !== item.name && onRename(name.trim())}
          placeholder="Sem nome"
          aria-label="Nome da imagem"
          className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-base font-semibold text-text outline-none hover:border-border focus-visible:border-border"
        />

        <div className="flex flex-wrap gap-1.5">
          {item.model && <MetaChip>{imageModelLabel(item.model)}</MetaChip>}
          <MetaChip>{ratio}</MetaChip>
          {item.generationMs != null && <MetaChip>{(item.generationMs / 1000).toFixed(1)}s</MetaChip>}
          {item.costUsd != null && <MetaChip>${item.costUsd.toFixed(4)}</MetaChip>}
        </div>

        {item.prompt && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-4">
              Prompt
            </p>
            <p className="rounded-lg bg-surface-2 p-2.5 text-xs leading-relaxed text-text-2">
              {item.prompt}
            </p>
          </div>
        )}

        <p className="text-[11px] text-text-4">
          {new Date(item.createdAt).toLocaleString("pt-BR")}
        </p>
      </div>

      <div className="flex items-center gap-2 border-t border-border p-3">
        {item.url && (
          <a
            href={item.url}
            download
            target="_blank"
            rel="noreferrer"
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface text-sm font-medium text-text transition-colors hover:border-border-strong"
          >
            <Download className="size-4" />
            Baixar
          </a>
        )}
        <Button
          variant="outline"
          size="icon"
          aria-label="Excluir"
          onClick={() => void onDelete()}
          className="text-text-4 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text-3">
      {children}
    </span>
  );
}

// --- helpers ----------------------------------------------------------------

function closestAspect(ratio: number): string {
  const options: Array<[string, number]> = [
    ["1:1", 1],
    ["4:5", 4 / 5],
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
    ["3:4", 3 / 4],
  ];
  let best = options[0]!;
  for (const option of options) {
    if (Math.abs(option[1] - ratio) < Math.abs(best[1] - ratio)) best = option;
  }
  return best[0];
}

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
