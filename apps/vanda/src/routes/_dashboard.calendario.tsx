import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex-helpers/react/cache";
import { ChevronLeft, ChevronRight } from "lucide-react";
import caetanoFaceUrl from "@vanda-studio/ui/assets/caetano/work/caetano-welcome.webp?url";
import { Button } from "@vanda-studio/ui/components/button";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import { workStage } from "../components/autopilot/caetano-at-work";
import { AutopilotPanel } from "../components/autopilot/panel";
import { AutopilotPostDialogById } from "../components/autopilot/post-dialog";
import { PostPreviewDialog } from "../components/post-preview";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { CalendarItem, CalendarStatus } from "../convex/calendar";

export const Route = createFileRoute("/_dashboard/calendario")({
  component: CalendarioPage,
});

/**
 * Each post is one line: a status dot, the time, what it is about and, for
 * Caetano's automatic posts, his face. The legend below explains the dots.
 */
const STATUS_META = {
  planned: { label: "Planejado", dot: "border border-text-4" },
  generating: { label: "Criando", dot: "animate-caetano-dot bg-brand-accent" },
  awaiting_approval: { label: "Aguardando aprovação", dot: "bg-amber" },
  skipped: { label: "Pulado", dot: "border border-text-5" },
  scheduled: { label: "Agendado", dot: "bg-brand-accent" },
  publishing: { label: "Publicando", dot: "animate-caetano-dot bg-brand-accent" },
  published: { label: "Publicado", dot: "bg-green" },
  failed: { label: "Não saiu", dot: "bg-destructive" },
} satisfies Record<CalendarStatus, { label: string; dot: string }>;

const LEGEND: readonly CalendarStatus[] = [
  "planned",
  "awaiting_approval",
  "scheduled",
  "published",
  "failed",
];

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** "Outubro de 2026", capitalized only at the start. */
const monthTitle = (date: Date): string => {
  const label = date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return label.charAt(0).toUpperCase() + label.slice(1);
};

function CalendarioPage() {
  const { activeAccount } = useActiveAccount();
  const [openSlot, setOpenSlot] = useState<Id<"autopilotSlots"> | null>(null);
  const [openPost, setOpenPost] = useState<Id<"posts"> | null>(null);

  const [cursor, setCursor] = useState(() => {
    const now = new Date();

    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const monthStart = cursor.getTime();
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).getTime();

  const overview = useQuery(
    api.autopilot.overview,
    activeAccount ? { accountId: activeAccount.id } : "skip",
  );

  const stage = overview ? workStage(overview)?.kind : undefined;
  const starting = stage === "analyzing" || stage === "planning";

  const items = useQuery(
    api.calendar.range,
    activeAccount ? { accountId: activeAccount.id, start: monthStart, end: monthEnd } : "skip",
  );

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const leading = first.getDay();
    const cells: Array<{ date: Date | null; key: string }> = [];

    for (let i = 0; i < leading; i++) cells.push({ date: null, key: `lead-${i}` });

    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({
        date: new Date(cursor.getFullYear(), cursor.getMonth(), day),
        key: `day-${day}`,
      });
    }

    // Complete the last week so the grid closes as a rectangle.
    while (cells.length % 7 !== 0) cells.push({ date: null, key: `trail-${cells.length}` });

    return cells;
  }, [cursor]);

  const itemsByDay = useMemo(() => {
    const map = new Map<number, NonNullable<typeof items>>();

    for (const item of items ?? []) {
      const day = new Date(item.scheduledFor).getDate();
      map.set(day, [...(map.get(day) ?? []), item]);
    }

    return map;
  }, [items]);

  if (!activeAccount) return null;

  const today = new Date();

  const isToday = (date: Date) =>
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <header className="mb-5 flex items-center gap-2">
            <h1 className="mr-auto text-xl font-semibold tracking-tight">{monthTitle(cursor)}</h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            >
              Hoje
            </Button>
            <ActionTooltip label="Mês anterior" side="bottom">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Mês anterior"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              >
                <ChevronLeft />
              </Button>
            </ActionTooltip>
            <ActionTooltip label="Próximo mês" side="bottom">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Próximo mês"
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              >
                <ChevronRight />
              </Button>
            </ActionTooltip>
          </header>

          <div className="mt-4">
            <AutopilotPanel accountId={activeAccount.id} onOpen={setOpenSlot} />
          </div>

          <Agenda
            days={days}
            itemsByDay={itemsByDay}
            isToday={isToday}
            onOpen={(item) =>
              item.autopilot ? setOpenSlot(item.autopilot.slotId) : setOpenPost(item.postId)
            }
          />

          <div className="hidden grid-cols-7 overflow-hidden rounded-b-xl border border-t-0 border-border md:grid">
            {WEEKDAYS.map((weekday) => (
              <div
                key={weekday}
                className="border-b border-border px-2.5 py-2 text-note text-text-4"
              >
                {weekday}
              </div>
            ))}
            {days.map(({ date, key }, index) => (
              <div
                key={key}
                className={cn(
                  "min-h-28 min-w-0 border-border p-1.5",
                  index % 7 !== 6 && "border-r",
                  index < days.length - 7 && "border-b",
                )}
              >
                {date ? (
                  <>
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded-full text-note text-text-3 tabular-nums",
                        isToday(date) && "bg-brand-accent font-semibold text-primary-foreground",
                      )}
                    >
                      {date.getDate()}
                    </span>
                    <div className="mt-1 space-y-0.5">
                      {(itemsByDay.get(date.getDate()) ?? []).map((item) => {
                        const status = STATUS_META[item.status];
                        const title = entryTitle(item);

                        return (
                          <button
                            type="button"
                            key={item.key}
                            disabled={!item.autopilot && !item.postId}
                            onClick={() =>
                              item.autopilot
                                ? setOpenSlot(item.autopilot.slotId)
                                : setOpenPost(item.postId)
                            }
                            className="block w-full min-w-0 rounded-md px-1.5 py-1 text-left text-note hover:bg-surface disabled:hover:bg-transparent"
                            aria-label={`${status.label}: ${title}`}
                            title={`${status.label} · ${title}`}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className={cn("size-2 shrink-0 rounded-full", status.dot)} />
                              <span className="flex-1 text-micro text-text-3 tabular-nums">
                                {new Date(item.scheduledFor).toLocaleTimeString("pt-BR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {item.autopilot ? (
                                <img
                                  src={caetanoFaceUrl}
                                  alt=""
                                  className="size-5 shrink-0 rounded-full bg-brand-accent/15 object-contain ring-1 ring-brand-accent/30"
                                />
                              ) : null}
                            </span>
                            <span
                              className={cn(
                                "mt-0.5 line-clamp-2 leading-snug text-text-2",
                                item.status === "skipped" && "text-text-4 line-through",
                              )}
                            >
                              {title}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-note text-text-3">
            {LEGEND.map((status) => (
              <span key={status} className="inline-flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", STATUS_META[status].dot)} />
                {STATUS_META[status].label}
              </span>
            ))}
            <span className="inline-flex items-center gap-2">
              <img
                src={caetanoFaceUrl}
                alt=""
                className="size-5 rounded-full bg-brand-accent/15 object-contain ring-1 ring-brand-accent/30"
              />
              Feito pelo Caetano
            </span>
            {items !== undefined && items.length === 0 ? (
              <span className="ml-auto">
                {starting
                  ? "O Caetano está planejando; os posts aparecem aqui em alguns minutos."
                  : "Nada agendado neste mês."}
              </span>
            ) : null}
          </div>
        </div>
      </main>
      <AutopilotPostDialogById
        accountId={activeAccount.id}
        slotId={openSlot}
        onClose={() => setOpenSlot(null)}
      />
      <PostPreviewDialog
        accountId={activeAccount.id}
        postIds={(items ?? []).flatMap((item) =>
          !item.autopilot && item.postId ? [item.postId] : [],
        )}
        postId={openPost}
        onSelect={setOpenPost}
        onClose={() => setOpenPost(null)}
      />
    </div>
  );
}

type CalendarEntry = CalendarItem;

const entryTitle = (item: CalendarEntry): string =>
  item.autopilot?.hook ?? item.caption.split("\n")[0] ?? "";

/** On a phone a month grid is unreadable: the days that have posts, as a list. */
function Agenda({
  days,
  itemsByDay,
  isToday,
  onOpen,
}: {
  days: ReadonlyArray<{ date: Date | null; key: string }>;
  itemsByDay: Map<number, CalendarEntry[]>;
  isToday: (date: Date) => boolean;
  onOpen: (item: CalendarEntry) => void;
}) {
  const busy = days.flatMap(({ date }) =>
    date && itemsByDay.has(date.getDate())
      ? [{ date, items: itemsByDay.get(date.getDate())! }]
      : [],
  );

  return (
    <div className="mt-6 space-y-4 md:hidden">
      {busy.map(({ date, items }) => (
        <section key={date.getDate()}>
          <h2
            className={cn(
              "text-note font-medium text-text-3 capitalize",
              isToday(date) && "text-brand-accent",
            )}
          >
            {date.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric" })}
            {isToday(date) ? " · hoje" : ""}
          </h2>
          <ul className="mt-1.5 divide-y divide-border rounded-xl border border-border">
            {items.map((item) => {
              const status = STATUS_META[item.status];

              return (
                <li key={item.key}>
                  <button
                    type="button"
                    disabled={!item.autopilot && !item.postId}
                    onClick={() => onOpen(item)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                  >
                    <span className={cn("size-2 shrink-0 rounded-full", status.dot)} />
                    <span className="w-11 shrink-0 text-note text-text-3 tabular-nums">
                      {new Date(item.scheduledFor).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-body-sm",
                        item.status === "skipped" && "text-text-4 line-through",
                      )}
                    >
                      {entryTitle(item)}
                    </span>
                    <span className="shrink-0 text-micro text-text-4">{status.label}</span>
                    {item.autopilot ? (
                      <img
                        src={caetanoFaceUrl}
                        alt=""
                        className="size-6 shrink-0 rounded-full bg-brand-accent/15 object-contain ring-1 ring-brand-accent/30"
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
