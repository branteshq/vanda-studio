import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { Button } from "@vanda-studio/ui/components/button";
import { StatusRing } from "@vanda-studio/ui/components/status-ring";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { OnboardingSplit } from "./onboarding-shell";
import type { CorpusStats, ReadonlyAnalysis } from "./types";

const LINES = [
  "Lendo seu perfil",
  "Analisando posts recentes",
  "Lendo comentários e métricas",
  "Identificando temas recorrentes",
  "Extraindo seu tom de voz",
  "Separando sinais úteis de ruído",
];

/** How long each cosmetic checklist line dwells before the next ticks active. */
const STEP_MS = 1200;
/** A short beat on the completed state before handing off to Confirm. */
const SETTLE_MS = 900;

/**
 * Step 2 — Vanda reads the account. One `analyzeAccount` call does the real work;
 * the checklist is a cosmetic, staggered progress that completes when the call
 * resolves, then advances. Re-running on error is safe (the action never writes).
 */
export function ObservingStep({
  accountId,
  onComplete,
  onSkip,
}: {
  accountId: Id<"accounts">;
  onComplete: (result: { analysis: ReadonlyAnalysis; stats: CorpusStats }) => void;
  /** Escape hatch when the corpus read fails: finish onboarding with empty brand memory. */
  onSkip: () => Promise<void>;
}) {
  const analyzeAccount = useAction(api.brandProfileNode.analyzeAccount);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const started = useRef(false);

  function run() {
    setError(false);
    setProgress(0);
    setDone(false);
    analyzeAccount({ accountId })
      .then((result) => {
        setProgress(LINES.length);
        setDone(true);
        setTimeout(() => onComplete(result), SETTLE_MS);
      })
      .catch(() => setError(true));
  }

  // Kick off the analysis once on mount.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Advance the cosmetic checklist while the analysis runs (stop one short of done).
  useEffect(() => {
    if (done || error || progress >= LINES.length - 1) return;
    const timer = setTimeout(() => setProgress((p) => Math.min(p + 1, LINES.length - 1)), STEP_MS);
    return () => clearTimeout(timer);
  }, [progress, done, error]);

  return (
    <OnboardingSplit
      current="conhecer"
      aperture={
        done
          ? { caption: "Em foco", sub: "Pronta pra te mostrar" }
          : { caption: "Lendo sua conta", sub: "Pode levar alguns segundos" }
      }
    >
      <h1 className="text-[30px] font-semibold leading-[1.12] tracking-[-0.03em]">
        {done ? "A Vanda já entende seu negócio." : "A Vanda está conhecendo seu negócio."}
      </h1>

      {error ? (
        <>
          <p className="mt-3 text-[14px] text-text-3">
            Não consegui ler sua conta agora. Você pode tentar de novo — ou seguir sem a análise: a
            Vanda aprende sobre a sua marca conforme vocês conversam.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Button variant="outline" size="lg" disabled={skipping} onClick={run}>
              Tentar de novo
            </Button>
            <Button
              variant="ghost"
              size="lg"
              disabled={skipping}
              onClick={() => {
                setSkipping(true);
                onSkip().catch(() => setSkipping(false));
              }}
            >
              {skipping ? "Entrando…" : "Continuar sem análise"}
            </Button>
          </div>
        </>
      ) : (
        <ul className="mt-7 flex flex-col gap-3">
          {LINES.map((line, index) => {
            const state = index < progress ? "done" : index === progress ? "active" : "pending";
            return (
              <li
                key={line}
                className="flex items-center gap-2.5 fade-in slide-in-from-bottom-1 animate-in fill-mode-both duration-300"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <StatusRing state={state} />
                <span
                  className={cn(
                    "text-[14px]",
                    state === "active"
                      ? "text-text"
                      : state === "done"
                        ? "text-text-3"
                        : "text-text-5",
                  )}
                >
                  {line}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </OnboardingSplit>
  );
}
