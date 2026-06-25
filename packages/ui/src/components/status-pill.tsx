import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@vanda-studio/ui/lib/utils";

const statusPill = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.06em] whitespace-nowrap",
  {
    // Every tone carries a state — status color is never decoration.
    variants: {
      tone: {
        live: "bg-green/12 text-green", // ao vivo
        scheduled: "bg-green/12 text-green", // agendado
        done: "bg-green/12 text-green", // feito
        needs: "bg-amber/12 text-amber", // precisa de você
        creating: "bg-creating-bg text-brand-accent", // em produção
        suggestion: "bg-peri/12 text-peri", // sugestão
        neutral: "bg-inset text-text-3",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

/**
 * A status pill. The optional dot reads as a live/state indicator (e.g. "ao
 * vivo"); it inherits the tone color via `currentColor`.
 */
function StatusPill({
  tone,
  dot = false,
  className,
  children,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof statusPill> & { dot?: boolean }) {
  return (
    <span data-slot="status-pill" className={cn(statusPill({ tone }), className)} {...props}>
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export { StatusPill, statusPill };
