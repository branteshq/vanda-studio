import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Button, buttonVariants } from "@vanda-studio/ui/components/button";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import { errorMessage } from "../errors";
import { showErrorToast } from "./error-feedback";

const statuses = {
  pending: "Na fila",
  sending: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
  unknown: "Entrega não confirmada",
  awaiting_window: "Aguardando uma mensagem sua no WhatsApp",
  cancelled: "Cancelada",
} satisfies Record<string, string>;

export function WhatsAppSettings() {
  const state = useQuery(api.whatsappData.state);
  const createLink = useAction(api.whatsapp.createLink);
  const disconnect = useMutation(api.whatsappData.disconnect);
  const retry = useMutation(api.whatsappData.retryDelivery);
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
                  ? `Conectado${state.sender ? `: +${state.sender}` : ""}. O Caetano atende todos os seus negócios.`
                  : "O Caetano atende pelo WhatsApp, com acesso a todos os seus negócios."}
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
      {state?.deliveries.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-text-3 hover:text-text">
            Entregas recentes
          </summary>
          <ul className="mt-2 space-y-2">
            {state.deliveries.map((delivery) => (
              <li
                key={delivery.id}
                className="flex flex-wrap items-center justify-between gap-2 text-body-sm"
              >
                <span>
                  {statuses[delivery.status] ?? delivery.status}
                  {delivery.error ? (
                    <span className="block text-xs text-text-3">
                      {errorMessage(delivery.error)}
                    </span>
                  ) : null}
                </span>
                {["failed", "unknown"].includes(delivery.status) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Confira o WhatsApp antes de reenviar. Se a mensagem já chegou, esta ação enviará uma cópia. O Caetano não executará o pedido novamente.",
                        )
                      )
                        void run(() => retry({ id: delivery.id }));
                    }}
                  >
                    Reenviar resposta
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {state?.connected ? (
        <p className="mt-2 text-xs text-text-4">
          Envie texto, fotos ou áudios. Imagens e posts prontos chegam pela própria conversa, assim
          como os avisos de publicação. Envie “parar” para interromper.
        </p>
      ) : null}
    </div>
  );
}
