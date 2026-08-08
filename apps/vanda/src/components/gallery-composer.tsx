import { useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { tierOfPlan } from "../convex/billing/plans";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  IMAGE_RESOLUTIONS,
  sharedResolutions,
  type ImageResolution,
} from "../convex/imageModels";

/** Conectado subscribers paint exclusively with GPT Image 2 (their ChatGPT). */
const CONNECTED_ONLY_MODEL = "openai/gpt-image-2";

const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"] as const;
type AspectRatio = (typeof ASPECT_RATIOS)[number];

// Mini-rectangle geometry (px) per ratio, drawn as an icon so orientation reads
// at a glance — the shape is iconography, not layout, hence inline dimensions.
const ASPECT_ICON: Record<AspectRatio, { w: number; h: number }> = {
  "1:1": { w: 16, h: 16 },
  "4:5": { w: 13, h: 16 },
  "9:16": { w: 9, h: 16 },
  "16:9": { w: 16, h: 9 },
};

const MAX_FANOUT = 12;

const RESOLUTION_LABEL: Record<ImageResolution, string> = {
  "1K": "Padrão",
  "2K": "Alta",
  "4K": "Ultra",
};

/**
 * The image generator, rendered inside the sidebar when the app is in gallery
 * mode (the thread list's counterpart). Fans generation out through
 * `gallery.generate` — one image per selected model — and the results stream
 * into the grid on the /galeria surface.
 */
export function GalleryComposer({ accountId }: { accountId: Id<"accounts"> }) {
  const generate = useMutation(api.gallery.generate);
  const summary = useQuery(api.usage.summary);
  const connectedOnly = summary?.plan != null && tierOfPlan(summary.plan) === "conectado";
  const availableModels = connectedOnly
    ? IMAGE_MODELS.filter((model) => model.id === CONNECTED_ONLY_MODEL)
    : IMAGE_MODELS;
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set([DEFAULT_IMAGE_MODEL]));
  const [aspect, setAspect] = useState<AspectRatio>("1:1");
  const [resolution, setResolution] = useState<ImageResolution>("1K");
  const [busy, setBusy] = useState(false);
  // The backend forces gpt-image-2 for Conectado anyway; the picker mirrors it.
  const models = connectedOnly ? new Set([CONNECTED_ONLY_MODEL]) : selected;
  const setModels = setSelected;

  const total = models.size;
  const canGenerate = prompt.trim().length > 0 && total > 0 && total <= MAX_FANOUT && !busy;

  // Tiers every selected model supports. The choice is kept non-destructively:
  // picking 4K, then adding a 1K-only model, degrades the EFFECTIVE tier to the
  // best shared one — and springs back to 4K when that model leaves again.
  const allowedResolutions = sharedResolutions(models);
  let effectiveResolution: ImageResolution = "1K";
  for (let i = IMAGE_RESOLUTIONS.indexOf(resolution); i >= 0; i -= 1) {
    const tier = IMAGE_RESOLUTIONS[i]!;
    if (allowedResolutions.includes(tier)) {
      effectiveResolution = tier;
      break;
    }
  }

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
        resolution: effectiveResolution,
        count: 1,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col group-data-[collapsible=icon]:hidden">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pt-2 pb-4">
        <div>
          <label className="section-label mb-1.5 block text-sidebar-foreground/75">Prompt</label>
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
          <span className="section-label mb-1.5 block text-sidebar-foreground/75">Modelos</span>
          <div className="space-y-2">
            {availableModels.map((model) => {
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
                      <span className="text-note font-semibold text-green">{model.priceTier}</span>
                    </span>
                    <span className="mt-0.5 block text-note text-sidebar-foreground/45">
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
          <label className="section-label mb-1.5 block text-sidebar-foreground/75">Proporção</label>
          <div className="grid grid-cols-4 gap-1.5">
            {ASPECT_RATIOS.map((value) => {
              const active = aspect === value;
              const dims = ASPECT_ICON[value];
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAspect(value)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border py-2.5 transition-colors",
                    active
                      ? "border-brand-accent/60 bg-brand-accent/10 text-sidebar-foreground"
                      : "border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground/45 hover:border-sidebar-foreground/25",
                  )}
                >
                  <span className="flex h-4 items-center justify-center">
                    <span
                      style={{ width: dims.w, height: dims.h }}
                      className="rounded-sm border border-current"
                    />
                  </span>
                  <span className="text-note font-medium">{value}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="section-label mb-1.5 block text-sidebar-foreground/75">
            Resolução
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {IMAGE_RESOLUTIONS.map((tier) => {
              const supported = allowedResolutions.includes(tier);
              const active = effectiveResolution === tier;
              // Which of the selected models cap this tier out.
              const blockers = IMAGE_MODELS.filter(
                (model) => models.has(model.id) && !model.resolutions.includes(tier),
              ).map((model) => model.label);
              const button = (
                <button
                  key={tier}
                  type="button"
                  aria-disabled={!supported}
                  aria-pressed={active}
                  onClick={() => supported && setResolution(tier)}
                  className={cn(
                    "flex w-full flex-col items-center gap-0.5 rounded-lg border py-2.5 transition-colors",
                    active
                      ? "border-brand-accent/60 bg-brand-accent/10 text-sidebar-foreground"
                      : "border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground/45",
                    supported
                      ? !active && "hover:border-sidebar-foreground/25"
                      : "cursor-not-allowed opacity-40",
                  )}
                >
                  <span className="text-body font-medium">{RESOLUTION_LABEL[tier]}</span>
                  <span className="text-note">{tier}</span>
                </button>
              );
              // Kept clickable-looking enough to explain itself: hovering a
              // gated tier names the models that don't support it.
              return supported ? (
                button
              ) : (
                <ActionTooltip key={tier} label={`Sem suporte: ${blockers.join(", ")}`} side="top">
                  {button}
                </ActionTooltip>
              );
            })}
          </div>
        </div>
      </div>

      <div className="px-1 pt-3 pb-1">
        <Button
          onClick={() => void run()}
          disabled={!canGenerate}
          variant="ghost"
          className="h-11 w-full gap-2 border border-sidebar-primary-soft-border bg-sidebar-primary-soft font-semibold text-sidebar-foreground hover:bg-sidebar-primary-soft hover:brightness-110 active:bg-sidebar-primary-soft"
        >
          {busy ? <Spinner className="size-4" /> : <Sparkles className="size-4" />}
          Gerar {total} {total === 1 ? "imagem" : "imagens"}
        </Button>
      </div>
    </div>
  );
}
