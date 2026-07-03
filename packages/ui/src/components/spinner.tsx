import { Loader2Icon } from "lucide-react";

import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * A loading spinner. Follows the shadcn pattern: Loader2Icon spinning on
 * currentColor, so size/color come from className (e.g. `size-5 text-text-3`).
 * Never use the brand mark as a spinner — the mark is the logo, not a state.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Carregando"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
