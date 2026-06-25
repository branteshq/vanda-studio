import { Show, SignInButton } from "@clerk/tanstack-react-start";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@vanda-studio/ui/components/button";
import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import { getInstagramRedirectUri } from "../instagramRedirect";

export const Route = createFileRoute("/instagram/callback")({
  component: InstagramCallbackRoute,
});

export function InstagramCallbackRoute() {
  const completeOAuth = useAction(api.instagramGraphActions.completeOAuth);
  const [message, setMessage] = useState("Finalizando conexão com o Instagram...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const metaError = params.get("error_description") ?? params.get("error");
    if (metaError) {
      setError(metaError);
      return;
    }
    if (!code || !state) {
      setError("O Meta não retornou o código e o state do OAuth.");
      return;
    }

    void completeOAuth({
      code,
      state,
      redirectUri: getInstagramRedirectUri(),
    })
      .then((result) => {
        setMessage(
          result.handle ? `Instagram @${result.handle} conectado.` : "Instagram conectado.",
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [completeOAuth]);

  return (
    <main className="grid min-h-svh place-items-center bg-background px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-4">
          Instagram
        </p>
        <Show when="signed-out">
          <h1 className="mt-3 text-[17px] font-semibold tracking-[-0.018em]">
            Entre para finalizar.
          </h1>
          <div className="mt-5 flex justify-center">
            <SignInButton mode="modal">
              <Button type="button" variant="brand" size="lg">
                Entrar
              </Button>
            </SignInButton>
          </div>
        </Show>
        <Show when="signed-in">
          <h1 className="mt-3 text-[17px] font-semibold tracking-[-0.018em]">
            {error ? "Falha na conexão." : "Status da conexão"}
          </h1>
          <p
            className={`mx-auto mt-2 max-w-sm text-[13.5px] leading-[1.5] ${
              error ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {error ?? message}
          </p>
          <div className="mt-5 flex justify-center">
            <Button variant="outline" size="lg" render={<Link to="/perfil" />}>
              Ir para o perfil
            </Button>
          </div>
        </Show>
      </div>
    </main>
  );
}
