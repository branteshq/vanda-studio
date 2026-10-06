import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { Ban, BookOpen, Check, Heart, Pause, Play, ShieldCheck, X, Zap } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { AutopilotOverview, AutopilotSlotView } from "../../convex/autopilotData";
import {
  Meter,
  PanelSection,
  PurposeMix,
  StatTile,
  StatusBar,
  scoreTone,
} from "../autopilot/visuals";
import { WEEKDAY_NAMES, WeekStrip, hourLabel } from "../autopilot/week-strip";
import { nextWeekStart, weekStartOf } from "../../convex/pipeline/autopilot";
import { showErrorToast } from "../error-feedback";

/**
 * Caetano's planning, laid out inside his chat as a card. Every control acts
 * directly, with the same backend the chat uses (writeSetting and the
 * autopilot helpers) — nothing requires typing, and anything done here can
 * also be asked of him.
 */

const APPROVAL_MODES = [
  {
    mode: "required",
    label: "Com aceite",
    icon: ShieldCheck,
    status: "Espera seu ✓",
    dot: "bg-amber",
    hint: "Cada post espera seu ✓ para publicar. Sem aceite até o horário, não sai.",
  },
  {
    mode: "auto",
    label: "Direto",
    icon: Zap,
    status: "Publica sozinho",
    dot: "bg-green",
    hint: "Publica sozinho no horário. Dá para recusar ou pular até lá.",
  },
] as const;

/** The week toggle names weeks by where they are, not by their position in the list. */
const weekTab = (weekStart: number, label: string): string => {
  const now = Date.now();

  if (weekStart === weekStartOf(now)) return "Atual";

  return weekStart === nextWeekStart(now) ? "Próxima" : label;
};

const DONE = new Set<AutopilotSlotView["status"]>(["scheduled", "published"]);

const when = (slot: AutopilotSlotView) => `${WEEKDAY_NAMES[slot.weekday]} ${hourLabel(slot.time)}`;

const run = (action: () => Promise<void>) => {
  action().catch(showErrorToast);
};

export function AutopilotKpis({
  overview,
  onOpenSlot,
  onDetails,
}: {
  overview: AutopilotOverview;
  onOpenSlot: (slotId: Id<"autopilotSlots">) => void;
  onDetails: () => void;
}) {
  const week = overview.weeks[0];
  const active = (week?.slots ?? []).filter((slot) => slot.status !== "skipped");
  const done = active.filter((slot) => DONE.has(slot.status)).length;

  const waiting = overview.weeks
    .flatMap((item) => item.slots)
    .filter((slot) => slot.status === "awaiting_approval");

  const first = waiting[0];
  const score = overview.audit?.profileScore ?? null;

  return (
    <div className="grid grid-cols-3 gap-2">
      <StatTile
        label="Prontos"
        value={String(done)}
        suffix={`/ ${active.length}`}
        meter={{ ratio: active.length ? done / active.length : 0, tone: "good" }}
      />
      <StatTile
        label="Aprovar"
        value={String(waiting.length)}
        tone={waiting.length > 0 ? "needs" : undefined}
        onClick={first ? () => onOpenSlot(first.slotId) : undefined}
      />
      <StatTile
        label="Perfil"
        value={score === null ? "—" : String(score)}
        suffix="/100"
        meter={score === null ? undefined : { ratio: score / 100, tone: scoreTone(score) }}
        onClick={onDetails}
      />
    </div>
  );
}

/** Posts waiting for the owner: approve right here, or open one to refuse with a reason. */
function Awaiting({
  overview,
  onOpenSlot,
  onReject,
}: {
  overview: AutopilotOverview;
  onOpenSlot: (slotId: Id<"autopilotSlots">) => void;
  /** Refusing needs a reason: the chat takes it, about this post. */
  onReject: (slot: AutopilotSlotView) => void;
}) {
  const approve = useMutation(api.autopilot.approveSlot);

  const waiting = overview.weeks
    .flatMap((week) => week.slots)
    .filter((slot) => slot.status === "awaiting_approval");

  if (waiting.length === 0) return null;

  return (
    <PanelSection title="Aprovar">
      <ul className="grid gap-1.5">
        {waiting.map((slot) => (
          <li
            key={slot.slotId}
            className="flex items-center gap-2 rounded-md border border-needs-border bg-needs-bg p-1.5"
          >
            <button
              type="button"
              onClick={() => onOpenSlot(slot.slotId)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              {slot.coverUrl ? (
                <img
                  src={slot.coverUrl}
                  alt=""
                  className="aspect-4/5 w-9 rounded-sm object-cover"
                />
              ) : null}
              <span className="grid min-w-0">
                <span className="truncate text-note font-medium text-text">“{slot.hook}”</span>
                <span className="text-micro text-text-4">{when(slot)}</span>
              </span>
            </button>
            <Button
              size="icon-sm"
              aria-label={`Aprovar ${when(slot)}`}
              onClick={() =>
                run(async () => {
                  await approve({ accountId: overview.accountId, slotId: slot.slotId });
                })
              }
            >
              <Check />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={`Recusar ${when(slot)} com o motivo`}
              onClick={() => onReject(slot)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

export function PlanningPanel({
  overview,
  onOpenSlot,
  onReject,
  onDetails,
}: {
  overview: AutopilotOverview;
  onOpenSlot: (slotId: Id<"autopilotSlots">) => void;
  onReject: (slot: AutopilotSlotView) => void;
  onDetails: () => void;
}) {
  const [weekIndex, setWeekIndex] = useState(0);
  const setEnabled = useMutation(api.autopilot.setEnabled);
  const setApproval = useMutation(api.autopilot.setApproval);
  const navigate = useNavigate();
  const week = overview.weeks[weekIndex] ?? overview.weeks[0];
  const { approved, rejected } = overview.feedbackStats;
  const decided = approved + rejected;
  const { accountId } = overview;
  const currentMode = APPROVAL_MODES.find(({ mode }) => mode === overview.approval);

  return (
    <div className="grid content-start gap-5">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2.5">
        <span
          className={cn("size-2 rounded-full", overview.enabled ? "bg-green" : "bg-border-strong")}
          aria-hidden="true"
        />
        <span className="mr-auto grid min-w-0">
          <span className="text-note font-medium text-text-2">
            {overview.enabled ? "No controle" : "Pausado"}
          </span>
          <span className="truncate text-micro text-text-4">{overview.cadenceSummary}</span>
        </span>
        <Button
          size="xs"
          variant={overview.enabled ? "ghost" : "default"}
          // Pausing always works; turning on needs Instagram connected.
          disabled={!overview.enabled && !overview.connected}
          onClick={() =>
            run(async () => {
              await setEnabled({ enabled: !overview.enabled });
            })
          }
        >
          {overview.enabled ? <Pause /> : <Play />}
          {overview.enabled ? "Pausar" : "Ligar"}
        </Button>
      </div>

      <AutopilotKpis overview={overview} onOpenSlot={onOpenSlot} onDetails={onDetails} />

      <Awaiting overview={overview} onOpenSlot={onOpenSlot} onReject={onReject} />

      {week ? (
        <PanelSection
          title={`Semana ${week.label}`}
          aside={
            <span className="flex gap-0.5">
              {overview.weeks.map((item, index) => (
                <Button
                  key={item.weekStart}
                  size="xs"
                  variant={index === weekIndex ? "secondary" : "ghost"}
                  onClick={() => setWeekIndex(index)}
                >
                  {weekTab(item.weekStart, item.label)}
                </Button>
              ))}
            </span>
          }
        >
          {week.slots.length > 0 ? (
            <>
              <StatusBar slots={week.slots} />
              <WeekStrip week={week} onSelectSlot={(slot) => onOpenSlot(slot.slotId)} />
              <PurposeMix slots={week.slots} />
            </>
          ) : (
            <p className="rounded-md border border-border bg-inset/40 p-4 text-center text-note text-text-4">
              Sem posts
            </p>
          )}
        </PanelSection>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <PanelSection title="Aceite">
          <div
            role="radiogroup"
            aria-label="Aceite antes de publicar"
            className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-inset p-1"
          >
            {APPROVAL_MODES.map(({ mode, label, hint, icon: Icon }) => {
              const active = overview.approval === mode;

              return (
                <ActionTooltip key={mode} label={hint} side="top">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() =>
                      run(async () => {
                        await setApproval({ accountId, approval: mode });
                      })
                    }
                    className={cn(
                      "flex h-8 items-center justify-center gap-1.5 rounded-md text-note font-medium transition-colors",
                      active
                        ? "bg-brand-accent text-primary-foreground shadow-sm"
                        : "text-text-4 hover:bg-surface hover:text-text-2",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {label}
                  </button>
                </ActionTooltip>
              );
            })}
          </div>
          {currentMode ? (
            <span className="inline-flex items-center gap-1.5 text-micro text-text-3">
              <span className={cn("size-2 rounded-full", currentMode.dot)} aria-hidden="true" />
              {currentMode.status}
            </span>
          ) : null}
        </PanelSection>

        <PanelSection title="Aprendizado">
          {decided > 0 ? (
            <div className="grid gap-1">
              <Meter
                ratio={approved / decided}
                tone="good"
                label={`${approved} aprovados de ${decided} nos últimos ${overview.feedbackStats.windowDays} dias`}
              />
              <span className="text-micro text-text-3">
                Você aprovou{" "}
                <span className="font-medium text-text">
                  {Math.round((approved / decided) * 100)}%
                </span>{" "}
                ({approved} de {decided}) nos últimos {overview.feedbackStats.windowDays} dias
              </span>
            </div>
          ) : null}
          {overview.learned.length > 0 ? (
            <ul className="grid gap-1">
              {overview.learned.slice(0, 3).map((item) => {
                const Icon = item.section === "Nunca fazer" ? Ban : Heart;

                return (
                  <li
                    key={item.text}
                    className="flex items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5"
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        item.section === "Nunca fazer" ? "text-destructive" : "text-brand-accent",
                      )}
                      aria-label={item.section}
                    />
                    <span className="min-w-0 text-note text-text-2">{item.text}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-micro text-text-4">
              Recuse um post dizendo o motivo: o que valer para todos vai para o arquivo da marca.
            </p>
          )}
          <Button
            variant="ghost"
            size="xs"
            className="justify-self-start"
            onClick={() => void navigate({ to: "/perfil", search: { marca: accountId } })}
          >
            <BookOpen /> Arquivo da marca
            {overview.learned.length > 3 ? ` (+${overview.learned.length - 3})` : ""}
          </Button>
        </PanelSection>
      </div>

      <Button variant="outline" size="sm" onClick={onDetails}>
        Diagnóstico
      </Button>
    </div>
  );
}
