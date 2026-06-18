import type { ComponentType } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Calendar,
  ChevronDown,
  LayoutGrid,
  RefreshCw,
  Settings,
  Sparkles,
  User,
} from "lucide-react";
import { cn } from "@vanda-studio/ui/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@vanda-studio/ui/components/sidebar";
import { VandaMark } from "./vanda-mark";

type DashboardPath =
  | "/"
  | "/automatico"
  | "/galeria"
  | "/calendario"
  | "/perfil";

interface NavItem {
  label: string;
  to: DashboardPath;
  icon: ComponentType<{ className?: string }>;
  exact?: boolean;
  live?: boolean;
  badge?: string;
}

const NAV: NavItem[] = [
  { label: "Início", to: "/", icon: Home, exact: true },
  { label: "Automático", to: "/automatico", icon: RefreshCw, live: true },
  { label: "Galeria", to: "/galeria", icon: LayoutGrid, badge: "8" },
  { label: "Calendário", to: "/calendario", icon: Calendar },
  { label: "Perfil", to: "/perfil", icon: User },
];

function Home(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden="true"
    >
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  );
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="offcanvas" className="border-sidebar-border">
      <SidebarHeader className="gap-0 px-3 pt-4">
        <Link to="/" className="flex items-center gap-[9px] px-2 pb-4">
          <VandaMark size={26} />
          <span className="text-[13.5px] font-semibold tracking-[-0.018em]">
            Vanda<span className="text-vanda-muted-2"> Studio</span>
          </span>
        </Link>

        <button
          type="button"
          className="mb-4 flex w-full items-center gap-[9px] rounded-[9px] border border-[#261f28] bg-[#161117] px-[9px] py-[7px] text-left transition-colors duration-200 hover:bg-[#1b1620]"
        >
          <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[#2a2330] text-[11px] font-semibold text-[#ccc6cc]">
            CL
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">
              Café Lumiar
            </span>
            <span className="block text-[11px] text-vanda-muted-2">
              Plano Pro
            </span>
          </span>
          <ChevronDown className="size-[15px] text-vanda-muted-2" />
        </button>
      </SidebarHeader>

      <SidebarContent className="px-3">
        <SidebarGroup className="p-0">
          <SidebarMenu className="gap-0.5">
            {NAV.map((item) => {
              const active = item.exact
                ? pathname === item.to
                : pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    render={<Link to={item.to} />}
                    isActive={active}
                    className="h-[32px] gap-[11px] px-2.5 text-[13px] font-medium text-sidebar-foreground/55 transition-colors duration-150 data-active:text-sidebar-accent-foreground"
                  >
                    <Icon className="size-4" />
                    <span className="flex-1">{item.label}</span>
                    {item.live ? (
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold text-vanda-positive">
                        <span className="size-1.5 rounded-full bg-vanda-positive shadow-[0_0_6px_var(--vanda-positive)]" />
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                  {item.badge ? (
                    <SidebarMenuBadge className="rounded-full bg-vanda-accent-soft-bg text-[11px] font-semibold text-vanda-accent-soft">
                      {item.badge}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-0 px-3 pb-3">
        <div className="mb-3 rounded-[10px] border border-[#261f28] bg-card p-3">
          <div className="mb-[9px] flex items-center justify-between">
            <span className="flex items-center gap-[7px] text-[12.5px] font-semibold text-[#ccc6cc]">
              <Sparkles className="size-[15px] text-vanda-accent-soft" />
              Vanda IA
            </span>
            <span className="text-[12px] font-semibold text-vanda-muted-2">
              62%
            </span>
          </div>
          <div className="h-[5px] overflow-hidden rounded-full bg-[#261f28]">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: "62%" }}
            />
          </div>
        </div>

        <div className="flex items-center gap-[10px] border-t border-vanda-line-2 px-1.5 pt-3">
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[#2c1f2a] text-[12px] font-semibold text-[#e2a3c8]">
            MA
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold">
              Marina Alves
            </span>
            <span className="block truncate text-[11px] text-vanda-muted-2">
              marina@cafelumiar.com
            </span>
          </span>
          <Settings className={cn("size-[17px] shrink-0 text-vanda-muted-2")} />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
