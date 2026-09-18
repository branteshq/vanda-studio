import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Button } from "@vanda-studio/ui/components/button";
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
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <h3 className="text-body font-semibold">Caetano no WhatsApp</h3>
      <p className="mt-1 text-body-sm text-text-3">
        A mesma conversa do aplicativo, com acesso aos seus negócios. Esta conexão pertence a você,
        não apenas ao negócio ativo.
      </p>
      {state === undefined ? (
        <p className="mt-3 text-body-sm">Carregando…</p>
      ) : state.connected ? (
        <>
          <p className="mt-3 text-body-sm">Conectado{state.sender ? `: +${state.sender}` : ""}</p>
          <Button
            className="mt-3"
            variant="outline"
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
            Desconectar WhatsApp
          </Button>
        </>
      ) : (
        <>
          <p className="mt-3 text-body-sm text-text-3">
            Gere o vínculo abaixo e envie a mensagem pronta pelo seu WhatsApp. O link expira em 10
            minutos; não compartilhe.
          </p>
          <Button
            className="mt-3"
            disabled={busy || !state.configured}
            onClick={() => void run(async () => setLink(await createLink()))}
          >
            {busy ? "Gerando…" : "Conectar WhatsApp"}
          </Button>
          {!state.configured ? (
            <p className="mt-2 text-xs text-text-4">
              A conexão com o WhatsApp ainda não está disponível.
            </p>
          ) : null}
          {link ? (
            <p className="mt-3 text-body-sm">
              <a className="underline" href={link.url} target="_blank" rel="noreferrer">
                Abrir WhatsApp e enviar vínculo
              </a>
              <span className="ml-2 text-text-3">
                Válido até {new Date(link.expiresAt).toLocaleTimeString("pt-BR")}.
              </span>
            </p>
          ) : null}
        </>
      )}
      {state?.deliveries.length ? (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="text-body-sm font-medium">Entregas recentes</h4>
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
        </div>
      ) : null}
      <p className="mt-3 text-xs text-text-4">
        Envie “parar” para interromper. Respostas do WhatsApp aparecem também no aplicativo. Pedidos
        feitos só no aplicativo não são enviados ao WhatsApp. Por enquanto, envie apenas texto.
      </p>
    </section>
  );
}
