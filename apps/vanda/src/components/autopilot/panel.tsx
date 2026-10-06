import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { ImageOff } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
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
    <section className="rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-3 px-3 pt-4 pb-3 sm:pr-4">
        {/* He stands out of his circle, a little taller than the strip, so he reads at a glance. */}
        <span className="relative size-14 shrink-0">
          <span className="absolute inset-x-0 bottom-0 h-12 rounded-full bg-brand-accent/15" />
          <CaetanoFigure
            mood={mood}
            className="absolute -top-3 left-1/2 size-16 -translate-x-1/2"
          />
        </span>
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
        </div>
        {overview.enabled ? (
          <label className="hidden items-center gap-2 border-r border-border pr-4 text-note text-text-3 sm:flex">
            Pedir aprovação
            <Toggle
              checked={overview.approval === "required"}
              disabled={approval.busy}
              onCheckedChange={(checked) => approval.apply({ required: checked })}
            />
          </label>
        ) : null}
        {overview.connected ? (
          <label className="flex items-center gap-2 pl-1 text-note text-text-3">
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
      {waiting.length > 0 ? (
        <ul className="border-t border-border px-3 py-1.5">
          {waiting.map((slot) => (
            <Waiting
              key={slot.slotId}
              accountId={accountId}
              slot={slot}
              onOpen={() => onOpen(slot.slotId)}
            />
          ))}
        </ul>
      ) : null}
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
    <li className="flex items-center gap-3 py-1.5">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Ver o post de ${slotWhen(slot)}`}
      >
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-inset">
          {slot.coverUrl ? (
            <img src={slot.coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <ImageOff className="size-3.5 text-text-5" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-note">
          <span className="font-medium text-text">Aprovar · {slotWhen(slot)}</span>
          <span className="text-text-3"> “{slot.hook}”</span>
        </span>
      </button>
      <Button
        size="sm"
        disabled={approve.busy}
        onClick={() => approve.apply({ accountId, slotId: slot.slotId })}
      >
        Aprovar
      </Button>
    </li>
  );
}
