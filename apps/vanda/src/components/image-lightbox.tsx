import { useState, type ReactNode } from "react";
import {
  Clock,
  Copy,
  DollarSign,
  Download,
  Frame,
  Proportions,
  SquarePen,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Lightbox,
  LightboxContent,
  LightboxMedia,
  LightboxPanel,
} from "@vanda-studio/ui/components/lightbox";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import {
  ActionStateIcon,
  copyImageToClipboard,
  downloadImageFile,
  useMediaAction,
} from "./media-tile";
import { VandaMark } from "./vanda-mark";

/**
 * ImageLightbox — the expanded view of any image in the product: gallery tiles
 * today, chat-generated images next. One data shape in, the same viewer out,
 * regardless of which surface opened it.
 *
 * Everything is optional except the media itself: generated images carry
 * prompt/model/cost/timing; uploads only carry dimensions and a date — the
 * panel simply renders what exists.
 */
export interface ImageLightboxData {
  id: string;
  url: string | null;
  name: string | null;
  /** Humanized model label (already resolved by the caller). */
  model?: string | null | undefined;
  prompt?: string | null | undefined;
  width?: number | null | undefined;
  height?: number | null | undefined;
  generationMs?: number | null | undefined;
  costUsd?: number | null | undefined;
  createdAt?: number | null | undefined;
  origin?: string | null | undefined;
  /** Produced by editing an existing image (paint edit or run_code). */
  edited?: boolean | undefined;
  /** Who wrote the generation prompt — Vanda (chat) or the owner (gallery). */
  promptAuthor?: "vanda" | "user" | null | undefined;
}

export function ImageLightbox({
  open,
  onClose,
  image,
  loading = false,
  onPrev,
  onNext,
  onRename,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  image: ImageLightboxData | null;
  /** The full record is still on its way — generation fields show as skeletons. */
  loading?: boolean;
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  onRename?: ((name: string) => void) | undefined;
  onDelete?: (() => void) | undefined;
}) {
  return (
    <Lightbox open={open} onOpenChange={(next) => !next && onClose()}>
      <LightboxContent label={image?.name ?? "Imagem"} onPrev={onPrev} onNext={onNext}>
        <LightboxMedia>
          {image?.url ? (
            <img
              src={image.url}
              alt={image.name ?? "Imagem"}
              // The height cap lives on the img itself (mirroring the popup
              // padding): the browser then derives the width from the aspect
              // ratio, so the element box hugs the visible pixels and the
              // panel docks flush against the real edge — no letterbox gap.
              className="max-h-[50svh] max-w-full rounded-xl object-contain shadow-lg md:max-h-[calc(100svh-3rem)] lg:max-h-[calc(100svh-5rem)]"
            />
          ) : (
            <Spinner className="size-6 text-white/70" />
          )}

          <LightboxPanel>
            {image ? (
              <ImageDetails
                image={image}
                loading={loading}
                onRename={onRename}
                onDelete={onDelete}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-8">
                <Spinner className="size-5 text-text-4" />
              </div>
            )}
          </LightboxPanel>
        </LightboxMedia>
      </LightboxContent>
    </Lightbox>
  );
}

function ImageDetails({
  image,
  loading,
  onRename,
  onDelete,
}: {
  image: ImageLightboxData;
  loading: boolean;
  onRename?: ((name: string) => void) | undefined;
  onDelete?: (() => void) | undefined;
}) {
  const uploaded = image.origin === "uploaded";
  const generated = !uploaded;

  return (
    <>
      <div className="flex items-start gap-2 p-4 pb-0">
        {/* Keyed by id so navigating to a neighbor reseeds the draft name. */}
        {onRename ? (
          <NameInput key={image.id} name={image.name} onRename={onRename} />
        ) : (
          <h2 className="min-w-0 flex-1 truncate px-1 py-0.5 text-card-title font-semibold text-text">
            {image.name ?? "Sem nome"}
          </h2>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {image.url && <CopyAction url={image.url} />}
          {image.url && <DownloadAction url={image.url} name={image.name} />}
          {onDelete && (
            <PanelAction label="Excluir" onClick={onDelete} className="hover:text-destructive">
              <Trash2 />
            </PanelAction>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap gap-1.5">
          {image.model && <MetaChip>{image.model}</MetaChip>}
          {generated &&
            (loading ? (
              <>
                <Skeleton className="h-6 w-14 rounded-md" />
                <Skeleton className="h-6 w-16 rounded-md" />
              </>
            ) : (
              <>
                {image.generationMs != null && (
                  <MetaChip icon={<Clock />}>{(image.generationMs / 1000).toFixed(1)}s</MetaChip>
                )}
                {image.costUsd != null && (
                  <MetaChip icon={<DollarSign />}>{image.costUsd.toFixed(4)}</MetaChip>
                )}
              </>
            ))}
          {image.width != null && image.height != null && (
            <>
              <MetaChip icon={<Proportions />}>
                {closestAspect(image.width / image.height)}
              </MetaChip>
              <MetaChip icon={<Frame />}>
                {image.width} × {image.height}
              </MetaChip>
            </>
          )}
          {uploaded && <MetaChip icon={<Upload />}>Enviada por você</MetaChip>}
          {image.edited && <MetaChip icon={<SquarePen />}>Editada</MetaChip>}
        </div>

        {generated && (
          <div>
            <p className="section-label mb-1 flex items-center gap-1.5 text-text-2">
              Prompt
              {/* Vanda authored this prompt — her mark signs the section. */}
              {image.promptAuthor === "vanda" && <VandaMark size={12} />}
            </p>
            {loading ? (
              <div className="space-y-1.5 rounded-lg bg-muted p-2.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            ) : image.prompt ? (
              <p
                className={cn(
                  "rounded-lg p-2.5 text-body-sm text-text-2",
                  image.promptAuthor === "vanda"
                    ? "border border-creating-border bg-creating-bg"
                    : "bg-muted",
                )}
              >
                {image.prompt}
              </p>
            ) : (
              <p className="rounded-lg bg-muted p-2.5 text-body-sm text-text-4">Sem prompt.</p>
            )}
          </div>
        )}

        {image.createdAt != null && (
          <p className="text-note text-text-4">
            {uploaded ? "Enviada em" : "Criada em"}{" "}
            {new Date(image.createdAt).toLocaleString("pt-BR")}
          </p>
        )}
      </div>
    </>
  );
}

function NameInput({ name, onRename }: { name: string | null; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name ?? "");
  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== name) onRename(trimmed);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      placeholder="Sem nome"
      aria-label="Nome da imagem"
      maxLength={120}
      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-card-title font-semibold text-text outline-none transition-colors duration-150 ease-[var(--ease-out)] hover:border-border focus-visible:border-border"
    />
  );
}

function CopyAction({ url }: { url: string }) {
  const copy = useMediaAction(() => copyImageToClipboard(url));
  return (
    <PanelAction label="Copiar imagem" onClick={copy.run}>
      <ActionStateIcon state={copy.state} icon={<Copy />} />
    </PanelAction>
  );
}

function DownloadAction({ url, name }: { url: string; name: string | null }) {
  const download = useMediaAction(() => downloadImageFile(url, name));
  return (
    <PanelAction label="Baixar" onClick={download.run}>
      <ActionStateIcon state={download.state} icon={<Download />} />
    </PanelAction>
  );
}

function PanelAction({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ActionTooltip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          "flex size-8 items-center justify-center rounded-lg text-text-4 outline-none transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] hover:bg-muted hover:text-text focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:transform-none [&_svg]:size-4",
          className,
        )}
      >
        {children}
      </button>
    </ActionTooltip>
  );
}

function MetaChip({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-note text-text-3 [&_svg]:size-3 [&_svg]:text-text-4">
      {icon}
      {children}
    </span>
  );
}

/** Nearest friendly aspect label for arbitrary dimensions (uploads included). */
function closestAspect(ratio: number): string {
  const options: Array<[string, number]> = [
    ["1:1", 1],
    ["4:5", 4 / 5],
    ["3:4", 3 / 4],
    ["9:16", 9 / 16],
    ["16:9", 16 / 9],
    ["4:3", 4 / 3],
    ["21:9", 21 / 9],
  ];
  let best = options[0]!;
  for (const option of options) {
    if (Math.abs(option[1] - ratio) < Math.abs(best[1] - ratio)) best = option;
  }
  return best[0];
}
