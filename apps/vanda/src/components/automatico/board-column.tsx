import type { ReactNode } from "react";
import { cn } from "@vanda-studio/ui/lib/utils";

type ColumnTone = "amber" | "brand" | "green" | "peri";

const DOT: Record<ColumnTone, string> = {
  amber: "bg-amber shadow-[0_0_5px] shadow-amber/60",
  brand: "bg-brand-soft shadow-[0_0_5px] shadow-brand-soft/60",
  green: "bg-green shadow-[0_0_5px] shadow-green/60",
  peri: "bg-peri shadow-[0_0_5px] shadow-peri/60",
};

/** One board column: a color-dotted header (name · count · optional action) over a scroll of cards. */
export function BoardColumn({
  name,
  count,
  tone,
  action,
  className,
  children,
}: {
  name: string;
  count: number;
  tone: ColumnTone;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex shrink-0 items-center gap-2 px-1 pt-0.5 pb-3">
        <span className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
        <span className="text-[13px] font-semibold tracking-[-0.005em] text-text-2">{name}</span>
        <span className="text-xs text-text-5">{count}</span>
        <span className="flex-1" />
        {action}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-0.5">{children}</div>
    </div>
  );
}
