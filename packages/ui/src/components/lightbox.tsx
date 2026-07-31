"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight, XIcon } from "lucide-react";

import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * Lightbox — the fullscreen media viewer shell: a dark backdrop, a large media
 * area, and a floating details panel, t3-style. Purely presentational; callers
 * compose `LightboxMedia` + `LightboxPanel` inside `LightboxContent` and own
 * every pixel of the panel.
 *
 * The popup covers the screen but is pointer-transparent — only the media, the
 * panel, and the chrome accept the pointer — so clicks in the empty space fall
 * through to the backdrop and dismiss, the native lightbox gesture.
 */

function Lightbox({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="lightbox" {...props} />;
}

function LightboxContent({
  className,
  children,
  label,
  onPrev,
  onNext,
  ...props
}: DialogPrimitive.Popup.Props & {
  /** Accessible name for the dialog (rendered as an sr-only title). */
  label?: string | undefined;
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="lightbox-overlay"
        className="fixed inset-0 isolate z-50 bg-black/80 transition-opacity duration-200 ease-[var(--ease-out)] supports-backdrop-filter:backdrop-blur-sm data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none"
      />
      <DialogPrimitive.Popup
        data-slot="lightbox-content"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" && onPrev) {
            event.preventDefault();
            onPrev();
          } else if (event.key === "ArrowRight" && onNext) {
            event.preventDefault();
            onNext();
          }
        }}
        className={cn(
          "pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4 outline-none md:p-6 lg:p-10",
          "transition-[opacity,transform] duration-200 ease-[var(--ease-out)] data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0 motion-reduce:transform-none motion-reduce:transition-opacity",
          className,
        )}
        {...props}
      >
        {label ? <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title> : null}
        {children}
        {onPrev ? <LightboxNav direction="prev" onClick={onPrev} /> : null}
        {onNext ? <LightboxNav direction="next" onClick={onNext} /> : null}
        <DialogPrimitive.Close
          data-slot="lightbox-close"
          aria-label="Fechar"
          className="pointer-events-auto absolute top-4 right-4 flex size-9 items-center justify-center rounded-full border border-border bg-surface/90 text-text-3 outline-none backdrop-blur-sm transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] hover:bg-muted hover:text-text focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:transform-none"
        >
          <XIcon className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

/**
 * The media area. It shrink-wraps its media, so a `LightboxPanel` placed inside
 * rides its right edge — same top, same bottom, fixed gap — and the whole
 * cluster (media + panel) centers on screen as one connected unit. When a panel
 * is present, its column is reserved so the pair centers together.
 */
function LightboxMedia({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="lightbox-media"
      className={cn(
        "relative flex max-h-full min-h-0 w-full min-w-0 flex-col items-center justify-center md:w-auto",
        "has-[[data-slot=lightbox-panel]]:md:mr-84 has-[[data-slot=lightbox-panel]]:lg:mr-100",
        "[&>*]:pointer-events-auto",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * The details panel. Inside `LightboxMedia` it docks to the media's right edge
 * and matches its exact height (content scrolls internally); on mobile it flows
 * beneath the media instead.
 */
function LightboxPanel({ className, children, ...props }: React.ComponentProps<"aside">) {
  return (
    <aside
      data-slot="lightbox-panel"
      className={cn(
        "pointer-events-auto mt-3 flex max-h-[40vh] w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg",
        "md:absolute md:inset-y-0 md:left-full md:mt-0 md:ml-4 md:max-h-none md:w-80 lg:w-96",
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

/** Edge navigation arrow. Rendered automatically by LightboxContent. */
function LightboxNav({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  const prev = direction === "prev";
  return (
    <button
      type="button"
      data-slot="lightbox-nav"
      aria-label={prev ? "Anterior" : "Próxima"}
      onClick={onClick}
      className={cn(
        "pointer-events-auto absolute top-1/2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface/90 text-text-3 outline-none backdrop-blur-sm transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] hover:bg-muted hover:text-text focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:transform-none md:flex",
        prev ? "left-4" : "right-4",
      )}
    >
      {prev ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
    </button>
  );
}

export { Lightbox, LightboxContent, LightboxMedia, LightboxNav, LightboxPanel };
