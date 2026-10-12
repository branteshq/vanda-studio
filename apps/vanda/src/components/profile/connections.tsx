import { useEffect, useState } from "react";
import { ChevronRight, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { DropdownMenuItem, DropdownMenuSeparator } from "@vanda-studio/ui/components/dropdown-menu";
import { OpenAiIcon } from "@vanda-studio/ui/components/model-marks";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage } from "../../errors";
import { ServiceTile, SettingsRow, StatusMenu } from "./layout";
import { useProfileRuntime } from "./runtime";

/**
 * One business's Instagram connection through the publisher (Upload-Post). On
 * mount it re-syncs once: that's how returning from the connect page
 * (redirected to /perfil) picks up a fresh connection.
 */
export function InstagramConnectionRow({
  accountId,
  name,
}: {
  accountId: Id<"accounts">;
  name: string;
}) {
  const { status, startConnect, syncConnection } =
    useProfileRuntime().usePublisherConnection(accountId);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void syncConnection({ accountId }).catch((cause) => setError(errorMessage(cause)));
  }, [accountId, syncConnection]);

  const connect = async () => {
    setBusy(true);
    setError(null);

    try {
      const { url } = await startConnect({
        accountId,
        origin: window.location.origin,
      });

      window.location.href = url;
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  // Listed under the Instagram card's header, so the row names only the business.
  return (
    <SettingsRow
      inset
      title={name}
      detail={
        status?.connected
          ? `${status.handle ? `@${status.handle} · ` : ""}publica e lê métricas`
          : "Conecte para a Vanda publicar e ler as métricas"
      }
      footer={error ? <p className="mt-2 text-body-sm text-destructive">{error}</p> : null}
    >
      {status?.connected ? (
        <StatusMenu
          tone="on"
          label="Conectado"
          meta={status.handle ? `@${status.handle}` : name}
        >
          <DropdownMenuItem disabled={busy} onClick={() => void connect()}>
            <RefreshCw />
            Reconectar
          </DropdownMenuItem>
        </StatusMenu>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || status === undefined}
          onClick={() => void connect()}
        >
          {busy ? "Abrindo…" : "Conectar"}
          <ChevronRight className="text-text-4" />
        </Button>
      )}
    </SettingsRow>
  );
}

/**
 * The ChatGPT plan's OpenAI connection: shows the state and runs the
 * device-code flow, a short code the owner types at openai.com, polled here
 * until approval lands.
 */
export function OpenAiConnectionRow() {
  const { status, startDeviceAuth, pollDeviceAuth, disconnect } =
    useProfileRuntime().useOpenAiConnection();

  const [device, setDevice] = useState<{
    deviceAuthId: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds: number;
  } | null>(null);

  const [flowState, setFlowState] = useState<"idle" | "starting" | "waiting" | "failed">("idle");
  const [flowError, setFlowError] = useState<string | null>(null);

  // Poll while a device code is outstanding; stop on approval or failure.
  useEffect(() => {
    if (!device || flowState !== "waiting") return;
    let cancelled = false;

    const timer = setInterval(
      () => {
        void pollDeviceAuth({ deviceAuthId: device.deviceAuthId, userCode: device.userCode })
          .then((result) => {
            if (cancelled) return;

            if (result.status === "complete") {
              setDevice(null);
              setFlowState("idle");
            } else if (result.status === "failed") {
              setFlowError(errorMessage(result.message));
              setFlowState("failed");
            }
          })
          .catch(() => {});
      },
      Math.max(device.intervalSeconds, 3) * 1000,
    );

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [device, flowState, pollDeviceAuth]);

  const connect = async () => {
    setFlowState("starting");
    setFlowError(null);

    try {
      const info = await startDeviceAuth();
      setDevice(info);
      setFlowState("waiting");
    } catch (cause) {
      setFlowError(errorMessage(cause));
      setFlowState("failed");
    }
  };

  return (
    <SettingsRow
      icon={
        <ServiceTile>
          <OpenAiIcon className="size-4" />
        </ServiceTile>
      }
      title="OpenAI"
      detail={
        status?.connected
          ? "Pela sua assinatura do ChatGPT, sem custo extra"
          : "Conecte para usar sua assinatura do ChatGPT"
      }
      footer={
        <>
          {!status?.connected && device && flowState === "waiting" ? (
            <div className="mt-3.5 ml-11.5 rounded-lg border border-line bg-app p-4 text-center shadow-sunken">
              <p className="text-body-sm text-text-3">
                Acesse{" "}
                <a
                  href={device.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-text underline underline-offset-2"
                >
                  {device.verificationUri.replace("https://", "")}
                </a>{" "}
                e digite o código:
              </p>
              <p className="mt-2 font-mono text-2xl font-semibold tracking-widest">
                {device.userCode}
              </p>
              <p className="mt-2 flex items-center justify-center gap-2 text-xs text-text-4">
                <Spinner className="size-3" /> aguardando aprovação…
              </p>
            </div>
          ) : null}
          {flowError ? (
            <p className="mt-2 ml-11.5 text-body-sm text-destructive">{flowError}</p>
          ) : null}
        </>
      }
    >
      {status?.connected ? (
        <StatusMenu tone="on" label="Conectado" meta="Usada em conversas e imagens">
          <DropdownMenuItem variant="destructive" onClick={() => void disconnect()}>
            <Unplug />
            Desconectar
          </DropdownMenuItem>
        </StatusMenu>
      ) : flowState === "waiting" ? (
        <StatusMenu tone="pending" label="Aguardando" meta="Digite o código em openai.com">
          <DropdownMenuItem onClick={() => void connect()}>
            <RefreshCw />
            Gerar outro código
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setDevice(null);
              setFlowState("idle");
            }}
          >
            Cancelar
          </DropdownMenuItem>
        </StatusMenu>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={flowState === "starting"}
          onClick={() => void connect()}
        >
          {flowState === "starting" ? "Gerando código…" : "Conectar"}
        </Button>
      )}
    </SettingsRow>
  );
}
