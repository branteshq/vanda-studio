import { useRef, useState } from "react";
import { Button } from "@vanda-studio/ui/components/button";
import { cn } from "@vanda-studio/ui/lib/utils";
import { Caetano } from "../caetano";

const PRESS_MS = 420;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * "Fechou, bora criar": ends the guide without a model turn. It rises from behind
 * the composer once Caetano has replied and sinks while he works. Caetano's head
 * peeks over it; on press it squishes, turns into a check, and hands his position
 * to `onFinished` so he can jump from here into "Guia pronto.".
 */
export function GuideFinish({
  visible,
  finish,
  onFinished,
}: {
  visible: boolean;
  /** Ends the guide; throws when it could not. */
  finish: () => Promise<void>;
  /** Where Caetano was when the guide ended, for his jump into "Guia pronto.". */
  onFinished: (from: DOMRect) => void;
}) {
  const [pressed, setPressed] = useState(false);
  const [risen, setRisen] = useState(visible);
  const peek = useRef<HTMLDivElement>(null);
  const shown = visible || pressed;

  // Only animate the sink after it has risen once (a hidden first paint stays still).
  if (shown && !risen) setRisen(true);

  const press = async () => {
    if (pressed) return;

    setPressed(true);

    try {
      await Promise.all([finish(), wait(PRESS_MS)]);
    } catch {
      setPressed(false);

      return;
    }

    const from = peek.current?.getBoundingClientRect();

    if (from) onFinished(from);
  };

  return (
    <div inert={!shown} data-shown={shown || undefined} className="finish-slot">
      {/* Clipped at the composer's edge, so the button rises from behind it. */}
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "flex flex-col items-center pt-12 pb-4",
            shown ? "animate-finish-rise" : risen ? "animate-finish-sink" : "opacity-0",
          )}
        >
          <div className="finish-lift group/finish relative">
            {/* His body hides behind the button; only the head shows over its edge. */}
            <div className="finish-peek" data-shown={shown || undefined}>
              <div ref={peek}>
                <Caetano state={pressed ? "cheer" : "idle"} size={88} />
              </div>
            </div>

            <div
              className={cn(
                "relative transition-transform duration-150 ease-out group-hover/finish:-translate-y-px motion-reduce:transition-none",
                pressed && "animate-finish-squish",
              )}
            >
              <Button variant="brand" size="xl" className="relative" onClick={() => void press()}>
                <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
                  {shown && !pressed ? <span className="finish-shine absolute inset-0" /> : null}
                </span>
                <span className="relative grid">
                  <span
                    className={cn(
                      "col-start-1 row-start-1 transition duration-300 ease-out motion-reduce:transition-opacity",
                      pressed && "-translate-y-full opacity-0",
                    )}
                  >
                    Fechou, bora criar
                  </span>
                  <span
                    aria-hidden={!pressed}
                    className={cn(
                      "col-start-1 row-start-1 inline-flex items-center justify-center gap-2 transition duration-300 ease-out motion-reduce:transition-opacity",
                      pressed ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
                    )}
                  >
                    {pressed ? (
                      <svg className="finish-check size-4" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M3.5 8.5l3 3 6-7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                    Fechou!
                  </span>
                </span>
              </Button>
            </div>
          </div>
          <p className="mt-2.5 text-body-sm text-text-4">
            Dá pra mudar depois em Perfil › Negócios.
          </p>
        </div>
      </div>
    </div>
  );
}
