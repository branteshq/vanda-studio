import { Loader2Icon } from "lucide-react";

import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * A loading spinner. Follows the shadcn pattern: Loader2Icon spinning on
 * currentColor, so size/color come from className (e.g. `size-5 text-text-3`).
 * Never use the brand mark as a spinner — the mark is the logo, not a state.
 */
function Spinner({
  className,
  variant,
  ...props
}: React.ComponentProps<"svg"> & { variant?: "thread" }) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Carregando"
      className={cn(
        "size-4 animate-spin",
        variant === "thread" &&
          "transition-opacity duration-100 group-hover/thread:opacity-0 group-focus-within/thread:opacity-0 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

export { Spinner };
