import { cn } from "@vanda-studio/ui/lib/utils";

/** A 3-bar salience glyph — how much weight the consolidate step gave a signal. */
export function SalienceMeter({ value }: { value: number | null }) {
  const level = value === null ? 1 : value >= 0.66 ? 3 : value >= 0.33 ? 2 : 1;
  return (
    <span className="flex h-3.5 shrink-0 items-end gap-[2px] pt-0.5" aria-hidden>
      {[4, 8, 12].map((height, i) => (
        <span
          key={height}
          className={cn("w-[3px] rounded-[1px]", i < level ? "bg-peri" : "bg-border-strong")}
          style={{ height: `${height}px` }}
        />
      ))}
    </span>
  );
}
