import { Calendar, Link2 } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";
import type { ScheduledCard as ScheduledCardData } from "../../convex/board";
import { confidencePct, formatTag, scheduleLabel } from "./meta";

/** An Agendado card — a post pinned to a datetime; opens its lineage when it has provenance. */
export function AgendadoCard({
  card,
  onOpen,
}: {
  card: ScheduledCardData;
  onOpen: (id: Id<"suggestions">) => void;
}) {
  const suggestionId = card.suggestionId;
  const body = (
    <>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="font-mono text-micro tracking-widest text-text-5">
          {formatTag(card.format)}
        </span>
        {card.status === "publishing" ? (
          <span className="font-mono text-tiny tracking-widest text-brand-soft uppercase">
            publicando
          </span>
        ) : null}
      </div>
      <p className="mb-2.5 line-clamp-2 text-card-title font-medium text-pretty text-text">
        {card.title}
      </p>
      {card.belief ? (
        <span className="mb-2.5 inline-flex max-w-full items-center gap-1.5 rounded-sm border border-peri/20 bg-peri/8 px-2 py-1 text-fine text-peri">
          <Link2 className="size-3 shrink-0" />
          <span className="truncate">
            crença: {card.belief.statement} · {confidencePct(card.belief.confidence)}%
          </span>
        </span>
      ) : null}
      <div className="flex items-center gap-1.5 text-caption text-text-4">
        <Calendar className="size-3.5 text-text-5" />
        {scheduleLabel(card.scheduledFor)}
      </div>
    </>
  );

  if (suggestionId === null) {
    return <div className="rounded-lg border border-border bg-surface p-3">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(suggestionId)}
      className="block w-full cursor-pointer rounded-lg border border-border bg-surface p-3 text-left outline-none transition-colors duration-150 ease-[var(--ease-out)] hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {body}
    </button>
  );
}
