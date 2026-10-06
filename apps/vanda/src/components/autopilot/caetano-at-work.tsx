import { useEffect, useState } from "react";
import celebratingUrl from "@vanda-studio/ui/assets/caetano/work/caetano-celebrating.webp?url";
import focusedUrl from "@vanda-studio/ui/assets/caetano/work/caetano-focused.webp?url";
import puzzledUrl from "@vanda-studio/ui/assets/caetano/work/caetano-puzzled.webp?url";
import sleepyUrl from "@vanda-studio/ui/assets/caetano/work/caetano-sleepy.webp?url";
import thinkingUrl from "@vanda-studio/ui/assets/caetano/work/caetano-thinking.webp?url";
import thumbsUpUrl from "@vanda-studio/ui/assets/caetano/work/caetano-thumbs-up.webp?url";
import walkingUrl from "@vanda-studio/ui/assets/caetano/work/caetano-walking.webp?url";
import welcomeUrl from "@vanda-studio/ui/assets/caetano/work/caetano-welcome.webp?url";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { AutopilotOverview } from "../../convex/autopilotData";
import { slotWhen } from "./format";

/**
 * Caetano's face on Posts automáticos says the state at a glance: asleep when
 * off, waving when on, reading, planning or walking off to make a post while
 * he works (straight from the jobs' state, kept live by Convex), celebrating
 * when the start finishes and puzzled when something failed.
 */

export type WorkStage =
  | { readonly kind: "analyzing" }
  | { readonly kind: "planning" }
  | { readonly kind: "creating"; readonly when: string }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "done" };

/** What Caetano is doing now, or null when he is just on (or off). */
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

export type Mood = WorkStage["kind"] | "idle" | "off";

/** Each mood's frames (crossfaded in turn) and how the figure moves. */
const FIGURE = {
  off: { frames: [sleepyUrl], motion: "", every: 0 },
  idle: { frames: [welcomeUrl], motion: "", every: 0 },
  analyzing: { frames: [thinkingUrl, focusedUrl], motion: "animate-caetano-read", every: 1800 },
  planning: { frames: [focusedUrl, puzzledUrl], motion: "animate-caetano-nod", every: 1400 },
  creating: { frames: [walkingUrl], motion: "animate-caetano-walk", every: 0 },
  failed: { frames: [puzzledUrl], motion: "", every: 0 },
  done: { frames: [celebratingUrl, thumbsUpUrl], motion: "animate-caetano-hop", every: 1500 },
} as const satisfies Record<Mood, { frames: readonly string[]; motion: string; every: number }>;

export function CaetanoFigure({ mood, className }: { mood: Mood; className?: string }) {
  const { frames, motion, every } = FIGURE[mood];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);

    if (!every || frames.length < 2) return;

    // "done" plays once (celebrate, then thumbs up); the working moods loop.
    const timer =
      mood === "done"
        ? setTimeout(() => setFrame(1), every)
        : setInterval(() => setFrame((current) => (current + 1) % frames.length), every);

    return () => {
      clearTimeout(timer);
      clearInterval(timer);
    };
  }, [mood, every, frames.length]);

  return (
    <span className={cn("relative block shrink-0", className)} aria-hidden="true">
      <span className={cn("absolute inset-0", motion)}>
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
      </span>
    </span>
  );
}

// Each dot lights up a beat after the previous one.
const DOT_DELAYS = ["[animation-delay:0ms]", "[animation-delay:200ms]", "[animation-delay:400ms]"];

export function Dots() {
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

/** The one line that says what Caetano is doing. */
export const stageLine = (stage: WorkStage): string => {
  switch (stage.kind) {
    case "analyzing":
      return "Analisando sua conta · passo 1 de 2";
    case "planning":
      return "Planejando esta semana e a próxima · passo 2 de 2";
    case "creating":
      return `Criando o post de ${stage.when}`;
    case "done":
      return "Pronto! Sua semana está no calendário.";
    case "failed":
      return stage.reason ? `Não deu para terminar: ${stage.reason}` : "Não deu para terminar.";
  }
};
