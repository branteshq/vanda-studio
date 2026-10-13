import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAction } from "convex/react";
import { MessageCircle } from "lucide-react";
import { encode } from "uqr";
import { Button, buttonVariants } from "@vanda-studio/ui/components/button";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../../convex/_generated/api";
import { Caetano } from "../caetano";
import { OnboardingCenter } from "./onboarding-shell";

export type WhatsAppLink = { url: string; webUrl: string; expiresAt: number };

/** "Agora não" in onboarding is final on this browser: the sidebar card is the only reminder. */
const SKIP_KEY = "vanda:onboarding-zap-skipped";

export const readZapSkipped = (): boolean => {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
};

export const skipZapOffer = () => {
  try {
    localStorage.setItem(SKIP_KEY, "1");
  } catch {
    // Private mode: the offer may come back on the next business's onboarding.
  }
};

const PHONE_QUERY = "(hover: none) and (pointer: coarse)";

const subscribePhone = (onChange: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
};

/** A phone opens WhatsApp straight from the link; a computer scans a QR code with one. */
export const usePhone = (): boolean =>
  useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );

/** Make a new link this long before the old one expires, so the QR code never goes stale. */
const RENEW_BEFORE_MS = 30_000;

/**
 * A link-to-WhatsApp while `active`, renewed by itself before its 10 minutes
 * run out. Each new link replaces the last one on the server.
 */
export function useWhatsAppLink(active: boolean) {
  const createLink = useAction(api.whatsapp.createLink);
  const [link, setLink] = useState<WhatsAppLink | null>(null);
  const [renewing, setRenewing] = useState(false);
  // A failure stops the renewals; "Tentar de novo" clears it, which starts them again.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active || failed) return;
    let cancelled = false;
    let timer: number | undefined;

    const make = async () => {
      setRenewing(true);

      try {
        const next = await createLink();

        if (cancelled) return;
        setLink(next);
        const wait = Math.max(5_000, next.expiresAt - Date.now() - RENEW_BEFORE_MS);
        timer = window.setTimeout(() => void make(), wait);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setRenewing(false);
      }
    };

    void make();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, createLink, failed]);

  return { link, renewing, failed, retry: () => setFailed(false) };
}

/** "+55 11 98765-4321" for a Brazilian number; otherwise "+" and the digits. */
export function formatPhone(digits: string): string {
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);

  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${digits}`;
}

/** The QR code of a link, dark on white whatever the theme, so every camera reads it. */
export function QrCode({ value, renewing }: { value: string | null; renewing: boolean }) {
  const qr = useMemo(() => (value ? encode(value, { ecc: "L", border: 0 }) : null), [value]);

  const path = useMemo(() => {
    if (!qr) return "";
    let d = "";

    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );

    return d;
  }, [qr]);

  return (
    <div className="relative mt-6 rounded-xl bg-white p-3 shadow-raised">
      {qr ? (
        <svg
          role="img"
          aria-label="QR code que abre o WhatsApp com a mensagem pronta"
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          className="block size-44 text-qr-ink"
        >
          <path d={path} fill="currentColor" />
        </svg>
      ) : (
        <div className="size-44" />
      )}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center rounded-xl bg-white/85 text-body-sm text-qr-ink/60 opacity-0 transition-opacity duration-200",
          (renewing || !qr) && "opacity-100",
        )}
      >
        {qr ? "Renovando…" : "Gerando…"}
      </div>
    </div>
  );
}

/** Caetano's offer under "Guia pronto.": one line and two equal choices. */
export function WhatsAppOffer({
  phone,
  link,
  onAccept,
  onSkip,
  className,
}: {
  phone: boolean;
  /** On a phone the button is the link itself, so it is ready before the tap. */
  link: WhatsAppLink | null;
  onAccept: () => void;
  onSkip: () => void;
  className?: string;
}) {
  const accept = phone ? (
    <a
      className={cn(
        buttonVariants({ variant: "brand", size: "lg" }),
        "max-sm:h-11 max-sm:w-full",
        !link && "pointer-events-none opacity-50",
      )}
      href={link?.url}
      aria-disabled={!link}
      target="_blank"
      rel="noreferrer"
      onClick={onAccept}
    >
      <MessageCircle />
      Me chama no WhatsApp
    </a>
  ) : (
    <Button variant="brand" size="lg" onClick={onAccept}>
      <MessageCircle />
      Me chama no WhatsApp
    </Button>
  );

  return (
    <div className={cn("mt-7 w-full max-w-85 border-t border-line pt-5.5", className)}>
      <p className="text-sm leading-relaxed text-text-2">
        Eu também tô no WhatsApp.{" "}
        <span className="text-text">Manda um áudio, uma foto ou “faz um post”</span> e eu respondo
        por lá.
      </p>
      <div className="mt-4 flex justify-center gap-2 max-sm:flex-col">
        {accept}
        <Button
          variant="secondary"
          size="lg"
          className="max-sm:h-11 max-sm:w-full"
          onClick={onSkip}
        >
          Agora não
        </Button>
      </div>
      <p className="mt-4 text-body-sm text-text-5">
        Só conecta se você mandar a mensagem. Dá pra fazer depois em Perfil › Conexões.
      </p>
    </div>
  );
}

/** Waiting for the owner's own message: a QR code on a computer, WhatsApp again on a phone. */
export function WhatsAppWaiting({
  phone,
  link,
  renewing,
  failed,
  retry,
  onSkip,
}: {
  phone: boolean;
  link: WhatsAppLink | null;
  renewing: boolean;
  failed: boolean;
  retry: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <h1 className="mt-1.5 animate-finish-up text-2xl font-semibold tracking-tight">
        {phone ? "Agora é só enviar." : "Aponta a câmera do celular."}
      </h1>
      <p className="finish-follow-2 mt-2 max-w-xs animate-finish-up text-sm leading-relaxed text-text-3">
        {phone
          ? "Abri o WhatsApp com uma mensagem pronta pra mim. Toca em enviar e volta aqui."
          : "O WhatsApp abre com uma mensagem pronta pra mim. Toca em enviar e pronto."}
      </p>

      {phone ? null : <QrCode value={link?.url ?? null} renewing={renewing} />}

      {failed ? (
        <p className="mt-4.5 text-body text-amber">
          Não consegui gerar o link.{" "}
          <button type="button" className="underline underline-offset-2" onClick={retry}>
            Tentar de novo
          </button>
        </p>
      ) : (
        <p className="mt-4.5 inline-flex items-center gap-2 text-body text-text-3" role="status">
          <span className="size-1.75 animate-caetano-dot rounded-full bg-brand-soft" />
          Esperando sua mensagem…
        </p>
      )}

      {phone ? (
        <a
          className={cn(
            buttonVariants({ variant: "secondary", size: "lg" }),
            "mt-5 h-11 w-full max-w-80",
            !link && "pointer-events-none opacity-50",
          )}
          href={link?.url}
          aria-disabled={!link}
          target="_blank"
          rel="noreferrer"
        >
          Abrir o WhatsApp de novo
        </a>
      ) : null}

      <p className="mt-4 text-body-sm text-text-5">
        {!phone && link ? (
          <>
            Sem o celular aí?{" "}
            <a className="text-text-3" href={link.webUrl} target="_blank" rel="noreferrer">
              {/* The app resets anchor underlines, so the span carries it. */}
              <span className="underline decoration-text-5 underline-offset-3">
                Abrir no WhatsApp Web
              </span>
            </a>
            {" · "}
          </>
        ) : null}
        <button
          type="button"
          className="text-text-3 underline decoration-text-5 underline-offset-3"
          onClick={onSkip}
        >
          Agora não
        </button>
      </p>
    </>
  );
}

/** The owner's message arrived: linked, and Caetano already replied in WhatsApp. */
export function WhatsAppLinked({
  sender,
  onStart,
}: {
  sender: string | null;
  onStart: () => void;
}) {
  return (
    <OnboardingCenter>
      <Caetano state="cheer" size={168} intro="jump" onClickMove="jump" />
      <h1 className="mt-2 animate-finish-up text-2xl font-semibold tracking-tight">
        Tô no seu zap.
      </h1>
      <p className="finish-follow-2 mt-2 max-w-xs animate-finish-up text-sm leading-relaxed text-text-3">
        Já te respondi lá.
        {sender ? (
          <>
            {" "}
            Conectado como{" "}
            <span className="whitespace-nowrap text-text-2">{formatPhone(sender)}</span>.
          </>
        ) : null}
      </p>
      <div className="finish-follow-3 mt-7 animate-finish-up">
        <Button variant="brand" size="lg" onClick={onStart}>
          Começar a criar
        </Button>
      </div>
    </OnboardingCenter>
  );
}
