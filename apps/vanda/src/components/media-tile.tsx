import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * MediaTile — the generic hover surface for any piece of media (gallery images
 * today; chat-generated images and posts later). It owns the shared
 * choreography so every grid feels identical:
 *
 *   - hover: the media eases into a slow 4% zoom while the controls and the
 *     caption scrim fade in with a small settle (4px slide, 200ms ease-out)
 *   - selection: a circular toggle (top-left) that stays pinned while any item
 *     in the set is selected; the media relaxes back to 96% so a picked tile
 *     reads as physically "lifted off" the wall
 *   - actions: chips on the top-right (copy / download / delete / whatever the
 *     caller composes) — each self-legible on any artwork via a dark blur pill
 *
 * Composition only: the tile knows nothing about galleries, Convex, or what
 * the actions do. State flows in via props; styling flows down via
 * `group/tile` + data attributes.
 */

export function MediaTile({
  selected = false,
  selecting = false,
  onOpen,
  onToggleSelect,
  label,
  className,
  children,
}: {
  /** This tile is part of the current selection. */
  selected?: boolean;
  /** A selection is in progress somewhere in the set — clicks toggle instead of open. */
  selecting?: boolean;
  onOpen?: () => void;
  onToggleSelect?: () => void;
  /** Accessible name for the main surface. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-selected={selected || undefined}
      data-selecting={selecting || undefined}
      className={cn(
        "group/tile relative w-full overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow] duration-150 ease-[var(--ease-out)]",
        selected
          ? "border-brand-accent/60 ring-2 ring-brand-accent/50"
          : "border-border hover:border-border-strong",
        className,
      )}
    >
      {children}
      <button
        type="button"
        aria-label={label}
        aria-pressed={selecting ? selected : undefined}
        onClick={selecting ? onToggleSelect : onOpen}
        className="absolute inset-0 z-[1] rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/50"
      />
    </div>
  );
}

/** The media frame. Children (usually an <img>) get the shared zoom/settle. */
export function MediaTileMedia({
  aspectRatio,
  className,
  children,
}: {
  aspectRatio?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div style={aspectRatio ? { aspectRatio } : undefined} className={cn("w-full bg-muted", className)}>
      <div className="size-full overflow-hidden rounded-xl transition-transform duration-500 ease-[var(--ease-out)] group-hover/tile:scale-[1.04] group-data-[selected]/tile:scale-[0.96] motion-reduce:transition-none motion-reduce:group-hover/tile:scale-100">
        {children}
      </div>
    </div>
  );
}

/** Shared reveal: hidden at rest, settles in on hover/focus, pinned while selecting. */
const reveal =
  "opacity-0 -translate-y-1 transition-[opacity,transform] duration-200 ease-[var(--ease-out)] group-hover/tile:translate-y-0 group-hover/tile:opacity-100 focus-within:translate-y-0 focus-within:opacity-100 group-data-[selecting]/tile:translate-y-0 group-data-[selecting]/tile:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none";

/** The circular selection toggle, top-left — pinned whenever a selection exists. */
export function MediaTileSelect({
  selected,
  onToggle,
  label = "Selecionar",
}: {
  selected: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <span className={cn("absolute top-2 left-2 z-[2]", reveal)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={label}
        onClick={onToggle}
        className={cn(
          "flex size-7 items-center justify-center rounded-full border outline-none transition-[background-color,border-color,transform] duration-150 ease-[var(--ease-out)] focus-visible:ring-2 focus-visible:ring-brand-accent/60 active:scale-95 motion-reduce:transform-none",
          selected
            ? "border-transparent bg-brand-accent text-white"
            : "border-white/80 bg-black/35 text-white backdrop-blur-md hover:bg-black/55",
        )}
      >
        <Check
          strokeWidth={3}
          className={cn(
            "size-3.5 transition-[opacity,transform] duration-150 ease-[var(--ease-out)]",
            selected ? "scale-100 opacity-100" : "scale-50 opacity-0",
          )}
        />
      </button>
    </span>
  );
}

/** Top-right cluster of action chips. */
export function MediaTileActions({ children }: { children: ReactNode }) {
  return (
    <div className={cn("absolute top-2 right-2 z-[2] flex items-center gap-1", reveal)}>
      {children}
    </div>
  );
}

/** One overlay action: a dark blur chip that stays legible over any artwork. */
export function MediaTileAction({
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
          "flex size-7 items-center justify-center rounded-lg bg-black/45 text-white outline-none backdrop-blur-md transition-[background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-black/65 focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95 motion-reduce:transform-none [&_svg]:size-3.5",
          className,
        )}
      >
        {children}
      </button>
    </ActionTooltip>
  );
}

/**
 * A quiet always-on corner glyph marking a tile as an exception in its set
 * (e.g. the "uploaded" mark in a grid of generations). Passive metadata, not a
 * control: one size down from the action chips, pointer-transparent, and it
 * bows out on hover as the caption arrives to say the same thing in words.
 */
export function MediaTileBadge({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="pointer-events-none absolute bottom-2 left-2 z-[1] flex size-6 items-center justify-center rounded-md bg-black/45 text-white backdrop-blur-md transition-opacity duration-200 ease-[var(--ease-out)] group-hover/tile:opacity-0 group-data-[selecting]/tile:opacity-0 motion-reduce:transition-none [&_svg]:size-3"
    >
      {children}
    </span>
  );
}

/** Bottom caption over a soft scrim — name, model, whatever the caller stacks.
 *  Mirrors the top reveal but rises from below, so the tile "opens" outward. */
export function MediaTileCaption({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] translate-y-1 bg-gradient-to-t from-black/70 to-transparent p-2.5 opacity-0 transition-[opacity,transform] duration-200 ease-[var(--ease-out)] group-hover/tile:translate-y-0 group-hover/tile:opacity-100 group-data-[selecting]/tile:translate-y-0 group-data-[selecting]/tile:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-none">
      {children}
    </div>
  );
}

// --- Shared media actions ----------------------------------------------------

/**
 * Lifecycle for a slow media action (copy, download): `busy` while the bytes
 * move, a short `done` beat for the success mark, then back to rest. Re-entry
 * is ignored while anything is in flight.
 */
export function useMediaAction(action: () => Promise<void>): {
  state: "idle" | "busy" | "done";
  run: () => void;
} {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const run = () => {
    if (state !== "idle") return;
    setState("busy");
    action()
      .then(() => {
        setState("done");
        setTimeout(() => setState("idle"), 1600);
      })
      .catch(() => setState("idle"));
  };
  return { state, run };
}

/** The icon for a `useMediaAction` button: rest icon → spinner → green check. */
export function ActionStateIcon({
  state,
  icon,
}: {
  state: "idle" | "busy" | "done";
  icon: ReactNode;
}) {
  if (state === "busy") return <Spinner />;
  if (state === "done") return <Check className="text-green" />;
  return icon;
}

/** Force-download an image (cross-origin URLs ignore the `download` attr, so
 *  the bytes are pulled into a blob first). */
export async function downloadImageFile(url: string, name?: string | null): Promise<void> {
  const blob = await (await fetch(url)).blob();
  const ext = blob.type.split("/")[1]?.split("+")[0] ?? "png";
  const safeName = (name?.trim() || "imagem").replace(/[/\\:]/g, "-");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${safeName}.${ext}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

/** Copy an image to the clipboard. The clipboard only accepts PNG, so whatever
 *  the model produced is re-encoded through a canvas. The ClipboardItem takes
 *  the pending promise directly — required by Safari, fine everywhere else. */
export async function copyImageToClipboard(url: string): Promise<void> {
  const pngBlob = (async () => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("falha ao codificar imagem"))),
        "image/png",
      ),
    );
  })();
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}
