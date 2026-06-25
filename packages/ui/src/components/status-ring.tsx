import type { ComponentProps } from "react";

import { cn } from "@vanda-studio/ui/lib/utils";

type RingState = "done" | "active" | "pending";

/**
 * A Linear-style status ring: done (filled green + check), active (brand ring +
 * core), pending (muted dashed ring). Colors come from tokens via currentColor.
 */
function StatusRing({
  state = "pending",
  className,
  ...props
}: ComponentProps<"svg"> & { state?: RingState }) {
  if (state === "done") {
    return (
      <svg
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
        className={cn("size-3.5 shrink-0 text-green", className)}
        {...props}
      >
        <circle cx="7" cy="7" r="7" fill="currentColor" />
        <path
          d="M4.1 7.1 6 9l3.8-4"
          className="stroke-app"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === "active") {
    return (
      <svg
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
        className={cn("size-3.5 shrink-0 text-brand-accent", className)}
        {...props}
      >
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="7" cy="7" r="2.6" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      className={cn("size-3.5 shrink-0 text-text-5", className)}
      {...props}
    >
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2.4" />
    </svg>
  );
}

export { StatusRing };
