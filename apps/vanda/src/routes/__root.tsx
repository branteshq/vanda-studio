import type { ReactNode } from "react";
import { ClerkProvider, useAuth } from "@clerk/tanstack-react-start";
import { Link, Outlet, Scripts, createRootRoute, HeadContent } from "@tanstack/react-router";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache";
import { TooltipProvider } from "@vanda-studio/ui/components/tooltip";
import { getConvexClient } from "../convexClient";
import appCss from "../styles.css?url";
import vandaMarkIconUrl from "@vanda-studio/ui/assets/vanda-mark.svg?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Vanda Studio" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: vandaMarkIconUrl },
      { rel: "apple-touch-icon", href: vandaMarkIconUrl },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
});

function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center bg-app text-text">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[32px] font-semibold leading-none tracking-[-0.03em]">404</p>
        <p className="text-body text-text-3">Essa página não existe.</p>
        <Link to="/" className="text-body-sm text-brand-accent hover:underline">
          Voltar para a Vanda
        </Link>
      </div>
    </main>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  const convex = getConvexClient();

  return (
    <html lang="pt-BR" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <ClerkProvider signInUrl="/login" signInFallbackRedirectUrl="/">
          <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            {/* Keeps query subscriptions warm ~5min after unmount: navigating back to
                any screen renders instantly from live local data instead of a refetch. */}
            <ConvexQueryCacheProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </ConvexQueryCacheProvider>
          </ConvexProviderWithClerk>
        </ClerkProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
