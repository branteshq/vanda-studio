import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Toggle } from "@vanda-studio/ui/components/toggle";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { AutopilotOverview, AutopilotSlotView } from "../../convex/autopilotData";
import { showErrorToast } from "../error-feedback";
import {
  CaetanoFigure,
  Dots,
  stageLine,
  workStage,
  type Mood,
  type WorkStage,
} from "./caetano-at-work";
import { slotWhen } from "./format";

/** What Vanda gets when the owner wants to change the days and times. */
const CADENCE_DRAFT = "Quero mudar os dias e horários dos posts automáticos: ";

/**
 * Posts automáticos as one quiet strip above the Calendário: Caetano's face
 * and one sentence say the state, the two switches sit on the right, and posts
 * waiting for the owner follow as a thin list. Every switch is the same
 * setting the agents change with settings_set, so asking in the conversation
 * and tapping here always agree.
 */
export function AutopilotPanel({
  accountId,
  onOpen,
}: {
  accountId: Id<"accounts">;
  onOpen: (slotId: Id<"autopilotSlots">) => void;
}) {
  const overview = useQuery(api.autopilot.overview, { accountId });

  if (overview === undefined) return <div className="h-16" aria-hidden />;

  return <Strip accountId={accountId} overview={overview} onOpen={onOpen} />;
}

function useSetting<Args, Result>(run: (args: Args) => Promise<Result>) {
  const [busy, setBusy] = useState(false);

  const apply = (args: Args) => {
    setBusy(true);
    run(args)
      .catch(showErrorToast)
      .finally(() => setBusy(false));
  };

  return { busy, apply };
}

function Strip({
  accountId,
  overview,
  onOpen,
}: {
  accountId: Id<"accounts">;
  overview: AutopilotOverview;
  onOpen: (slotId: Id<"autopilotSlots">) => void;
}) {
  const enabled = useSetting(useMutation(api.autopilot.setEnabled));
  const approval = useSetting(useMutation(api.autopilot.setApproval));
  const retry = useSetting(useMutation(api.autopilot.retry));
  const stage = useStageWithDone(workStage(overview));
  const mood: Mood = !overview.enabled ? "off" : (stage?.kind ?? "idle");
  const now = Date.now();

  const waiting = overview.weeks
    .flatMap((week) => week.slots)
    .filter((slot) => slot.status === "awaiting_approval" && slot.scheduledFor > now)
    .toSorted((a, b) => a.scheduledFor - b.scheduledFor);

  return (
    <section className="flex items-end gap-4 border-b border-border pl-2">
      {/* No box: Caetano leans over the calendar's top edge, which this border is. */}
      <CaetanoFigure mood={mood} className="-mb-px size-16 sm:size-18" />
      <div className="flex min-w-0 flex-1 flex-wrap items-end gap-x-6 gap-y-2 pb-2.5">
        <div className="min-w-0 flex-1" role="status" aria-live="polite">
          <p className="text-body font-semibold">Posts automáticos</p>
          <p
            className={cn(
              "truncate text-body-sm",
              stage?.kind === "failed" ? "text-text-2" : "text-text-3",
            )}
          >
            <StatusLine overview={overview} stage={stage} />
            {stage?.kind === "failed" ? (
              <button
                type="button"
                className="ml-2 font-medium text-text underline"
                disabled={retry.busy}
                onClick={() => retry.apply({ accountId })}
              >
                Tentar de novo
              </button>
            ) : null}
          </p>
          {waiting.slice(0, 2).map((slot) => (
            <Waiting
              key={slot.slotId}
              accountId={accountId}
              slot={slot}
              onOpen={() => onOpen(slot.slotId)}
            />
          ))}
          {waiting.length > 2 ? (
            <p className="text-note text-text-4">
              e mais {waiting.length - 2} aguardando aprovação no calendário
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          {overview.enabled ? (
            <label className="hidden items-center gap-2 text-note text-text-3 sm:flex">
              Pedir aprovação
              <Toggle
                checked={overview.approval === "required"}
                disabled={approval.busy}
                onCheckedChange={(checked) => approval.apply({ required: checked })}
              />
            </label>
          ) : null}
          {overview.connected ? (
            <label className="flex items-center gap-2 text-note text-text-3">
              {overview.enabled ? "Ligado" : "Desligado"}
              <Toggle
                checked={overview.enabled}
                disabled={enabled.busy}
                onCheckedChange={(checked) => enabled.apply({ enabled: checked })}
                aria-label="Posts automáticos"
              />
            </label>
          ) : (
            <Link to="/perfil" className="text-note font-medium underline">
              Conectar Instagram
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusLine({ overview, stage }: { overview: AutopilotOverview; stage: WorkStage | null }) {
  if (!overview.connected) return <>O Caetano cuida dos seus posts toda semana.</>;

  if (!overview.enabled)
    return <>Desligado. O Caetano pode planejar, criar e publicar seus posts toda semana.</>;

  if (stage) {
    const working = stage.kind !== "done" && stage.kind !== "failed";

    return (
      <>
        {stageLine(stage)}
        {working ? <Dots /> : null}
      </>
    );
  }

  return (
    <>
      {overview.cadenceSummary} ·{" "}
      <Link to="/conversa" search={{ rascunho: CADENCE_DRAFT }} className="hover:text-text">
        mudar
      </Link>
    </>
  );
}

const STARTING = new Set<WorkStage["kind"]>(["analyzing", "planning"]);

/**
 * The live stage, plus a short "done" when the owner watched the start finish:
 * Caetano celebrates for a moment instead of silently going back to idle.
 */
function useStageWithDone(live: WorkStage | null): WorkStage | null {
  const previous = useRef(live?.kind);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const finished = previous.current !== undefined && STARTING.has(previous.current) && !live;
    previous.current = live?.kind;

    if (!finished) return;
    setDone(true);
    const timer = setTimeout(() => setDone(false), 5000);

    return () => clearTimeout(timer);
  }, [live?.kind]);

  return live ?? (done ? { kind: "done" } : null);
}

/** A post waiting for the owner: one line under the status, Aprovar inline. */
function Waiting({
  accountId,
  slot,
  onOpen,
}: {
  accountId: Id<"accounts">;
  slot: AutopilotSlotView;
  onOpen: () => void;
}) {
  const approve = useSetting(useMutation(api.autopilot.approveSlot));

  return (
    <p className="mt-1 flex min-w-0 items-center gap-2 text-body-sm">
      <span className="size-2 shrink-0 rounded-full bg-amber" aria-hidden />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 truncate text-left text-text-2 hover:text-text"
        aria-label={`Ver o post de ${slotWhen(slot)}`}
      >
        <span className="font-medium text-text">{slotWhen(slot)}</span> “{slot.hook}”
      </button>
      <button
        type="button"
        disabled={approve.busy}
        onClick={() => approve.apply({ accountId, slotId: slot.slotId })}
        className="shrink-0 font-medium text-brand-accent hover:underline"
      >
        Aprovar
      </button>
    </p>
  );
}
