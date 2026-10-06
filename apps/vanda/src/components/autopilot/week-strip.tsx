import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { AutopilotSlotView, AutopilotWeekView } from "../../convex/autopilotData";
import { STATUS_FILL, SlidePips, purposeGroupOf } from "./visuals";

/**
 * The autopilot week as seven columns, Seg → Dom. One component for the
 * Caetano page board and the chat card, so both always look the same.
 */

const DAY = 86_400_000;

/** Monday-first, matching weekStart (São Paulo Monday 00:00). */
const COLUMNS = [
  { weekday: 1, short: "Seg" },
  { weekday: 2, short: "Ter" },
  { weekday: 3, short: "Qua" },
  { weekday: 4, short: "Qui" },
  { weekday: 5, short: "Sex" },
  { weekday: 6, short: "Sáb" },
  { weekday: 0, short: "Dom" },
] as const;

export const SLOT_STATUS = {
  planned: { label: "Planejado", tone: "suggestion" },
  generating: { label: "Gerando", tone: "creating" },
  awaiting_approval: { label: "Aguardando aceite", tone: "needs" },
  scheduled: { label: "Agendado", tone: "scheduled" },
  published: { label: "Publicado", tone: "done" },
  skipped: { label: "Pulado", tone: "neutral" },
  failed: { label: "Falhou", tone: "needs" },
} as const satisfies Record<
  AutopilotSlotView["status"],
  {
    label: string;
    tone: "suggestion" | "creating" | "scheduled" | "done" | "neutral" | "needs";
  }
>;

export const WEEKDAY_NAMES = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

/** "18h" or "18h30". */
export const hourLabel = (time: string): string => {
  const [hh = "0", mm = "00"] = time.split(":");

  return mm === "00" ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
};

export const slidesLabel = (count: number): string => (count === 1 ? "1 slide" : `${count} slides`);

/** Day of month of a column, from the São Paulo week start. */
const dayOfMonth = (weekStart: number, index: number): number =>
  new Date(weekStart + index * DAY - 3 * 3_600_000).getUTCDate();

function SlotChip({
  slot,
  size,
  selected,
  onSelect,
}: {
  slot: AutopilotSlotView;
  size: "compact" | "board";
  selected: boolean;
  onSelect?: ((slot: AutopilotSlotView) => void) | undefined;
}) {
  const status = SLOT_STATUS[slot.status];
  const group = purposeGroupOf(slot.purpose);
  const GroupIcon = group.icon;
  const dimmed = slot.status === "skipped";

  const shared = {
    type: "button" as const,
    onClick: onSelect ? () => onSelect(slot) : undefined,
    disabled: !onSelect,
    "aria-label": `${WEEKDAY_NAMES[slot.weekday]} ${hourLabel(slot.time)}, ${slidesLabel(slot.slideCount)}, ${slot.purposeLabel}, ${status.label}: ${slot.hook}`,
  };

  const frame = cn(
    "flex w-full flex-col rounded-md border border-border bg-surface text-left transition-colors",
    onSelect && "hover:border-border-strong hover:bg-inset",
    selected && "border-brand-accent ring-2 ring-brand-accent/30",
    dimmed && "opacity-50",
  );

  // The planning board: everything the plan says about the post, readable.
  if (size === "board") {
    return (
      <button {...shared} className={cn(frame, "gap-1.5 p-1.5")}>
        {slot.coverUrl ? (
          <img
            src={slot.coverUrl}
            alt=""
            className="aspect-4/5 w-full rounded-sm bg-inset object-cover"
          />
        ) : (
          <span className="grid aspect-4/5 w-full place-items-center rounded-sm bg-inset">
            <GroupIcon className="size-6 text-text-5" aria-hidden="true" />
          </span>
        )}
        <span className="flex items-center justify-between gap-1">
          <span className="text-body font-semibold text-text">{hourLabel(slot.time)}</span>
          <SlidePips count={slot.slideCount} type={slot.type} />
        </span>
        <span className="flex min-w-0 items-center gap-1 text-caption text-text-3">
          <GroupIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{slot.purposeLabel}</span>
        </span>
        <span className="line-clamp-3 text-note leading-snug text-text-2">“{slot.hook}”</span>
        <StatusPill tone={status.tone} className="self-start">
          {status.label}
        </StatusPill>
      </button>
    );
  }

  return (
    <button
      {...shared}
      title={`“${slot.hook}” · ${slot.purposeLabel}`}
      className={cn(frame, "gap-1 p-1")}
    >
      {slot.coverUrl ? (
        <img
          src={slot.coverUrl}
          alt=""
          className="aspect-4/5 w-full rounded-sm bg-inset object-cover"
        />
      ) : null}
      <span className="flex items-center justify-between gap-1">
        <span className="text-note font-semibold text-text">{hourLabel(slot.time)}</span>
        <span
          className={cn("size-2 shrink-0 rounded-full", STATUS_FILL[slot.status])}
          aria-hidden="true"
        />
      </span>
      <span className="flex items-center justify-between gap-1">
        <SlidePips count={slot.slideCount} type={slot.type} />
        <GroupIcon className="size-3 shrink-0 text-text-4" aria-hidden="true" />
      </span>
    </button>
  );
}

export function WeekStrip({
  week,
  size = "compact",
  selectedSlotId,
  onSelectSlot,
  className,
}: {
  week: AutopilotWeekView;
  size?: "compact" | "board";
  selectedSlotId?: string | null | undefined;
  onSelectSlot?: ((slot: AutopilotSlotView) => void) | undefined;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border",
        className,
      )}
    >
      {COLUMNS.map((column, index) => {
        const slots = week.slots.filter((slot) => slot.weekday === column.weekday);

        return (
          <div
            key={column.weekday}
            className={cn(
              "flex min-w-0 flex-col bg-app",
              size === "board" ? "min-h-64 gap-2 p-1.5" : "min-h-20 gap-1 p-1",
              slots.length === 0 && "bg-inset/40",
            )}
          >
            <span
              className={cn(
                "px-0.5 text-center font-mono tracking-wide uppercase",
                size === "board" ? "text-caption" : "text-micro",
                slots.length > 0 ? "text-text-3" : "text-text-5",
              )}
            >
              {column.short} {dayOfMonth(week.weekStart, index)}
            </span>
            {slots.map((slot) => (
              <SlotChip
                key={slot.slotId}
                slot={slot}
                size={size}
                selected={selectedSlotId === slot.slotId}
                onSelect={onSelectSlot}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
