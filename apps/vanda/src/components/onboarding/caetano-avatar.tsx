import type { CSSProperties } from "react";
import caetanoSpriteUrl from "@vanda-studio/ui/assets/caetano/caetano-sprite.webp?url";
import { cn } from "@vanda-studio/ui/lib/utils";

export type CaetanoState = "idle" | "thinking" | "writing" | "saved" | "talking" | "done";

const FRAMES = 8;

/** Frame in the one-row sprite atlas, and the motion that plays over it. */
const POSE = {
  idle: { frame: 0, motion: "animate-caetano-breathe" },
  thinking: { frame: 1, motion: "animate-caetano-sway" },
  writing: { frame: 2, motion: "animate-caetano-guide-nod" },
  saved: { frame: 3, motion: "animate-caetano-pop" },
  talking: { frame: 0, motion: "animate-caetano-bounce" },
  done: { frame: 4, motion: "animate-caetano-guide-hop" },
} satisfies Record<CaetanoState, { frame: number; motion: string }>;

/**
 * Caetano's face in the chat. One request for the whole atlas; a state change
 * only moves background-position, so the pose swaps without a flicker.
 */
export function CaetanoAvatar({
  state,
  still = false,
}: {
  state: CaetanoState;
  /** Resting frame with no motion, for earlier messages. */
  still?: boolean;
}) {
  const pose = POSE[state];

  return (
    <div aria-hidden="true" className="relative size-10 shrink-0 self-start">
      {state === "thinking" ? (
        <span className="absolute inset-0 rounded-full bg-brand-accent/15 animate-caetano-halo" />
      ) : null}
      <div
        className={cn("absolute inset-0 rounded-lg caetano-sprite", still ? null : pose.motion)}
        style={
          // SAFETY: custom properties only; the sprite URL and frame offset are runtime values.
          {
            "--caetano-sprite": `url("${caetanoSpriteUrl}")`,
            "--caetano-frame": `${(pose.frame * 100) / (FRAMES - 1)}% 0`,
          } as CSSProperties
        }
      />
    </div>
  );
}
