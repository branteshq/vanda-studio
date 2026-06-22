import type { CSSProperties } from "react";
import { RedirectToSignIn, Show } from "@clerk/tanstack-react-start";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@vanda-studio/ui/components/sidebar";
import { TooltipProvider } from "@vanda-studio/ui/components/tooltip";
import { AppSidebar } from "../components/app-sidebar";

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
        <TooltipProvider>
          <SidebarProvider style={{ "--sidebar-width": "15rem" } as CSSProperties}>
            <AppSidebar />
            <SidebarInset className="flex h-svh flex-col overflow-hidden bg-vanda-surface">
              <DashboardSidebarTrigger />
              <Outlet />
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </Show>
    </>
  );
}
function DashboardSidebarTrigger() {
  const { state } = useSidebar();

  return (
    <header
      className={
        state === "collapsed"
          ? "flex h-14 shrink-0 items-start px-3 pt-3.5"
          : "flex h-[72px] shrink-0 items-start px-3 pt-[22px]"
      }
    >
      <SidebarTrigger className="size-7 text-vanda-muted-2 hover:bg-sidebar-accent hover:text-sidebar-foreground" />
    </header>
  );
}

