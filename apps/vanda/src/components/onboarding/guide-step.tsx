import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Button } from "@vanda-studio/ui/components/button";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Caetano, CaetanoSleepyContext, useReducedMotion, type CaetanoHandle } from "../caetano";
import { Conversation } from "../conversation";
import { showErrorToast } from "../error-feedback";
import { GuideFinish } from "./guide-finish";
import { OnboardingCenter, OnboardingTop } from "./onboarding-shell";

/**
 * Step 2 — Caetano's brand guide, a plain chat. He reads the Instagram, writes the
 * whole brand file, shows what he got in one message and asks only what the feed
 * cannot show. The owner ends it with "Fechou, bora criar" (or by telling him, and
 * he calls brand_guide_finish); the page turns into "Guia pronto.".
 */
export function GuideStep({
  accountId,
  threadId,
}: {
  accountId: Id<"accounts">;
  threadId: string;
}) {
  const navigate = useNavigate();
  const guide = useQuery(api.brandFile.guide, { accountId });
  const approveGuide = useMutation(api.brandProfile.approveGuide);
  const reduced = useReducedMotion();
  // Easter egg: hovering "Terminar depois" makes Caetano sleepy.
  const [sleepy, setSleepy] = useState(false);
  // The button's way out: pressed, then Caetano flies from it, then lands.
  const [pressing, setPressing] = useState(false);
  const [flight, setFlight] = useState<DOMRect | null>(null);
  const [landed, setLanded] = useState(false);

  const done = guide?.done === true;
  const drafted = guide?.sections.some((section) => section.filled) ?? false;
  const showDone = flight !== null || landed || (done && !pressing);
  const showChat = !landed && (!done || pressing || flight !== null);

  const onStart = () => void navigate({ to: "/conversa" });
  const onLanded = useCallback(() => setLanded(true), []);

  const finish = async () => {
    setPressing(true);

    try {
      await approveGuide({ accountId });
    } catch (error) {
      setPressing(false);
      showErrorToast(error);
      throw error;
    }
  };

  const onFinished = (from: DOMRect) => {
    setFlight(from);

    if (reduced) setLanded(true);
  };

  return (
    <CaetanoSleepyContext.Provider value={sleepy}>
      <div className="relative h-svh overflow-hidden bg-app text-text antialiased">
        {showChat ? (
          <div
            inert={flight !== null}
            className={cn(
              "flex h-full flex-col transition duration-300 ease-out motion-reduce:transition-opacity",
              flight && "pointer-events-none -translate-y-2.5 opacity-0 blur-xs",
            )}
          >
            <OnboardingTop>
              <Button
                variant="ghost"
                size="sm"
                onClick={onStart}
                onPointerEnter={() => setSleepy(true)}
                onPointerLeave={() => setSleepy(false)}
              >
                Terminar depois
              </Button>
            </OnboardingTop>

            <div className="flex min-h-0 flex-1">
              <Conversation
                accountId={accountId}
                threadId={threadId}
                guide
                composer={{
                  placeholder: "Responder ao Caetano…",
                  ariaLabel: "Mensagem para o Caetano",
                  agentName: "O Caetano",
                  attachLabel: "Enviar foto ou logo",
                }}
                actions={({ replied }) => (
                  <GuideFinish
                    visible={replied && drafted && !done}
                    finish={finish}
                    onFinished={onFinished}
                  />
                )}
              />
            </div>
          </div>
        ) : null}

        {showDone ? (
          <div className="absolute inset-0 overflow-y-auto">
            <GuideDone onStart={onStart} from={flight ?? undefined} onLanded={onLanded} />
          </div>
        ) : null}
      </div>
    </CaetanoSleepyContext.Provider>
  );
}

const FLIGHT_MS = 820;

/**
 * The guide is done: Caetano, one line, one button. Coming from the finish button
 * (`from`), he jumps off it in an arc and lands here, and the text follows;
 * otherwise he just jumps in place (and again on click).
 */
function GuideDone({
  onStart,
  from,
  onLanded,
}: {
  onStart: () => void;
  from?: DOMRect | undefined;
  onLanded?: () => void;
}) {
  const reduced = useReducedMotion();
  const hero = useRef<HTMLDivElement>(null);
  const caetano = useRef<CaetanoHandle>(null);
  const flying = from !== undefined && !reduced;
  const [arrived, setArrived] = useState(!flying);

  useLayoutEffect(() => {
    const element = hero.current;

    if (!flying || !from || !element) return;

    // FLIP: start where his head peeked over the button, arc up, land in place.
    const to = element.getBoundingClientRect();
    const scale = from.width / to.width;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const apex = Math.min(dy, 0) - 70;

    const flight = element.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
          easing: "cubic-bezier(0.2, 0.75, 0.35, 1)",
        },
        {
          transform: `translate(${dx}px, ${dy - 26}px) scale(${scale * 1.08}, ${scale * 0.94})`,
          offset: 0.12,
          easing: "cubic-bezier(0.25, 0.6, 0.4, 1)",
        },
        {
          transform: `translate(${dx * 0.45}px, ${apex}px) scale(${(scale + 1) / 2})`,
          offset: 0.55,
          easing: "cubic-bezier(0.55, 0, 0.85, 0.5)",
        },
        { transform: "translate(0, 0) scale(1)" },
      ],
      { duration: FLIGHT_MS },
    );

    flight.onfinish = () => {
      setArrived(true);
      caetano.current?.play("land");
      onLanded?.();
    };

    return () => flight.cancel();
  }, [flying, from, onLanded]);

  const follow = from !== undefined ? (arrived ? "animate-finish-up" : "opacity-0") : undefined;

  return (
    <OnboardingCenter className={cn(from !== undefined && "bg-transparent")}>
      <div ref={hero} className="relative z-10 origin-top-left">
        <Caetano
          ref={caetano}
          state="cheer"
          size={168}
          {...(from === undefined && { intro: "jump" as const })}
          onClickMove="jump"
        />
      </div>
      <h1 className={cn("mt-2 text-2xl font-semibold tracking-tight", follow)}>Guia pronto.</h1>
      <p
        className={cn("finish-follow-2 mt-2 max-w-xs text-sm leading-relaxed text-text-3", follow)}
      >
        A Vanda já usa ele em todo post. Dá pra mudar quando quiser em Perfil › Negócios.
      </p>
      <div className={cn("finish-follow-3 mt-7", follow)}>
        <Button variant="brand" size="lg" onClick={onStart}>
          Começar a criar
        </Button>
      </div>
    </OnboardingCenter>
  );
}
