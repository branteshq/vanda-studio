import type { CSSProperties } from "react";
import { RedirectToSignIn, Show } from "@clerk/tanstack-react-start";
import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { SidebarInset, SidebarProvider } from "@vanda-studio/ui/components/sidebar";
import { TooltipProvider } from "@vanda-studio/ui/components/tooltip";
import { AppSidebar } from "../components/app-sidebar";
import { api } from "../convex/_generated/api";

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
        <DashboardGate />
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
  const accounts = useQuery(api.accounts.listMine);
  if (accounts === undefined) return <div className="min-h-svh bg-app" />;
  if (!accounts.some((account) => account.onboardedAt != null)) {
    return <Navigate to="/onboarding" />;
  }
  return (
    <TooltipProvider>
      <SidebarProvider style={{ "--sidebar-width": "15rem" } as CSSProperties}>
        <AppSidebar />
        <SidebarInset className="flex h-svh flex-col overflow-hidden bg-app">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
