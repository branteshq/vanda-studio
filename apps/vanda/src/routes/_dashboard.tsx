import { RedirectToSignIn, Show } from "@clerk/tanstack-react-start";
import { Navigate, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@vanda-studio/ui/components/sidebar";
import { AppSidebar, CollapsedSidebarControls } from "../components/app-sidebar";
import { ActiveAccountProvider, useActiveAccount } from "../components/active-account";
import { ModeNavProvider } from "../components/mode-nav";
import { PostsRailHost } from "../components/posts-rail";
import { WorkRailProvider } from "../components/work-rail";

export const Route = createFileRoute("/_dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <>
      <Show when="signed-out">
        <RedirectToSignIn />
      </Show>
      <Show when="signed-in">
        <ActiveAccountProvider>
          <DashboardGate />
        </ActiveAccountProvider>
      </Show>
    </>
  );
}

/**
 * Holds the dashboard behind onboarding: until at least one account is onboarded,
 * every dashboard route redirects to the flow. `listMine` is already loaded by the
 * sidebar, so this adds no extra round-trip.
 */
function DashboardGate() {
  const { accounts } = useActiveAccount();
  // /perfil is a full-page view (T3-style settings): same auth + account
  // context as the dashboard, none of the sidebar chrome.
  const fullBleed = useRouterState({
    select: (state) => state.location.pathname.startsWith("/perfil"),
  });
  if (accounts === undefined) return <div className="min-h-svh bg-app" />;
  if (!accounts.some((account) => account.onboardedAt != null)) {
    return <Navigate to="/onboarding" />;
  }
  if (fullBleed) return <Outlet />;
  return (
    <SidebarProvider defaultWidth={272}>
      <ModeNavProvider>
        <WorkRailProvider>
          <AppSidebar />
          <SidebarInset className="relative flex h-svh flex-col overflow-hidden bg-app">
            <CollapsedSidebarControls />
            <Outlet />
          </SidebarInset>
          {/* The right rail: its own provider (independent open state, cookie
              and shortcut) rendered display:contents so the Sidebar stays a
              flex sibling of the inset. */}
          <PostsRailHost />
        </WorkRailProvider>
      </ModeNavProvider>
    </SidebarProvider>
  );
}
