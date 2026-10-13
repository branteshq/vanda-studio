import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex-helpers/react/cache";
import { X } from "lucide-react";
import { useSidebar } from "@vanda-studio/ui/components/sidebar";
import { api } from "../convex/_generated/api";
import { Caetano, useReducedMotion } from "./caetano";
import type { CaetanoHandle } from "./caetano";

/** "Agora não" hides the card on this browser for a week; then Caetano asks again. */
const DISMISS_KEY = "vanda:caetano-zap-dismissed-at";

const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

const DISMISS_EVENT = "vanda:caetano-zap";

const subscribeDismissal = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(DISMISS_EVENT, onChange);

  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DISMISS_EVENT, onChange);
  };
};

const readDismissal = (): boolean => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));

    return Number.isFinite(at) && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
};

const dismissForAWeek = () => {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Private mode: the card simply stays.
  }

  window.dispatchEvent(new Event(DISMISS_EVENT));
};

// The server has no localStorage: render nothing there, so a dismissed card never flashes.
const useDismissed = (): boolean =>
  useSyncExternalStore(subscribeDismissal, readDismissal, () => true);

/** Now and then a message lands on his phone: a typing bubble for a moment. */
const BUBBLE_FIRST_MS = 2600;

const BUBBLE_SHOWN_MS = 1800;

const BUBBLE_EVERY_MS = [9000, 15000] as const;

function useTypingBubble(alive: boolean): boolean {
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!alive) return;

    const timers = new Set<number>();

    const later = (ms: number, run: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        run();
      }, ms);

      timers.add(id);
    };

    const cycle = (wait: number) =>
      later(wait, () => {
        setTyping(true);
        later(BUBBLE_SHOWN_MS, () => {
          setTyping(false);
          const [min, max] = BUBBLE_EVERY_MS;

          cycle(min + Math.random() * (max - min));
        });
      });

    cycle(BUBBLE_FIRST_MS);

    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [alive]);

  return alive && typing;
}

/**
 * Caetano also lives on WhatsApp, and few owners find it. Until the owner links
 * it, a card at the sidebar's foot says so, with Caetano reading his phone
 * behind it; it leads to Perfil → Conexões. Linking it, or "Agora não", hides it.
 */
export function CaetanoZapCard() {
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const whatsapp = useQuery(api.whatsappData.state, {});

  if (whatsapp?.configured !== true || whatsapp.connected) return null;

  return (
    <CaetanoZap
      onOpen={() => {
        setOpenMobile(false);
        void navigate({ to: "/perfil/conexoes" });
      }}
    />
  );
}

/** The card itself; it hides on its own for a week after "Agora não". */
export function CaetanoZap({ onOpen }: { onOpen: () => void }) {
  const dismissed = useDismissed();
  const reduced = useReducedMotion();
  const caetano = useRef<CaetanoHandle>(null);
  const [hovered, setHovered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const typing = useTypingBubble(!dismissed && !reduced && !leaving);

  if (dismissed) return null;

  const open = () => {
    caetano.current?.play("jump");
    onOpen();
  };

  const dismiss = () => {
    if (reduced) dismissForAWeek();
    else setLeaving(true);
  };

  return (
    <div
      className="caetano-zap"
      data-hovered={hovered || undefined}
      data-leaving={leaving || undefined}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) dismissForAWeek();
      }}
      onPointerEnter={() => {
        setHovered(true);
        caetano.current?.play("wave");
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <div className="caetano-zap-stage">
        <div className="caetano-zap-peek">
          <div className="caetano-zap-lift">
            <Caetano ref={caetano} state="read" size={96} />
          </div>
        </div>
        <span aria-hidden="true" className="caetano-zap-bubble" data-on={typing || undefined}>
          <i />
          <i />
          <i />
        </span>
      </div>

      <button type="button" onClick={open} className="caetano-zap-card">
        <span className="block pr-6 text-body font-medium text-text">Me chama no zap</span>
        <span className="mt-1 block text-body-sm text-text-3">
          Manda um áudio, uma foto ou “faz um post”. Eu respondo por lá.
        </span>
      </button>

      <button type="button" aria-label="Agora não" onClick={dismiss} className="caetano-zap-close">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
