import { useState } from "react";
import { useAction } from "convex/react";
import { Instagram } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { OnboardingSplit } from "./onboarding-shell";

/**
 * Step 1 — the only hard requirement. Connecting Instagram is a full-page
 * round-trip through the publisher's white-label OAuth page (startConnect →
 * connect page → back to /onboarding?accountId=…), so this step just kicks it
 * off; the wizard resumes once the connection syncs.
 */
export function ConnectStep({ accountId }: { accountId?: Id<"accounts"> }) {
  const startConnect = useAction(api.publisherConnect.startConnect);
  const [status, setStatus] = useState<"idle" | "connecting" | "error">("idle");

  async function connect() {
    setStatus("connecting");
    try {
      const { url } = await startConnect({
        ...(accountId ? { accountId } : {}),
        origin: window.location.origin,
      });
      window.location.href = url;
    } catch {
      setStatus("error");
    }
  }

  return (
    <OnboardingSplit
      current="conectar"
      aperture={{ caption: "A orquídea como lente", sub: "Sempre no melhor momento de publicar" }}
    >
      <h1 className="text-[30px] font-semibold leading-[1.12] tracking-[-0.03em]">
        Sua agência de marketing,
        <br />
        no automático.
      </h1>
      <p className="mt-3 text-[14.5px] leading-[1.55] text-text-3">
        Conecte seu Instagram — a Vanda lê sua conta e já começa a entender seu negócio.
      </p>

      <Button
        variant="brand"
        size="xl"
        className="mt-7 w-full"
        disabled={status === "connecting"}
        onClick={connect}
      >
        <Instagram />
        {status === "connecting" ? "Conectando…" : "Conectar Instagram"}
      </Button>

      {status === "error" ? (
        <p className="mt-3 text-[13px] text-amber">
          Não consegui conectar.{" "}
          <button type="button" className="underline underline-offset-2" onClick={connect}>
            Tentar de novo
          </button>
        </p>
      ) : (
        <p className="mt-3 text-[12px] text-text-5">Conexão segura · você controla tudo</p>
      )}
    </OnboardingSplit>
  );
}
