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
    <div className="flex gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5">
      <SalienceMeter value={signal.salience} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5">
          <Icon className={cn("size-3 shrink-0", meta.tone)} />
          <span className={cn("text-micro font-semibold", meta.tone)}>{meta.label}</span>
          <span className="flex-1" />
          <span className="text-micro text-text-5">
            {relativeTime(signal.observedAt)}
          </span>
        </div>
        <p className="line-clamp-2 text-caption text-text-3">
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
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="mb-2.5 text-body-sm font-medium text-pretty text-text">
        {belief.statement}
      </p>
      <div className="mb-2.5 flex items-center gap-2.5">
        <ConfidenceBar value={belief.confidence} tone="peri" />
        <span className="text-micro font-medium text-peri">{confidencePct(belief.confidence)}%</span>
      </div>
      <div className="flex items-center gap-2 text-micro text-text-4">
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
    <aside className="w-automatico-rail flex shrink-0 flex-col overflow-hidden border-l border-border bg-app">
      <div className="flex items-center gap-2 px-5 pt-4 pb-2.5">
        <span className="text-xs font-medium text-text-4">Observando</span>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 text-note font-medium text-green">
          <span className="size-1 rounded-full bg-green shadow-sm motion-safe:animate-pulse" />
          {data?.totalToday ?? 0} hoje
        </span>
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-3.5 pb-2.5">
        {data?.notable.map((signal) => (
          <SignalRow key={signal.id} signal={signal} />
        ))}
        {data && data.routineCount > 0 ? (
          <div className="flex items-center gap-2.5 rounded-md border border-dashed border-border px-3 py-2.5">
            <Layers className="size-3.5 shrink-0 text-text-6" />
            <span className="flex-1 text-caption text-text-4">
              +{data.routineCount} sinais rotineiros agrupados
            </span>
            <span className="text-micro text-text-6">sem ação</span>
          </div>
        ) : null}
        {data && data.notable.length === 0 && data.routineCount === 0 ? (
          <p className="px-1 py-2 text-caption text-text-5">A Vanda está começando a observar…</p>
        ) : null}
      </div>
      <div className="mx-3.5 my-1.5 h-px bg-border" />
      <div className="flex items-center gap-2 px-5 pt-3 pb-2.5">
        <Brain className="size-3.5 shrink-0 text-peri" />
        <span className="text-xs font-medium text-text-4">O que aprendi</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 pb-4">
        {data?.learned.map((belief) => (
          <BeliefCard key={belief.id} belief={belief} />
        ))}
        {data && data.learned.length === 0 ? (
          <p className="px-1 text-caption text-text-5">
            Ainda aprendendo sobre sua marca. As crenças aparecem conforme os sinais se acumulam.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
