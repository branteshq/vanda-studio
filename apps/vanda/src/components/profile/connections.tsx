import { useEffect, useState } from "react";
import { Button } from "@vanda-studio/ui/components/button";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage } from "../../errors";
import { useProfileRuntime } from "./runtime";

/** A connection's state dot: green when live, muted otherwise. */
function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", on ? "bg-green" : "bg-text-5")}
    />
  );
}

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
    void syncConnection({ accountId }).catch(() => {});
  }, [accountId, syncConnection]);

  const connect = async () => {
    setBusy(true);
    setError(null);

    try {
      const { url } = await startConnect({
        accountId,
        origin: window.location.origin,
        returnTo: "perfil",
      });

      window.location.href = url;
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot on={status?.connected === true} />
          <div className="min-w-0">
            <p className="truncate text-body-sm font-medium">Instagram · {name}</p>
            <p className="text-xs text-text-4">
              {status?.connected
                ? `Conectado${status.handle ? ` como @${status.handle}` : ""}`
                : "Conecte para a Vanda publicar e ler as métricas deste negócio."}
            </p>
          </div>
        </div>
        <Button
          variant={status?.connected ? "outline" : "default"}
          size="sm"
          disabled={busy || status === undefined}
          onClick={() => void connect()}
        >
          {busy ? "Abrindo…" : status?.connected ? "Reconectar" : "Conectar"}
        </Button>
      </div>
      {error ? <p className="mt-2 text-body-sm text-destructive">{error}</p> : null}
    </div>
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
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <StatusDot on={status?.connected === true} />
          <div className="min-w-0">
            <p className="text-body-sm font-medium">Conta OpenAI</p>
            <p className="text-xs text-text-4">
              {status?.connected
                ? "Conectada. Conversas e imagens usam sua assinatura do ChatGPT."
                : "Conecte para usar sua assinatura do ChatGPT no plano ChatGPT."}
            </p>
          </div>
        </div>
        {status?.connected ? (
          <Button variant="outline" size="sm" onClick={() => void disconnect()}>
            Desconectar
          </Button>
        ) : flowState === "waiting" ? null : (
          <Button size="sm" disabled={flowState === "starting"} onClick={() => void connect()}>
            {flowState === "starting" ? "Gerando código…" : "Conectar"}
          </Button>
        )}
      </div>

      {!status?.connected && device && flowState === "waiting" ? (
        <div className="mt-3 rounded-lg border border-border bg-app p-4 text-center">
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

      {flowError ? <p className="mt-2 text-body-sm text-destructive">{flowError}</p> : null}
    </div>
  );
}
