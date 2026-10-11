import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAction } from "convex/react";
import { Button } from "@vanda-studio/ui/components/button";
import { StatusRing } from "@vanda-studio/ui/components/status-ring";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { OnboardingSplit } from "./onboarding-shell";

const LINES = [
  "Lendo seu perfil",
  "Analisando posts recentes",
  "Lendo comentários e métricas",
  "Separando o que já entendi do que vou perguntar",
];

/** How long each cosmetic checklist line dwells before the next ticks active. */
const STEP_MS = 1800;

const LINE_COLOR = {
  active: "text-text",
  done: "text-text-3",
  pending: "text-text-5",
};

/**
 * Step 2 — Vanda reads the account. One `onboard` call does the real work; the
 * checklist is cosmetic. Once the account is onboarded the route moves on to the
 * brand guide, so this step only owns the retry.
 */
export function ObservingStep({ accountId }: { accountId: Id<"accounts"> }) {
  const onboard = useAction(api.brandProfileNode.onboard);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(false);
  const started = useRef(false);

  function run() {
    setError(false);
    setProgress(0);
    onboard({ accountId }).catch(() => setError(true));
  }

  // Kick off the analysis once on mount.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Advance the checklist while the analysis runs, stopping one short of done.
  useEffect(() => {
    if (error || progress >= LINES.length - 1) return;
    const timer = setTimeout(() => setProgress((p) => Math.min(p + 1, LINES.length - 1)), STEP_MS);

    return () => clearTimeout(timer);
  }, [progress, error]);

  return (
    <OnboardingSplit
      current="conhecer"
      aperture={{ caption: "Lendo sua conta", sub: "Pode levar um minuto" }}
    >
      <h1 className="text-3xl font-semibold leading-tight tracking-tight">
        A Vanda está conhecendo seu negócio.
      </h1>

      {error ? (
        <>
          <p className="mt-3 text-sm text-text-3">Não consegui começar agora.</p>
          <div className="mt-5">
            <Button variant="outline" size="lg" onClick={run}>
              Tentar de novo
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
                // SAFETY: React accepts custom properties at runtime; CSSProperties omits their open-ended names.
                style={{ "--animation-delay": `${index * 60}ms` } as CSSProperties}
                className="flex items-center gap-2.5 fade-in slide-in-from-bottom-1 animate-in fill-mode-both duration-300 delay-(--animation-delay)"
              >
                <StatusRing state={state} />
                <span className={cn("text-sm", LINE_COLOR[state])}>{line}</span>
              </li>
            );
          })}
        </ul>
      )}
    </OnboardingSplit>
  );
}
