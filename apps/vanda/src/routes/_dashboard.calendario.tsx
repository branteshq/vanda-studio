import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex-helpers/react/cache";
import { CalendarDays, ChevronLeft, ChevronRight, Layers3 } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import { api } from "../convex/_generated/api";

export const Route = createFileRoute("/_dashboard/calendario")({
  component: CalendarioPage,
});

const STATUS_META: Record<
  string,
  { label: string; tone: "scheduled" | "done" | "needs" | "creating" }
> = {
  scheduled: { label: "Agendado", tone: "scheduled" },
  publishing: { label: "Publicando", tone: "creating" },
  published: { label: "Publicado", tone: "done" },
  failed: { label: "Falhou", tone: "needs" },
};

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function CalendarioPage() {
  const { activeAccount } = useActiveAccount();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const monthStart = cursor.getTime();
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1).getTime();

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

  const monthLabel = cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const today = new Date();
  const isToday = (date: Date) =>
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-app px-4 md:px-6">
        <h1 className="mr-auto text-sm font-semibold text-text">Calendário</h1>
        <Button
          variant="outline"
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
        <span className="min-w-36 text-center text-sm font-medium text-text-2 capitalize">
          {monthLabel}
        </span>
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

      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {items !== undefined && items.length === 0 ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-surface text-text-4 shadow-sm">
              <CalendarDays className="size-5" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-text">Nada agendado neste mês</h2>
            <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-text-4">
              Quando você aprovar um carrossel na conversa com a Vanda, a publicação aparece aqui.
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-5xl">
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
              {WEEKDAYS.map((weekday) => (
                <div
                  key={weekday}
                  className="bg-surface px-2 py-1.5 text-center font-mono text-[10px] tracking-wide text-text-5 uppercase"
                >
                  {weekday}
                </div>
              ))}
              {days.map(({ date, key }) => (
                <div
                  key={key}
                  className={cn("min-h-24 bg-app p-1.5", date === null && "bg-inset/50")}
                >
                  {date ? (
                    <>
                      <span
                        className={cn(
                          "inline-flex size-5 items-center justify-center rounded-full font-mono text-[11px] text-text-4",
                          isToday(date) && "bg-brand-accent font-semibold text-primary-foreground",
                        )}
                      >
                        {date.getDate()}
                      </span>
                      <div className="mt-1 space-y-1">
                        {(itemsByDay.get(date.getDate()) ?? []).map((item) => {
                          const status = STATUS_META[item.status];
                          return (
                            <div
                              key={item.scheduledPostId}
                              className="flex items-center gap-1.5 rounded-md border border-border bg-surface p-1"
                              title={item.caption}
                            >
                              {item.coverUrl ? (
                                <img
                                  src={item.coverUrl}
                                  alt=""
                                  className="size-7 shrink-0 rounded object-cover"
                                />
                              ) : (
                                <span className="flex size-7 shrink-0 items-center justify-center rounded bg-inset text-text-5">
                                  <Layers3 className="size-3.5" />
                                </span>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[11px] leading-tight text-text-2">
                                  {new Date(item.scheduledFor).toLocaleTimeString("pt-BR", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                  {item.slideCount > 1 ? ` · ${item.slideCount} slides` : ""}
                                </p>
                                {status ? (
                                  <StatusPill tone={status.tone} className="mt-0.5">
                                    {status.label}
                                  </StatusPill>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
