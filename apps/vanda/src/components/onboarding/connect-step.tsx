import { useState } from "react";
import { useAction } from "convex/react";
import { Instagram } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Caetano } from "../caetano";
import { OnboardingCenter } from "./onboarding-shell";

/**
 * Step 1 — the only hard requirement. Connecting Instagram is a full-page
 * round-trip through the publisher's white-label OAuth page (startConnect →
 * connect page → back to /onboarding?accountId=…), so this step just kicks it
 * off; the guide opens once the connection syncs. Caetano waves hello (and again on click).
 */
export function ConnectStep({ accountId }: { accountId?: Id<"accounts"> }) {
  const startConnect = useAction(api.publisherConnect.startConnect);
  const [status, setStatus] = useState<"idle" | "connecting" | "error">("idle");

  async function connect() {
    setStatus("connecting");

    try {
      const origin = window.location.origin;

      const { url } = await startConnect(
        accountId === undefined ? { origin } : { origin, accountId },
      );

      window.location.href = url;
    } catch {
      setStatus("error");
    }
  }

  return (
    <OnboardingCenter>
      <Caetano size={200} intro="wave" onClickMove="wave" className="mb-2" />
      <h1 className="text-2xl font-semibold tracking-tight">Oi, eu sou o Caetano.</h1>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-text-3">
        Conecta o Instagram. Eu leio o feed e monto o guia da marca que a Vanda usa em todo post.
      </p>

      <Button
        variant="brand"
        size="lg"
        className="mt-7"
        disabled={status === "connecting"}
        onClick={connect}
      >
        <Instagram />
        {status === "connecting" ? "Conectando…" : "Conectar Instagram"}
      </Button>

      {status === "error" ? (
        <p className="mt-3 text-body text-amber">
          Não consegui conectar.{" "}
          <button type="button" className="underline underline-offset-2" onClick={connect}>
            Tentar de novo
          </button>
        </p>
      ) : (
        <p className="mt-3.5 text-body-sm text-text-5">Conexão segura · você controla tudo</p>
      )}
    </OnboardingCenter>
  );
}
