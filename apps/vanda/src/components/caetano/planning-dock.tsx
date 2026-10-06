import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import caetanoWelcomeUrl from "@vanda-studio/ui/assets/caetano/caetano-expression-welcome.png?url";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { AutopilotOverview } from "../../convex/autopilotData";

/**
 * Caetano's planning card, pinned at the top of his chat: the source of truth
 * the conversation scrolls under. Open by default; folded it is one line
 * (state + the numbers). It lives outside the message scroller on purpose: a
 * live card inside the auto-scrolling list re-measures forever and freezes
 * the page. For the same reason it shrinks (scrolling inside) before the chat
 * below gets too short: a squeezed message scroller loops too.
 */
export function PlanningDock({
  overview,
  children,
}: {
  overview: AutopilotOverview;
  children: ReactNode;
}) {
  const waiting = overview.weeks
    .flatMap((week) => week.slots)
    .filter((slot) => slot.status === "awaiting_approval").length;

  const [open, setOpen] = useState(true);
  const week = overview.weeks[0]?.slots.filter((slot) => slot.status !== "skipped") ?? [];
  const ready = week.filter((slot) => slot.status === "scheduled" || slot.status === "published");

  return (
    <section className="flex min-h-0 shrink flex-col px-4 pt-3 md:px-6">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex w-full shrink-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-inset"
        >
          <span
            className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-accent/12"
            aria-hidden="true"
          >
            <img
              src={caetanoWelcomeUrl}
              alt=""
              className="size-8 max-w-none translate-y-0.5 object-contain"
            />
          </span>
          <span className="text-note font-semibold text-text">Planejamento</span>
          <span
            className={cn(
              "size-1.5 rounded-full",
              overview.enabled ? "bg-green" : "bg-border-strong",
            )}
            aria-label={overview.enabled ? "no controle" : "pausado"}
          />
          <span className="mr-auto truncate text-micro text-text-4">
            {ready.length}/{week.length} prontos
            {waiting > 0 ? ` · ${waiting} p/ aprovar` : ""}
            {overview.audit?.profileScore !== undefined && overview.audit?.profileScore !== null
              ? ` · nota ${overview.audit.profileScore}`
              : ""}
          </span>
          <ChevronDown
            className={cn("size-4 text-text-4 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {open ? (
          <div className="max-h-96 min-h-0 overflow-y-auto border-t border-border p-3">
            {children}
          </div>
        ) : null}
      </div>
    </section>
  );
}
