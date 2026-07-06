import type { LucideIcon } from "lucide-react";
import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * A column's calm empty state — the healthy default, not a void. `green` reads as
 * success ("tudo sob controle"); `muted` as a neutral prompt.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  tone = "green",
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  tone?: "green" | "muted";
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3.5 rounded-xl border border-dashed border-border px-5 py-9 text-center">
      <span
        className={cn(
          "flex size-11 items-center justify-center rounded-full",
          tone === "green"
            ? "border border-green/30 bg-green/10 text-green"
            : "border border-border bg-inset text-text-4",
        )}
      >
        <Icon className="size-5" />
      </span>
      <div>
        <div className="mb-1.5 text-sm font-semibold text-text-2">{title}</div>
        <div className="text-body-sm text-pretty text-text-4">{body}</div>
      </div>
    </div>
  );
}
