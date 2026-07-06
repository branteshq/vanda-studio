import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * A thin confidence/progress bar. `peri` grounds beliefs (what Vanda knows);
 * `brand` tracks a create in flight (Vanda fazendo). Fills via a compositor-only
 * scaleX so a recomputed confidence visibly settles without a layout tween.
 */
export function ConfidenceBar({
  value,
  tone = "peri",
}: {
  value: number;
  tone?: "peri" | "brand";
}) {
  const fraction = Math.max(0, Math.min(1, value));
  return (
    <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
      <div
        className={cn(
          "h-full origin-left rounded-full transition-transform duration-500 ease-[var(--ease-out)] motion-reduce:transition-none",
          tone === "brand" ? "bg-brand-accent" : "bg-peri",
        )}
        style={{ transform: `scaleX(${fraction})` }}
      />
    </div>
  );
}
