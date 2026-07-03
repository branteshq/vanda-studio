import { AuthenticateWithRedirectCallback } from "@clerk/tanstack-react-start";
import { createFileRoute } from "@tanstack/react-router";
import { Spinner } from "@vanda-studio/ui/components/spinner";

export const Route = createFileRoute("/sso-callback")({
  component: SsoCallback,
});

function SsoCallback() {
  return (
    <main className="grid min-h-svh place-items-center bg-app">
      <div className="flex flex-col items-center gap-4">
        <Spinner className="size-5 text-text-3" />
        <p className="text-[13px] text-text-3">Entrando…</p>
      </div>
      <AuthenticateWithRedirectCallback signInForceRedirectUrl="/" signUpForceRedirectUrl="/" />
    </main>
  );
}
