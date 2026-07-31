import { useState } from "react";
import { useMutation } from "convex/react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from "../convex/imageModels";

const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;
type AspectRatio = (typeof ASPECT_RATIOS)[number];

const MAX_FANOUT = 12;

/**
 * The image generator, rendered inside the sidebar when the app is in gallery
 * mode (the thread list's counterpart). Fans generation out through
 * `gallery.generate`; results stream into the grid on the /galeria surface.
 */
export function GalleryComposer({ accountId }: { accountId: Id<"accounts"> }) {
  const generate = useMutation(api.gallery.generate);
  const [prompt, setPrompt] = useState("");
  const [models, setModels] = useState<Set<string>>(new Set([DEFAULT_IMAGE_MODEL]));
  const [aspect, setAspect] = useState<AspectRatio>("1:1");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);

  const total = models.size * count;
  const canGenerate = prompt.trim().length > 0 && models.size > 0 && total <= MAX_FANOUT && !busy;

  const toggleModel = (id: string) =>
    setModels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const run = async () => {
    if (!canGenerate) return;
    setBusy(true);
    try {
      await generate({
        accountId,
        prompt: prompt.trim(),
        modelIds: [...models],
        aspectRatio: aspect,
        count,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col group-data-[collapsible=icon]:hidden">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pt-2 pb-4">
        <div>
          <label className="mb-1.5 block text-note font-semibold uppercase tracking-wide text-sidebar-foreground/50">
            Prompt
          </label>
          <textarea
            id="gallery-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            placeholder="Descreva a imagem que você quer criar…"
            className="w-full resize-none rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-2 text-body text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40 focus-visible:ring-2 focus-visible:ring-brand-accent/40"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-note font-semibold uppercase tracking-wide text-sidebar-foreground/50">
              Modelos
            </span>
            <span className="text-note text-sidebar-foreground/50">
              {models.size} ativo{models.size === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-2">
            {IMAGE_MODELS.map((model) => {
              const active = models.has(model.id);
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => toggleModel(model.id)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-brand-accent/60 bg-brand-accent/10"
                      : "border-sidebar-border bg-sidebar-accent/40 hover:border-sidebar-foreground/25",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-body font-medium text-sidebar-foreground">
                        {model.label}
                      </span>
                      <span className="text-note text-sidebar-foreground/45">
                        {model.priceTier}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-note text-sidebar-foreground/45">
                      {model.blurb}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      active
                        ? "border-brand-accent bg-brand-accent text-white"
                        : "border-sidebar-foreground/25",
                    )}
                  >
                    {active && <Check className="size-3" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-note font-semibold uppercase tracking-wide text-sidebar-foreground/50">
            Proporção
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            {ASPECT_RATIOS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setAspect(value)}
                className={cn(
                  "rounded-lg border py-2 text-body-sm font-medium transition-colors",
                  aspect === value
                    ? "border-brand-accent/60 bg-brand-accent/10 text-sidebar-foreground"
                    : "border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground/50 hover:border-sidebar-foreground/25",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-note font-semibold uppercase tracking-wide text-sidebar-foreground/50">
            Imagens por modelo
          </label>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCount(value)}
                className={cn(
                  "size-9 rounded-lg border text-body font-medium transition-colors",
                  count === value
                    ? "border-brand-accent/60 bg-brand-accent/10 text-sidebar-foreground"
                    : "border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground/50 hover:border-sidebar-foreground/25",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-sidebar-border px-1 pt-3 pb-1">
        <div className="mb-2 flex items-center justify-between text-body-sm text-sidebar-foreground/50">
          <span>
            {models.size} {models.size === 1 ? "modelo" : "modelos"} × {count}
          </span>
          <span className={cn(total > MAX_FANOUT && "text-destructive")}>{total} imagens</span>
        </div>
        <Button onClick={() => void run()} disabled={!canGenerate} className="w-full gap-1.5">
          {busy ? <Spinner className="size-4" /> : <Sparkles className="size-4" />}
          Gerar {total} {total === 1 ? "imagem" : "imagens"}
        </Button>
      </div>
    </div>
  );
}
