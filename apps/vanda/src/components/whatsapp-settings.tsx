import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Button, buttonVariants } from "@vanda-studio/ui/components/button";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import { showErrorToast } from "./error-feedback";

type Link = { url: string; expiresAt: number };

const time = (at: number) =>
  new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** The pending link until it expires; null once it does, so the owner can make a new one. */
function useLiveLink(link: Link | null): Link | null {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setExpired(false);

    if (!link) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, link.expiresAt - Date.now()));

    return () => clearTimeout(timer);
  }, [link]);

  return link && !expired ? link : null;
}

export interface WhatsAppConnection {
  /** Undefined while loading. */
  readonly state:
    | Pick<
        FunctionReturnType<typeof api.whatsappData.state>,
        "configured" | "connected" | "sender" | "chatUrl"
      >
    | undefined;
  readonly createLink: () => Promise<Link>;
  readonly disconnect: () => Promise<void>;
}

export function WhatsAppSettings() {
  const state = useQuery(api.whatsappData.state);
  const createLink = useAction(api.whatsapp.createLink);
  const disconnect = useMutation(api.whatsappData.disconnect);

  return (
    <WhatsAppSettingsView
      state={state}
      createLink={() => createLink()}
      disconnect={async () => {
        await disconnect();
      }}
    />
  );
}

export function WhatsAppSettingsView({ state, createLink, disconnect }: WhatsAppConnection) {
  const [link, setLink] = useState<Link | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useLiveLink(state?.connected ? null : link);

  const run = async <Result,>(work: () => Promise<Result>) => {
    setBusy(true);

    try {
      await work();
    } catch (cause) {
      showErrorToast(cause);
    } finally {
      setBusy(false);
    }
  };

  const generate = () => void run(async () => setLink(await createLink()));

  // While a link is live, the one thing left is sending it: that is the button.
  const status =
    state === undefined
      ? "Carregando…"
      : state.connected
        ? `Conectado${state.sender ? `: +${state.sender}` : ""}`
        : pending
          ? "Aguardando sua mensagem no WhatsApp…"
          : link
            ? "O link expirou. Gere um novo para conectar."
            : "Converse com o Caetano pelo WhatsApp.";

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              "inline-block size-2 shrink-0 rounded-full",
              state?.connected ? "bg-green" : pending ? "bg-amber" : "bg-text-5",
            )}
          />
          <div className="min-w-0">
            <p className="text-body-sm font-medium">Caetano no WhatsApp</p>
            <p className="text-xs text-text-4">{status}</p>
          </div>
        </div>
        {state?.connected ? (
          <div className="flex gap-2">
            {state.chatUrl ? (
              <a
                className={buttonVariants({ size: "sm" })}
                href={state.chatUrl}
                target="_blank"
                rel="noreferrer"
              >
                Abrir conversa
              </a>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Desconectar o WhatsApp? Novas mensagens não terão acesso à sua conta. Uma mensagem já em envio pode chegar.",
                  )
                )
                  void run(async () => {
                    await disconnect();
                    setLink(null);
                  });
              }}
            >
              Desconectar
            </Button>
          </div>
        ) : pending ? (
          <a
            className={buttonVariants({ size: "sm" })}
            href={pending.url}
            target="_blank"
            rel="noreferrer"
          >
            Abrir WhatsApp
          </a>
        ) : state ? (
          <Button size="sm" disabled={busy || !state.configured} onClick={generate}>
            {busy ? "Gerando…" : link ? "Gerar novo link" : "Conectar"}
          </Button>
        ) : null}
      </div>
      {state && !state.connected && !state.configured ? (
        <p className="mt-2 text-xs text-text-4">
          A conexão com o WhatsApp ainda não está disponível.
        </p>
      ) : null}
      {pending ? (
        <p className="mt-2 text-xs text-text-3">
          O WhatsApp abre com uma mensagem pronta: toque em enviar. Válido até{" "}
          {time(pending.expiresAt)}. Não compartilhe.
        </p>
      ) : null}
    </div>
  );
}
