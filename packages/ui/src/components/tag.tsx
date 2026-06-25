import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@vanda-studio/ui/lib/utils";

const tag = cva(
  "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
  {
    variants: {
      // Periwinkle is the neutral-informative tone: signal categories, trends, links.
      tone: {
        signal: "bg-peri/12 text-peri",
        neutral: "bg-inset text-text-3",
        brand: "bg-brand-accent/12 text-brand-accent",
      },
    },
    defaultVariants: { tone: "signal" },
  },
);

/** A small categorical label (signal sources, trends, links) or a count badge. */
function Tag({
  tone,
  className,
  children,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof tag>) {
  return (
    <span data-slot="tag" className={cn(tag({ tone }), className)} {...props}>
      {children}
    </span>
  );
}

export { Tag, tag };
