import { Brain, Layers } from "lucide-react";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { LearnedBelief, NotableSignal, ObservingSnapshot } from "../../convex/board";
import { ConfidenceBar } from "./confidence-bar";
import { SalienceMeter } from "./salience-meter";
import { SIGNAL_META, confidencePct, relativeTime } from "./meta";

const HINT_LABEL: Record<string, string> = {
  idea: "→ 1 ideia",
  agenda: "→ agenda",
  needs_you: "→ precisa de você",
};

function SignalRow({ signal }: { signal: NotableSignal }) {
  const meta = SIGNAL_META[signal.source];
  const Icon = meta.icon;
  return (
    <div className="flex gap-2.5 rounded-[10px] border border-border bg-surface px-[11px] py-[9px]">
      <SalienceMeter value={signal.salience} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5">
          <Icon className={cn("size-3 shrink-0", meta.tone)} />
          <span className={cn("text-[10px] font-semibold", meta.tone)}>{meta.label}</span>
          <span className="flex-1" />
          <span className="font-mono text-[10px] text-text-5">
            {relativeTime(signal.observedAt)}
          </span>
        </div>
        <p className="line-clamp-2 text-[11.5px] leading-[1.4] text-text-3">
          {signal.authorHandle ? (
            <span className="text-text-2">@{signal.authorHandle}: </span>
          ) : null}
          {signal.text}
        </p>
      </div>
    </div>
  );
}

function BeliefCard({ belief }: { belief: LearnedBelief }) {
  return (
    <div className="rounded-[11px] border border-border bg-surface p-3">
      <p className="mb-2.5 text-[12.5px] font-medium leading-[1.4] text-pretty text-text">
        {belief.statement}
      </p>
      <div className="mb-2.5 flex items-center gap-2.5">
        <ConfidenceBar value={belief.confidence} tone="peri" />
        <span className="font-mono text-[10px] text-peri">{confidencePct(belief.confidence)}%</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-text-4">
        <Layers className="size-3 shrink-0 text-text-6" />
        de {belief.signalCount} {belief.signalCount === 1 ? "sinal" : "sinais"}
        {belief.hint ? (
          <>
            <span className="flex-1" />
            <span className="text-text-3">{HINT_LABEL[belief.hint]}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The Observando rail: the raw context Vanda watches (the salient signals + a
 * routine rollup) over "O que aprendi" — the beliefs those signals produced. The
 * window into the autonomous system: signal above, decoration below.
 */
export function ObservingRail({ data }: { data: ObservingSnapshot | undefined }) {
  return (
    <aside className="flex w-[348px] shrink-0 flex-col overflow-hidden border-l border-border bg-app">
      <div className="flex items-center gap-2 px-[18px] pt-4 pb-2.5">
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-text-5">OBSERVANDO</span>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 font-mono text-[9.5px] text-green">
          <span className="size-[5px] rounded-full bg-green shadow-[0_0_4px] shadow-green motion-safe:animate-pulse" />
          {data?.totalToday ?? 0} hoje
        </span>
      </div>
      <div className="flex shrink-0 flex-col gap-[7px] px-3.5 pb-2.5">
        {data?.notable.map((signal) => (
          <SignalRow key={signal.id} signal={signal} />
        ))}
        {data && data.routineCount > 0 ? (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-dashed border-border px-[11px] py-[9px]">
            <Layers className="size-3.5 shrink-0 text-text-6" />
            <span className="flex-1 text-[11.5px] text-text-4">
              +{data.routineCount} sinais rotineiros agrupados
            </span>
            <span className="text-[10px] text-text-6">sem ação</span>
          </div>
        ) : null}
        {data && data.notable.length === 0 && data.routineCount === 0 ? (
          <p className="px-1 py-2 text-[11.5px] text-text-5">A Vanda está começando a observar…</p>
        ) : null}
      </div>
      <div className="mx-3.5 my-1.5 h-px bg-border" />
      <div className="flex items-center gap-2 px-[18px] pt-3 pb-2.5">
        <Brain className="size-3.5 shrink-0 text-peri" />
        <span className="font-mono text-[10.5px] tracking-[0.14em] text-text-5">O QUE APRENDI</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 pb-4">
        {data?.learned.map((belief) => (
          <BeliefCard key={belief.id} belief={belief} />
        ))}
        {data && data.learned.length === 0 ? (
          <p className="px-1 text-[11.5px] leading-[1.5] text-text-5">
            Ainda aprendendo sobre sua marca. As crenças aparecem conforme os sinais se acumulam.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
