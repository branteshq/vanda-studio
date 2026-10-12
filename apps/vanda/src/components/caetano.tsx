import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, Ref } from "react";
import blinkUrl from "@vanda-studio/ui/assets/caetano/frames/blink.webp?url";
import cheerUrl from "@vanda-studio/ui/assets/caetano/frames/cheer.webp?url";
import idleUrl from "@vanda-studio/ui/assets/caetano/frames/idle.webp?url";
import readBlinkUrl from "@vanda-studio/ui/assets/caetano/frames/read-blink.webp?url";
import readUrl from "@vanda-studio/ui/assets/caetano/frames/read.webp?url";
import read2Url from "@vanda-studio/ui/assets/caetano/frames/read2.webp?url";
import sleepyUrl from "@vanda-studio/ui/assets/caetano/frames/sleepy.webp?url";
import thinkBlinkUrl from "@vanda-studio/ui/assets/caetano/frames/think-blink.webp?url";
import thinkUrl from "@vanda-studio/ui/assets/caetano/frames/think.webp?url";
import wave1Url from "@vanda-studio/ui/assets/caetano/frames/wave1.webp?url";
import wave2Url from "@vanda-studio/ui/assets/caetano/frames/wave2.webp?url";
import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * Caetano, drawn from registered frames (packages/ui/src/assets/caetano/frames):
 * every frame shares one canvas, so a swap changes only his eyes, an arm or the
 * phone, never his size or place. Blinks and scrolling swap frames; breathing,
 * sway, pop and jump move the whole figure. Reduced motion keeps him still.
 */
const FRAMES = {
  idle: idleUrl,
  blink: blinkUrl,
  wave1: wave1Url,
  wave2: wave2Url,
  read: readUrl,
  read2: read2Url,
  "read-blink": readBlinkUrl,
  think: thinkUrl,
  "think-blink": thinkBlinkUrl,
  cheer: cheerUrl,
  sleepy: sleepyUrl,
} as const;

type Frame = keyof typeof FRAMES;

// SAFETY: Object.keys of a literal object lists exactly its own keys.
const FRAME_NAMES = Object.keys(FRAMES) as Frame[];

export type CaetanoState = "idle" | "read" | "think" | "cheer" | "sleepy";

export type CaetanoMove = "wave" | "jump";

/** Per state: the frames it alternates (like scrolling the feed), its blink and its body motion. */
const STATES: Record<
  CaetanoState,
  { base: readonly Frame[]; blink?: Frame; body: string; scrollMs?: readonly [number, number] }
> = {
  idle: { base: ["idle"], blink: "blink", body: "animate-caetano-breathe" },
  read: {
    base: ["read", "read2"],
    blink: "read-blink",
    body: "animate-caetano-breathe",
    scrollMs: [900, 1700],
  },
  think: { base: ["think"], blink: "think-blink", body: "animate-caetano-sway" },
  cheer: { base: ["cheer"], body: "animate-caetano-breathe" },
  sleepy: { base: ["sleepy"], body: "animate-caetano-breathe" },
};

const BLINK_EVERY_MS = [2400, 6000] as const;

const BLINK_MS = 95;

const WAVE_STEP_MS = 170;

const WAVE_HOLD_MS = 260;

const POP: Keyframe[] = [{ transform: "scale(0.94)" }, { transform: "scale(1)" }];

const JUMP: Keyframe[] = [
  { transform: "translateY(0) scale(1, 1)", offset: 0 },
  { transform: "translateY(0) scale(1.07, 0.9)", offset: 0.14 },
  { transform: "translateY(-30%) scale(0.95, 1.07)", offset: 0.38 },
  { transform: "translateY(0) scale(1.08, 0.9)", offset: 0.58 },
  { transform: "translateY(-4%) scale(0.98, 1.02)", offset: 0.72 },
  { transform: "translateY(0) scale(1, 1)", offset: 1 },
];

const between = ([min, max]: readonly [number, number]) => min + Math.random() * (max - min);

/** Hovering "Terminar depois" makes every Caetano on the page sleepy. */
export const CaetanoSleepyContext = createContext(false);

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const subscribeReducedMotion = (onChange: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
};

/** The system's reduced-motion setting, live; the server renders him still. */
const useReducedMotion = (): boolean =>
  useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  );

export interface CaetanoHandle {
  play: (move: CaetanoMove) => void;
}

const firstFrame = (state: CaetanoState): Frame => STATES[state].base[0] ?? "idle";

/** The frame on show for a state: blinks and scroll swaps while alive, waves on demand. */
function useCaetano(
  state: CaetanoState,
  alive: boolean,
  body: React.RefObject<HTMLDivElement | null>,
) {
  const [shownState, setShownState] = useState(state);
  const [frame, setFrame] = useState<Frame>(firstFrame(state));
  const [waving, setWaving] = useState<Frame | null>(null);
  const waveTimers = useRef<number[]>([]);

  // A new state starts on its first frame (adjusting state during render, not in an effect).
  if (shownState !== state) {
    setShownState(state);
    setFrame(firstFrame(state));
  }

  useEffect(() => {
    if (!alive) return;

    // Each state enters with a quick pop.
    body.current?.animate(POP, { duration: 320, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });

    const { blink, scrollMs, base: frames } = STATES[shownState];
    let current = frames[0] ?? "idle";
    const timers = new Set<number>();

    const later = (ms: number, run: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        run();
      }, ms);

      timers.add(id);
    };

    const blinkOnce = (then: () => void) => {
      if (!blink) return then();

      setFrame(blink);
      later(BLINK_MS, () => {
        setFrame(current);
        then();
      });
    };

    const blinkLoop = () =>
      later(between(BLINK_EVERY_MS), () =>
        blinkOnce(() => {
          // Sometimes a double blink.
          if (Math.random() < 0.22) later(140, () => blinkOnce(blinkLoop));
          else blinkLoop();
        }),
      );

    const scrollLoop = () => {
      if (!scrollMs) return;

      later(between(scrollMs), () => {
        current = frames[(frames.indexOf(current) + 1) % frames.length] ?? current;
        setFrame(current);
        scrollLoop();
      });
    };

    blinkLoop();
    scrollLoop();

    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [alive, body, shownState]);

  useEffect(
    () => () => {
      for (const id of waveTimers.current) window.clearTimeout(id);
    },
    [],
  );

  const play = useCallback(
    (move: CaetanoMove) => {
      if (!alive) return;

      if (move === "jump") {
        body.current?.animate(JUMP, { duration: 900, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });

        return;
      }

      if (waveTimers.current.length > 0) return;

      body.current?.animate(POP, { duration: 320, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
      const steps: Frame[] = ["wave1", "wave2", "wave1", "wave2", "wave1", "wave2", "wave1"];

      waveTimers.current = steps.map((step, index) =>
        window.setTimeout(() => setWaving(step), index * WAVE_STEP_MS),
      );
      waveTimers.current.push(
        window.setTimeout(
          () => {
            setWaving(null);
            waveTimers.current = [];
          },
          (steps.length - 1) * WAVE_STEP_MS + WAVE_HOLD_MS,
        ),
      );
    },
    [alive, body],
  );

  return { frame: waving ?? frame, play };
}

function Frames({ frame }: { frame: Frame }) {
  return FRAME_NAMES.map((name) => (
    <img
      key={name}
      src={FRAMES[name]}
      alt=""
      draggable={false}
      className={cn(
        "pointer-events-none absolute inset-0 size-full select-none",
        name === frame ? "opacity-100" : "opacity-0",
      )}
    />
  ));
}

/**
 * Caetano full body. `intro` plays once on mount; `onClickMove` plays on click.
 * `still` freezes him on his first frame (older messages, reduced motion).
 */
export function Caetano({
  state = "idle",
  size,
  intro,
  onClickMove,
  still = false,
  className,
  ref,
}: {
  state?: CaetanoState;
  /** Width and height in px. */
  size: number;
  intro?: CaetanoMove;
  onClickMove?: CaetanoMove;
  still?: boolean;
  className?: string;
  ref?: Ref<CaetanoHandle>;
}) {
  const sleepy = useContext(CaetanoSleepyContext);
  const reduced = useReducedMotion();
  const alive = !still && !reduced;
  const body = useRef<HTMLDivElement>(null);
  const shown: CaetanoState = sleepy && state === "idle" ? "sleepy" : state;
  const { frame, play } = useCaetano(shown, alive, body);

  useImperativeHandle(ref, () => ({ play }), [play]);

  useEffect(() => {
    if (!intro) return;

    const id = window.setTimeout(() => play(intro), 450);

    return () => window.clearTimeout(id);
  }, [intro, play]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative aspect-square size-(--caetano-size) shrink-0",
        onClickMove && "cursor-pointer",
        className,
      )}
      style={
        // SAFETY: a custom property only; the size is a runtime value.
        { "--caetano-size": `${size}px` } as CSSProperties
      }
      onClick={onClickMove ? () => play(onClickMove) : undefined}
    >
      <div ref={body} className={cn("absolute inset-0 origin-bottom", alive && STATES[shown].body)}>
        <Frames frame={frame} />
      </div>
    </div>
  );
}

/** Caetano's head, cropped from the same frames, so the chat avatar blinks with him. */
export function CaetanoHead({
  state = "idle",
  size = 24,
  still = false,
  className,
}: {
  state?: CaetanoState;
  size?: number;
  still?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative block size-(--head) shrink-0 overflow-hidden", className)}
      style={
        // SAFETY: custom properties only; the crop follows the runtime size.
        {
          "--head": `${size}px`,
          "--head-top": `${size * -0.1}px`,
          "--head-left": `${size * -0.5}px`,
        } as CSSProperties
      }
    >
      <span className="absolute top-(--head-top) left-(--head-left)">
        <Caetano state={state} size={size * 1.95} still={still} />
      </span>
    </span>
  );
}
