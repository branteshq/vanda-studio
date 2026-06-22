import type { ComponentType } from "react";
import { UserButton, useUser } from "@clerk/tanstack-react-start";
import { Link, useRouterState } from "@tanstack/react-router";
import { Calendar, ChevronsUpDown, LayoutGrid, Plus, RefreshCw, Sparkles, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@vanda-studio/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@vanda-studio/ui/components/sidebar";

type DashboardPath = "/" | "/automatico" | "/galeria" | "/calendario" | "/perfil";

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

const WORKSPACE = { name: "Café Lumiar", plan: "Plano Pro", initials: "CL" };

function WorkspaceSwitcher() {
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="gap-[9px] border border-[#261f28] bg-[#161117] px-2 transition-colors duration-200 hover:bg-[#1b1620] data-popup-open:bg-[#1b1620] group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent"
              />
            }
          >
            <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-[7px] bg-[#2a2330] text-[11px] font-semibold text-[#ccc6cc]">
              {WORKSPACE.initials}
            </span>
            <span className="grid flex-1 text-left leading-tight">
              <span className="truncate text-[13px] font-semibold">{WORKSPACE.name}</span>
              <span className="truncate text-[11px] text-vanda-muted-2">{WORKSPACE.plan}</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4 text-vanda-muted-2" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Negócios</DropdownMenuLabel>
              <DropdownMenuItem className="gap-2 p-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#2a2330] text-[10px] font-semibold text-[#ccc6cc]">
                  {WORKSPACE.initials}
                </span>
                {WORKSPACE.name}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem className="gap-2 p-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md border">
                  <Plus className="size-4" />
                </span>
                <span className="font-medium text-muted-foreground">Adicionar negócio</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useUser();

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="px-3 py-3 group-data-[collapsible=icon]:px-2">
        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent className="px-3 group-data-[collapsible=icon]:px-2">
        <SidebarGroup className="p-0">
          <SidebarMenu className="gap-0.5">
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    render={<Link to={item.to} />}
                    isActive={active}
                    tooltip={item.label}
                    className="h-[32px] gap-[11px] px-2.5 text-[13px] font-medium text-sidebar-foreground/55 transition-colors duration-150 data-active:text-sidebar-accent-foreground"
                  >
                    <Icon className="size-4" />
                    <span className="flex-1 group-data-[collapsible=icon]:hidden">{item.label}</span>
                    {item.live ? (
                      <span
                        className="flex items-center group-data-[collapsible=icon]:hidden"
                        aria-label="ao vivo"
                        title="ao vivo"
                      >
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

      <SidebarFooter className="gap-0 px-3 pb-3 group-data-[collapsible=icon]:px-2">
        <div className="mb-3 rounded-[10px] border border-[#261f28] bg-card p-3 group-data-[collapsible=icon]:hidden">
          <div className="mb-[9px] flex items-center justify-between">
            <span className="flex items-center gap-[7px] text-[12.5px] font-semibold text-[#ccc6cc]">
              <Sparkles className="size-[15px] text-vanda-accent-soft" />
              Vanda IA
            </span>
            <span className="text-[12px] font-semibold text-vanda-muted-2">62%</span>
          </div>
          <div className="h-[5px] overflow-hidden rounded-full bg-[#261f28]">
            <div className="h-full rounded-full bg-primary" style={{ width: "62%" }} />
          </div>
        </div>

        <div className="flex items-center gap-[10px] border-t border-vanda-line-2 px-1.5 pt-3 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-t-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:pt-0">
          <UserButton
            appearance={{
              elements: {
                userButtonAvatarBox: "size-[30px]",
                userButtonTrigger: "rounded-full focus:shadow-none",
              },
            }}
          />
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-[12.5px] font-semibold">
              {user?.fullName ?? user?.username ?? "Minha conta"}
            </span>
            <span className="block truncate text-[11px] text-vanda-muted-2">
              {user?.primaryEmailAddress?.emailAddress ?? ""}
            </span>
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
