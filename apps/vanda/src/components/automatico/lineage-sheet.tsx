import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Brain, Check, Layers, Pencil } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Input } from "@vanda-studio/ui/components/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@vanda-studio/ui/components/sheet";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { LineageSignal } from "../../convex/board";
import { ConfidenceBar } from "./confidence-bar";
import { SalienceMeter } from "./salience-meter";
import { SIGNAL_META, confidencePct } from "./meta";

function SignalRow({ signal, onMarkNoise }: { signal: LineageSignal; onMarkNoise: () => void }) {
  const meta = SIGNAL_META[signal.source];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5">
      <SalienceMeter value={signal.salience} />
      <Icon className={cn("size-3.5 shrink-0", meta.tone)} />
      <p className="min-w-0 flex-1 truncate text-xs text-text-2">
        {signal.authorHandle ? <span className="text-text-3">@{signal.authorHandle}: </span> : null}
        {signal.text}
      </p>
      <Button
        variant="subtle"
        size="xs"
        className="shrink-0 hover:text-amber"
        onClick={onMarkNoise}
      >
        marcar como ruído
      </Button>
    </div>
  );
}

function LineageBody({ suggestionId }: { suggestionId: Id<"suggestions"> }) {
  const data = useQuery(api.board.lineage, { suggestionId });
  const markNoise = useMutation(api.board.markNoise);
  const correctBelief = useMutation(api.board.correctBelief);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The pre-intervention confidence, held briefly so the recompute reads as old→new.
  const [priorConfidence, setPriorConfidence] = useState<number | null>(null);

  const confidence = data?.belief?.confidence ?? null;
  useEffect(() => {
    if (priorConfidence === null) return;
    const timer = setTimeout(() => setPriorConfidence(null), 2600);
    return () => clearTimeout(timer);
  }, [priorConfidence, confidence]);

  if (data === undefined) {
    return (
      <Spinner className="size-5 text-text-4" role="status" aria-label="Carregando linhagem" />
    );
  }

  const belief = data.belief;
  const recomputed =
    priorConfidence !== null && confidence !== null && priorConfidence !== confidence;
  const onNoise = (signalId: Id<"signals">) => {
    if (belief) setPriorConfidence(belief.confidence);
    void markNoise({ signalId });
  };

  return (
    <>
      <p className="mb-4 text-body font-medium text-pretty text-text-2">
        {data.suggestion.title}
      </p>

      {belief ? (
        <section className="rounded-xl border border-peri/30 bg-peri/5 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Brain className="size-3.5 shrink-0 text-peri" />
            <span className="font-mono text-micro tracking-widest text-peri uppercase">
              Crença
            </span>
            <span className="flex-1" />
            {editing ? null : (
              <Button
                variant="subtle"
                size="xs"
                onClick={() => {
                  setDraft(belief.statement);
                  setError(null);
                  setEditing(true);
                }}
              >
                <Pencil /> Corrigir crença
              </Button>
            )}
          </div>

          {editing ? (
            <div className="mb-3 flex flex-col gap-2">
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="Corrigir crença"
                autoFocus
              />
              {error ? <p className="text-caption text-destructive">{error}</p> : null}
              <div className="flex items-center gap-1.5">
                <Button
                  variant="brand"
                  size="sm"
                  disabled={!draft.trim() || draft.trim() === belief.statement}
                  onClick={async () => {
                    try {
                      await correctBelief({ beliefId: belief.id, statement: draft.trim() });
                      setEditing(false);
                      setError(null);
                    } catch {
                      setError("Já existe uma crença com esse texto. Tente outra.");
                    }
                  }}
                >
                  <Check /> Salvar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <p className="mb-3 text-base font-medium leading-snug text-pretty text-text">
              {belief.statement}
            </p>
          )}

          <div className="flex items-center gap-2.5">
            <ConfidenceBar value={belief.confidence} tone="peri" />
            <span className="font-mono text-note text-peri">
              {confidencePct(belief.confidence)}%
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-caption text-text-4">
            sustentada por {data.salientSignals.length}{" "}
            {data.salientSignals.length === 1 ? "sinal saliente" : "sinais salientes"}
            {recomputed ? (
              <span className="ml-auto inline-flex items-center gap-1 font-mono text-micro text-amber">
                <span className="line-through opacity-70">{confidencePct(priorConfidence)}%</span>→{" "}
                {confidencePct(confidence)}%
              </span>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="text-body text-text-4">Esta ideia ainda não tem uma crença ligada.</p>
      )}

      {data.salientSignals.length > 0 ? (
        <>
          <div className="mt-6 mb-2.5 font-mono text-micro tracking-widest text-text-5 uppercase">
            Sinais que a sustentam
          </div>
          <div className="flex flex-col gap-2">
            {data.salientSignals.map((signal) => (
              <SignalRow key={signal.id} signal={signal} onMarkNoise={() => onNoise(signal.id)} />
            ))}
          </div>
        </>
      ) : null}

      {data.discardedCount > 0 ? (
        <p className="mt-4 flex items-center gap-2 text-note text-text-5">
          <Layers className="size-3 shrink-0 text-text-6" />+{data.discardedCount} outros sinais não
          usados nesta ideia
        </p>
      ) : null}
    </>
  );
}

/**
 * Intervir na linhagem — the product's magic made touchable. Opening a card shows
 * not just the idea but the reasoning: the belief, the signals sustaining it, and
 * the two ways to steer it (mark a signal as noise, correct the belief's wording).
 * The owner drives the reasoning, not just the output.
 */
export function LineageSheet({
  suggestionId,
  onClose,
}: {
  suggestionId: Id<"suggestions"> | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={suggestionId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 border-l border-border bg-app p-0 sm:max-w-automatico-lineage"
      >
        <SheetHeader className="shrink-0 gap-0 border-b border-border py-4 pr-12 pl-5">
          <SheetTitle className="font-mono text-micro tracking-widest text-text-5 uppercase">
            Linhagem
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {suggestionId ? <LineageBody suggestionId={suggestionId} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
