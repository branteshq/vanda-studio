import { Link2, Sparkles, X } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { PlanCard as PlanCardData } from "../../convex/board";
import { ConfidenceBar } from "./confidence-bar";
import { confidencePct, formatTag } from "./meta";

type CardId = PlanCardData["id"];

/**
 * A plan card — one composed idea. Its treatment reads its status at a glance:
 * `needs_you` wears the amber "precisa de você" surface, `creating` the magenta
 * "Vanda fazendo" surface with a live progress bar. The body opens the lineage;
 * `actionable` cards carry the three per-item intents. `primary` follows the mode:
 * Vanda-led (auto/aprovação) leads with "Vanda faz"; Manual leads with "Eu faço".
 */
export function PlanCard({
  card,
  actionable = true,
  primary = "vanda",
  onDelegate,
  onTakeOver,
  onDismiss,
  onOpen,
}: {
  card: PlanCardData;
  actionable?: boolean;
  primary?: "vanda" | "voce";
  onDelegate: (id: CardId) => void;
  onTakeOver: (id: CardId) => void;
  onDismiss: (id: CardId) => void;
  onOpen: (id: CardId) => void;
}) {
  const isCreating = card.status === "creating";
  const isNeedsYou = card.status === "needs_you";

  const vandaFaz = (
    <Button
      variant={primary === "vanda" ? "soft" : "ghost"}
      size="sm"
      onClick={() => onDelegate(card.id)}
    >
      Vanda faz
    </Button>
  );
  const euFaco = (
    <Button
      variant={primary === "voce" ? "soft" : "ghost"}
      size="sm"
      onClick={() => onTakeOver(card.id)}
    >
      Eu faço
    </Button>
  );

  return (
    <div
      className={cn(
        "group rounded-lg border p-3 transition-colors duration-150 ease-[var(--ease-out)]",
        isNeedsYou && "border-needs-border bg-needs-bg",
        isCreating && "border-creating-border bg-creating-bg",
        !isNeedsYou && !isCreating && "border-border bg-surface hover:border-border-strong",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(card.id)}
        className="block w-full cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <div className="mb-2.5 flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.06em] text-text-5">
            {formatTag(card.format)}
          </span>
          <span className="flex-1" />
          <Sparkles className="size-3 text-brand-soft" />
        </div>
        <p className="mb-2.5 line-clamp-2 text-[13.5px] font-medium leading-[1.4] text-pretty text-text">
          {card.title}
        </p>
        {card.belief ? (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-peri/20 bg-peri/8 px-2 py-1 text-[10.5px] text-peri">
            <Link2 className="size-3 shrink-0" />
            <span className="truncate">
              crença: {card.belief.statement} · {confidencePct(card.belief.confidence)}%
            </span>
          </span>
        ) : null}
      </button>

      {isCreating ? (
        <div className="mt-2.5 flex items-center gap-2">
          <ConfidenceBar value={card.progress ?? 0} tone="brand" />
          <span className="inline-flex shrink-0 items-center gap-1 text-[10.5px] text-brand-soft">
            <Spinner className="size-3" />
            {confidencePct(card.progress ?? 0)}%
          </span>
        </div>
      ) : actionable ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          {primary === "voce" ? euFaco : vandaFaz}
          {primary === "voce" ? vandaFaz : euFaco}
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dispensar ideia"
            onClick={() => onDismiss(card.id)}
          >
            <X />
          </Button>
        </div>
      ) : (
        <div className="mt-2.5 font-mono text-[10px] tracking-[0.1em] text-text-5 uppercase">
          na fila da Vanda
        </div>
      )}
    </div>
  );
}
