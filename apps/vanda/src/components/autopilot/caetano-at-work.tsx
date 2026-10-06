import { useEffect, useState } from "react";
import celebratingUrl from "@vanda-studio/ui/assets/caetano/work/caetano-celebrating.webp?url";
import focusedUrl from "@vanda-studio/ui/assets/caetano/work/caetano-focused.webp?url";
import puzzledUrl from "@vanda-studio/ui/assets/caetano/work/caetano-puzzled.webp?url";
import thinkingUrl from "@vanda-studio/ui/assets/caetano/work/caetano-thinking.webp?url";
import thumbsUpUrl from "@vanda-studio/ui/assets/caetano/work/caetano-thumbs-up.webp?url";
import walkingUrl from "@vanda-studio/ui/assets/caetano/work/caetano-walking.webp?url";
import { Check } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { AutopilotOverview } from "../../convex/autopilotData";
import { slotWhen } from "./format";

/**
 * Caetano visibly at work on Posts automáticos. The stage comes straight from
 * the jobs' state (diagnosis running, a week planning, a post being made), so
 * what he "does" on screen is what he is doing. Convex keeps it live.
 */

export type WorkStage =
  | { readonly kind: "analyzing" }
  | { readonly kind: "planning" }
  | { readonly kind: "creating"; readonly when: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "done" };

/** What Caetano is doing now, or null when there is nothing to show. */
export function workStage(overview: AutopilotOverview): WorkStage | null {
  if (!overview.enabled) return null;

  if (overview.auditRunning) return { kind: "analyzing" };

  if (overview.weeks.some((week) => week.status === "planning")) return { kind: "planning" };

  const failedWeek = overview.weeks.find((week) => week.lastError);

  if (overview.auditError || failedWeek)
    return { kind: "failed", reason: overview.auditError ?? failedWeek?.lastError ?? "" };

  const making = overview.weeks
    .flatMap((week) => week.slots)
    .find((slot) => slot.status === "generating");

  return making ? { kind: "creating", when: slotWhen(making) } : null;
}

/** Each stage's frames (crossfaded in turn) and how the figure moves. */
const FIGURE = {
  analyzing: { frames: [thinkingUrl, focusedUrl], motion: "animate-caetano-read", every: 1800 },
  planning: { frames: [focusedUrl, puzzledUrl], motion: "animate-caetano-nod", every: 1400 },
  creating: { frames: [walkingUrl], motion: "animate-caetano-walk", every: 0 },
  failed: { frames: [puzzledUrl], motion: "", every: 0 },
  done: { frames: [celebratingUrl, thumbsUpUrl], motion: "animate-caetano-hop", every: 1500 },
} as const satisfies Record<
  WorkStage["kind"],
  { frames: readonly string[]; motion: string; every: number }
>;

function Figure({ kind }: { kind: WorkStage["kind"] }) {
  const { frames, motion, every } = FIGURE[kind];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);

    if (!every || frames.length < 2) return;

    // "done" plays once (celebrate, then thumbs up); the working stages loop.
    const timer =
      kind === "done"
        ? setTimeout(() => setFrame(1), every)
        : setInterval(() => setFrame((current) => (current + 1) % frames.length), every);

    return () => {
      clearTimeout(timer);
      clearInterval(timer);
    };
  }, [kind, every, frames.length]);

  return (
    <div className="relative size-20 shrink-0" aria-hidden="true">
      <span className="absolute inset-1 rounded-full bg-brand-accent/10" />
      <span className="absolute bottom-0.5 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-black/30 blur-xs" />
      <div className={cn("absolute inset-0", motion)}>
        {frames.map((url, index) => (
          <img
            key={url}
            src={url}
            alt=""
            className={cn(
              "absolute inset-0 size-full object-contain transition-opacity duration-500",
              index === frame ? "opacity-100" : "opacity-0",
            )}
          />
        ))}
      </div>
    </div>
  );
}

// Each dot lights up a beat after the previous one.
const DOT_DELAYS = ["[animation-delay:0ms]", "[animation-delay:200ms]", "[animation-delay:400ms]"];

function Dots() {
  return (
    <span aria-hidden="true">
      {DOT_DELAYS.map((delay) => (
        <span key={delay} className={cn("animate-caetano-dot", delay)}>
          .
        </span>
      ))}
    </span>
  );
}

type StepState = "done" | "active" | "next";

function Step({ state, children }: { state: StepState; children: string }) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 text-note",
        state === "next" ? "text-text-4" : "text-text-2",
        state === "active" && "font-medium text-text",
      )}
    >
      <span className="flex size-4 items-center justify-center">
        {state === "done" ? (
          <Check className="size-3.5 text-green" aria-label="feito" />
        ) : (
          <span
            className={cn(
              "size-1.5 rounded-full",
              state === "active" ? "animate-caetano-dot bg-brand-accent" : "bg-text-5",
            )}
          />
        )}
      </span>
      {children}
    </li>
  );
}

const startSteps = (kind: "analyzing" | "planning"): StepState[] =>
  kind === "analyzing" ? ["active", "next", "next"] : ["done", "active", "next"];

export function CaetanoAtWork({
  stage,
  onRetry,
  retrying = false,
}: {
  stage: WorkStage;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      className="mt-4 flex items-center gap-4 rounded-lg border border-border bg-app p-3"
      role="status"
      aria-live="polite"
    >
      <Figure kind={stage.kind} />
      <div className="min-w-0 flex-1">
        {stage.kind === "analyzing" || stage.kind === "planning" ? (
          <>
            <p className="text-body-sm font-medium">
              O Caetano está começando
              <Dots />
              <span className="ml-1 font-normal text-text-4">leva alguns minutos</span>
            </p>
            <ol className="mt-1.5 space-y-1">
              {(
                [
                  "Analisando sua conta",
                  "Planejando esta semana e a próxima",
                  "Os posts aparecem no calendário",
                ] as const
              ).map((label, index) => (
                <Step key={label} state={startSteps(stage.kind)[index]!}>
                  {label}
                </Step>
              ))}
            </ol>
            <p className="mt-1.5 text-micro text-text-4">
              Pode sair desta página: ele avisa na conversa e no WhatsApp quando terminar.
            </p>
          </>
        ) : stage.kind === "creating" ? (
          <p className="text-body-sm">
            Criando o post de {stage.when}
            <Dots />
            <span className="ml-1 text-text-4">fica pronto em alguns minutos</span>
          </p>
        ) : stage.kind === "done" ? (
          <p className="text-body-sm font-medium">Pronto! Sua semana está no calendário.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-body-sm font-medium">O Caetano não conseguiu terminar.</p>
              {stage.reason ? <p className="text-note text-text-3">{stage.reason}</p> : null}
            </div>
            {onRetry ? (
              <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
                Tentar de novo
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
