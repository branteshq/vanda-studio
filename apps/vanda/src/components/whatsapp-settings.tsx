import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Button, buttonVariants } from "@vanda-studio/ui/components/button";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import { showErrorToast } from "./error-feedback";

export function WhatsAppSettings() {
  const state = useQuery(api.whatsappData.state);
  const createLink = useAction(api.whatsapp.createLink);
  const disconnect = useMutation(api.whatsappData.disconnect);
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              "inline-block size-2 shrink-0 rounded-full",
              state?.connected ? "bg-green" : "bg-text-5",
            )}
          />
          <div className="min-w-0">
            <p className="text-body-sm font-medium">Caetano no WhatsApp</p>
            <p className="text-xs text-text-4">
              {state === undefined
                ? "Carregando…"
                : state.connected
                  ? `Conectado${state.sender ? `: +${state.sender}` : ""}`
                  : "Converse com o Caetano pelo WhatsApp."}
            </p>
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
        ) : state ? (
          <Button
            size="sm"
            disabled={busy || !state.configured}
            onClick={() => void run(async () => setLink(await createLink()))}
          >
            {busy ? "Gerando…" : "Conectar"}
          </Button>
        ) : null}
      </div>
      {state && !state.connected && !state.configured ? (
        <p className="mt-2 text-xs text-text-4">
          A conexão com o WhatsApp ainda não está disponível.
        </p>
      ) : null}
      {link && !state?.connected ? (
        <p className="mt-3 rounded-lg border border-border bg-app px-3 py-2 text-body-sm">
          <a className="font-medium underline" href={link.url} target="_blank" rel="noreferrer">
            Abrir WhatsApp e enviar o vínculo
          </a>
          <span className="ml-2 text-text-3">
            Válido até {new Date(link.expiresAt).toLocaleTimeString("pt-BR")}. Não compartilhe.
          </span>
        </p>
      ) : null}
    </div>
  );
}
