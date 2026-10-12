import { useEffect, useState } from "react";
import { Button } from "@vanda-studio/ui/components/button";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage } from "../../errors";
import { ProfileRow } from "./layout";
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

  // Listed under an "Instagram" label, so the row names only the business.
  // Reconectar stays visible: it is what the owner reaches for when posting breaks.
  return (
    <ProfileRow
      tone={status?.connected ? "on" : "off"}
      title={name}
      detail={
        status?.connected
          ? `Conectado${status.handle ? ` como @${status.handle}` : ""}`
          : "Conecte para a Vanda publicar e ler as métricas deste negócio."
      }
      actions={
        <Button
          variant={status?.connected ? "subtle" : "default"}
          size="sm"
          disabled={busy || status === undefined}
          onClick={() => void connect()}
        >
          {busy ? "Abrindo…" : status?.connected ? "Reconectar" : "Conectar"}
        </Button>
      }
    >
      {error ? <p className="mt-2 pl-4.5 text-body-sm text-destructive">{error}</p> : null}
    </ProfileRow>
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
    <ProfileRow
      tone={status?.connected ? "on" : flowState === "waiting" ? "pending" : "off"}
      title="Conta OpenAI"
      detail={
        status?.connected
          ? "Conectada. Conversas e imagens usam sua assinatura do ChatGPT."
          : "Conecte para usar sua assinatura do ChatGPT no plano ChatGPT."
      }
      quiet={
        status?.connected ? (
          <Button variant="subtle" size="sm" onClick={() => void disconnect()}>
            Desconectar
          </Button>
        ) : null
      }
      actions={
        status?.connected || flowState === "waiting" ? null : (
          <Button size="sm" disabled={flowState === "starting"} onClick={() => void connect()}>
            {flowState === "starting" ? "Gerando código…" : "Conectar"}
          </Button>
        )
      }
    >
      {!status?.connected && device && flowState === "waiting" ? (
        <div className="mt-3 ml-4.5 rounded-lg bg-inset p-4 text-center">
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
          <p className="mt-2 font-mono text-2xl font-semibold tracking-widest">{device.userCode}</p>
          <p className="mt-2 flex items-center justify-center gap-2 text-xs text-text-4">
            <Spinner className="size-3" /> aguardando aprovação…
          </p>
        </div>
      ) : null}

      {flowError ? <p className="mt-2 pl-4.5 text-body-sm text-destructive">{flowError}</p> : null}
    </ProfileRow>
  );
}
