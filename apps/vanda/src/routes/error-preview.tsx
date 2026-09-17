import { createFileRoute, notFound } from "@tanstack/react-router";
import { Button } from "@vanda-studio/ui/components/button";
import { ErrorNotice, showErrorToast } from "../components/error-feedback";
import { errorCopy, publicError, type ErrorCode } from "../errors";
import { GalleryFailureMessage } from "./_dashboard.galeria";

export const Route = createFileRoute("/error-preview")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: ErrorPreview,
});

function ErrorPreview() {
  return (
    <main className="min-h-svh bg-app p-6 text-text">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Preview de erros</h1>
          <p className="mt-1 text-body-sm text-text-3">
            Somente desenvolvimento. Clique para testar o toast real.
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => showErrorToast(new Error("[CONVEX A] diagnostic-only-test"))}
          >
            Simular erro inesperado
          </Button>
        </div>
        <section aria-label="Erros da galeria" className="grid gap-4 md:grid-cols-2">
          {(["RECONNECT_REQUIRED", "PROVIDER_LIMIT"] as const).map((code) => (
            <div
              key={code}
              className="flex min-h-48 flex-col items-center justify-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center"
            >
              <GalleryFailureMessage code={code} />
            </div>
          ))}
        </section>
        <div className="grid gap-4 md:grid-cols-2">
          {(Object.keys(errorCopy) as ErrorCode[]).map((code) => (
            <section
              key={code}
              className="space-y-3 rounded-xl border border-border bg-surface p-4"
            >
              <div>
                <p className="font-mono text-xs text-text-4">{code}</p>
                <h2 className="font-semibold">{errorCopy[code].title}</h2>
              </div>
              <ErrorNotice code={code} />
              <Button size="sm" variant="outline" onClick={() => showErrorToast(publicError(code))}>
                Mostrar toast
              </Button>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
