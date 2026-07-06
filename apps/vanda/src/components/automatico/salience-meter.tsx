import { cn } from "@vanda-studio/ui/lib/utils";

const BARS = ["h-1", "h-2", "h-3"] as const;

/** A 3-bar salience glyph — how much weight the consolidate step gave a signal. */
export function SalienceMeter({ value }: { value: number | null }) {
  const level = value === null ? 1 : value >= 0.66 ? 3 : value >= 0.33 ? 2 : 1;
  return (
    <span className="flex h-3.5 shrink-0 items-end gap-0.5 pt-0.5" aria-hidden>
      {BARS.map((height, index) => (
        <span
          key={height}
          className={cn("w-0.5 rounded-sm", height, index < level ? "bg-peri" : "bg-border-strong")}
        />
      ))}
    </span>
  );
}
