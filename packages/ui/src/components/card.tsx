import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@vanda-studio/ui/lib/utils";

const card = cva("rounded-lg border", {
  variants: {
    // needs/creating tint from the status colors so a card's state reads at a glance.
    variant: {
      base: "border-border bg-surface",
      inset: "border-border bg-inset",
      needs: "border-needs-border bg-needs-bg", // precisa de você
      creating: "border-creating-border bg-creating-bg", // em produção
    },
  },
  defaultVariants: { variant: "base" },
});

function Card({ variant, className, ...props }: ComponentProps<"div"> & VariantProps<typeof card>) {
  return <div data-slot="card" className={cn(card({ variant }), className)} {...props} />;
}

export { Card, card };
