import type { KeyboardEvent } from "react";
import { cn } from "@vanda-studio/ui/lib/utils";
import { accountModes } from "../../convex/pipeline/constants";

/** The autonomy mode — the single source of truth is `accountModes`. */
export type Mode = (typeof accountModes)[number];

const MODES: { value: Mode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "needs_approval", label: "Aprovação" },
  { value: "manual", label: "Manual" },
];

/**
 * The autonomy segmented control — how much freedom Vanda has, changeable anytime.
 * A real radiogroup: one tab stop, arrow keys move (and select) the choice.
 */
export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const index = MODES.findIndex((option) => option.value === mode);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const nextIndex = (index + delta + MODES.length) % MODES.length;
    const next = MODES[nextIndex];
    if (!next) return;
    onChange(next.value);
    const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Modo de autonomia"
      onKeyDown={onKeyDown}
      className="flex items-center gap-0.5 rounded-md border border-border bg-inset p-1"
    >
      {MODES.map((option) => {
        const selected = option.value === mode;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-7 items-center rounded-sm px-2.5 text-xs font-medium outline-none transition-colors duration-150 ease-[var(--ease-out)] focus-visible:ring-2 focus-visible:ring-ring/40",
              selected ? "bg-border-strong text-text" : "text-text-4 hover:text-text-2",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
