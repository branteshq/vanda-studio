import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
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
 * Posts automáticos as one quiet strip above the Calendário. Caetano is the
 * switch: asleep when off, a tap wakes him (and turns it on); pausing and
 * approval are words in his status line. Every change is the same setting the
 * agents change with settings_set, so asking in the conversation and tapping
 * here always agree.
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

// How long the wake-up reaction plays before the real work stage takes over.
const WAKE_MS = 1500;

// How long a poke while awake makes him laugh.
const TICKLE_MS = 900;

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
  const [reaction, setReaction] = useState<"waking" | "tickled" | null>(null);
  const now = Date.now();

  useEffect(() => {
    if (!reaction) return;
    const timer = setTimeout(() => setReaction(null), reaction === "waking" ? WAKE_MS : TICKLE_MS);

    return () => clearTimeout(timer);
  }, [reaction]);

  const mood: Mood = reaction ?? (!overview.enabled ? "off" : (stage?.kind ?? "idle"));
  const asleep = overview.connected && !overview.enabled && !reaction;

  // Asleep, a tap wakes him (turns posts automáticos on); awake, it only makes him laugh.
  const poke = () => {
    if (!overview.connected) return;

    if (overview.enabled) {
      setReaction("tickled");

      return;
    }

    setReaction("waking");
    enabled.apply({ enabled: true });
  };

  const waiting = overview.weeks
    .flatMap((week) => week.slots)
    .filter((slot) => slot.status === "awaiting_approval" && slot.scheduledFor > now)
    .toSorted((a, b) => a.scheduledFor - b.scheduledFor);

  return (
    <section className="flex items-end gap-4 border-b border-border pl-2">
      {/* No box: Caetano leans over the calendar's top edge, which this border is. */}
      <button
        type="button"
        onClick={poke}
        disabled={!overview.connected || enabled.busy}
        title={
          asleep
            ? "Acordar o Caetano"
            : overview.enabled
              ? "Para desligar, toque em pausar"
              : undefined
        }
        aria-label={
          asleep ? "Acordar o Caetano e ligar os posts automáticos" : "Caetano, posts automáticos"
        }
        className={cn(
          "relative -mb-px shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-default",
          asleep && "hover-caetano-wobble",
        )}
      >
        <CaetanoFigure mood={mood} className="size-16 sm:size-18" />
        {asleep ? <Zzz /> : null}
      </button>
      <div className="min-w-0 flex-1 pb-2.5" role="status" aria-live="polite">
        <p className="text-body font-semibold">Posts automáticos</p>
        <p className={cn("text-body-sm", stage?.kind === "failed" ? "text-text-2" : "text-text-3")}>
          <StatusLine
            overview={overview}
            stage={reaction === "waking" ? null : stage}
            waking={reaction === "waking"}
            approvalBusy={approval.busy}
            onApproval={() => approval.apply({ required: overview.approval !== "required" })}
            onPause={() => enabled.apply({ enabled: false })}
          />
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
          {stage?.kind === "failed" ? (
            <>
              {" "}
              ·{" "}
              <button
                type="button"
                className={linkClass}
                onClick={() => enabled.apply({ enabled: false })}
              >
                pausar
              </button>
            </>
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
    </section>
  );
}

// Each "z" starts a beat after the previous one.
const ZZZ_DELAYS = ["[animation-delay:0ms]", "[animation-delay:800ms]", "[animation-delay:1600ms]"];

/** Three "z"s drifting up from a sleeping Caetano. */
function Zzz() {
  return (
    <span
      className="pointer-events-none absolute -top-1 right-1 text-note font-semibold text-text-3"
      aria-hidden
    >
      {ZZZ_DELAYS.map((delay) => (
        <span key={delay} className={cn("animate-caetano-zzz absolute opacity-0", delay)}>
          z
        </span>
      ))}
    </span>
  );
}

const linkClass = "text-text-3 underline decoration-dotted underline-offset-2 hover:text-text";

function StatusLine({
  overview,
  stage,
  waking,
  approvalBusy,
  onApproval,
  onPause,
}: {
  overview: AutopilotOverview;
  stage: WorkStage | null;
  waking: boolean;
  approvalBusy: boolean;
  onApproval: () => void;
  onPause: () => void;
}) {
  if (!overview.connected)
    return (
      <>
        O Caetano cuida dos seus posts toda semana.{" "}
        <Link to="/perfil" className={linkClass}>
          Conectar o Instagram
        </Link>
      </>
    );

  if (waking) return <>Bom dia! O Caetano está acordando…</>;

  if (!overview.enabled)
    return (
      <>
        Desligado. <span className="text-text-2">Toque no Caetano para acordá-lo</span>: ele
        planeja, cria e publica seus posts toda semana.
      </>
    );

  // Whatever he is doing, he can always be put back to sleep.
  const pause = (
    <>
      {" "}
      ·{" "}
      <button type="button" className={linkClass} onClick={onPause}>
        pausar
      </button>
    </>
  );

  if (stage) {
    const working = stage.kind !== "done" && stage.kind !== "failed";

    return (
      <>
        {stageLine(stage)}
        {working ? <Dots /> : null}
        {stage.kind === "failed" ? null : pause}
      </>
    );
  }

  return (
    <>
      {overview.cadenceSummary} ·{" "}
      <button
        type="button"
        className={linkClass}
        disabled={approvalBusy}
        onClick={onApproval}
        title={
          overview.approval === "required"
            ? "Toque para publicar sem pedir aprovação"
            : "Toque para pedir sua aprovação antes de publicar"
        }
      >
        {overview.approval === "required" ? "com aprovação" : "sem aprovação"}
      </button>{" "}
      ·{" "}
      <Link to="/conversa" search={{ rascunho: CADENCE_DRAFT }} className={linkClass}>
        mudar
      </Link>
      {pause}
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
