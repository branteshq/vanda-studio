import { createFileRoute } from "@tanstack/react-router";
import { GalleryHorizontalEnd } from "lucide-react";

export const Route = createFileRoute("/_dashboard/galeria")({
  component: GalleryPage,
});

/**
 * Gallery shell. The sidebar link is live now; the project/media experience is
 * intentionally the next slice after the conversation surface is settled.
 */
function GalleryPage() {
  return (
    <main className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-xl border border-border bg-surface text-text-3">
          <GalleryHorizontalEnd className="size-5" />
        </span>
        <h1 className="mt-4 text-base font-semibold text-text">Galeria</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-text-4">
          Seus carrosséis e mídias vão aparecer aqui.
        </p>
      </div>
    </main>
  );
}
