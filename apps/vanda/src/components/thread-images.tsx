import { useEffect } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Copy, Download, ImageOff, SquarePen, Trash2 } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { imageModelLabel } from "../convex/imageModels";
import { ImageLightbox, type ImageLightboxData } from "./image-lightbox";
import {
  ActionStateIcon,
  MediaTile,
  MediaTileAction,
  MediaTileActions,
  MediaTileBadge,
  MediaTileCaption,
  MediaTileMedia,
  copyImageToClipboard,
  downloadImageFile,
  useMediaAction,
} from "./media-tile";
import { useEntranceOnMount } from "./thread-entrance";

export interface ThreadImageView {
  imageId: string;
  /** Legacy paint results can display immediately while the gallery query loads. */
  url?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

/** One image surface for generated images, present, and delegated resources. */
export function ThreadImage({
  image,
  accountId,
  onOpen,
}: {
  image: ThreadImageView;
  accountId: Id<"accounts">;
  onOpen: () => void;
}) {
  const enter = useEntranceOnMount();
  const live = useQuery(api.gallery.get, {
    accountId,
    imageId: image.imageId as Id<"images">,
  });
  const url = live?.url ?? image.url;
  const width = live?.width ?? image.width;
  const height = live?.height ?? image.height;
  const remove = useMutation(api.gallery.remove);
  const copy = useMediaAction(() => copyImageToClipboard(url!));
  const download = useMediaAction(() => downloadImageFile(url!, live?.name ?? null));

  if (live === null) return <DeletedImageNotice />;

  return (
    <MediaTile
      label={live?.name ?? "Imagem criada pela Vanda"}
      {...(url ? { onOpen } : {})}
      className={cn("max-w-sm", enter && "animate-attachment-in")}
    >
      <MediaTileMedia aspectRatio={width && height ? width / height : 4 / 5}>
        {url ? (
          <img
            src={url}
            alt={live?.name ?? "Imagem criada pela Vanda"}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <span className="relative block size-full">
            <Skeleton className="size-full" />
            <span className="absolute inset-0 flex items-center justify-center">
              <ThinkingOrb state="shaping" size={64} aria-label="Preparando a imagem…" />
            </span>
          </span>
        )}
      </MediaTileMedia>
      {live?.edited ? (
        <MediaTileBadge label="Editada">
          <SquarePen />
        </MediaTileBadge>
      ) : null}
      {url && (
        <MediaTileActions>
          <MediaTileAction label="Copiar imagem" onClick={copy.run}>
            <ActionStateIcon state={copy.state} icon={<Copy />} />
          </MediaTileAction>
          <MediaTileAction label="Baixar" onClick={download.run}>
            <ActionStateIcon state={download.state} icon={<Download />} />
          </MediaTileAction>
          <MediaTileAction
            label="Excluir"
            onClick={() => void remove({ accountId, imageId: image.imageId as Id<"images"> })}
            className="hover:bg-destructive/85"
          >
            <Trash2 />
          </MediaTileAction>
        </MediaTileActions>
      )}
      {live ? (
        <MediaTileCaption>
          <p className="truncate text-body-sm font-medium text-white">{live.name ?? "Sem nome"}</p>
          {live.model ? (
            <p className="truncate text-note text-white/70">{imageModelLabel(live.model)}</p>
          ) : null}
        </MediaTileCaption>
      ) : null}
    </MediaTile>
  );
}

/** Same detail panel and mutations as gallery images, scoped to the image's account. */
export function ThreadImageLightbox({
  accountId,
  images,
  selectedId,
  onSelect,
  onClose,
}: {
  accountId: Id<"accounts">;
  images: readonly ThreadImageView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const detail = useQuery(
    api.gallery.get,
    selectedId ? { accountId, imageId: selectedId as Id<"images"> } : "skip",
  );
  const rename = useMutation(api.gallery.rename);
  const remove = useMutation(api.gallery.remove);

  useEffect(() => {
    if (selectedId && detail === null) onClose();
  }, [selectedId, detail, onClose]);

  const index = images.findIndex((image) => image.imageId === selectedId);
  const prev = index > 0 ? images[index - 1] : undefined;
  const next = index >= 0 && index < images.length - 1 ? images[index + 1] : undefined;
  const fallback = index >= 0 ? images[index] : undefined;
  const image: ImageLightboxData | null = detail
    ? {
        id: detail.id,
        url: detail.url,
        name: detail.name,
        model: detail.model ? imageModelLabel(detail.model) : null,
        prompt: detail.prompt,
        width: detail.width,
        height: detail.height,
        generationMs: detail.generationMs,
        costUsd: detail.costUsd,
        createdAt: detail.createdAt,
        origin: detail.origin,
        edited: detail.edited,
        promptAuthor: detail.promptAuthor,
      }
    : fallback
      ? {
          id: fallback.imageId,
          url: fallback.url ?? null,
          name: null,
          width: fallback.width,
          height: fallback.height,
        }
      : null;

  return (
    <ImageLightbox
      open={selectedId !== null}
      onClose={onClose}
      image={image}
      loading={detail === undefined}
      onPrev={prev ? () => onSelect(prev.imageId) : undefined}
      onNext={next ? () => onSelect(next.imageId) : undefined}
      onRename={(name) => {
        if (selectedId) void rename({ accountId, imageId: selectedId as Id<"images">, name });
      }}
      onDelete={() => {
        if (!selectedId) return;
        void remove({ accountId, imageId: selectedId as Id<"images"> }).then(onClose);
      }}
    />
  );
}

function DeletedImageNotice() {
  return (
    <div className="flex w-full max-w-sm items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-3.5 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-text-4">
        <ImageOff className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-body font-medium text-text-2">Imagem excluída</p>
        <p className="text-body-sm text-text-4">Esta imagem foi removida da galeria.</p>
      </div>
    </div>
  );
}
