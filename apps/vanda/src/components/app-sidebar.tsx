import type { ComponentType } from "react";
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BadgeCheckIcon,
  Calendar,
  ChevronsUpDown,
  LayoutGrid,
  LogOutIcon,
  Plus,
  RefreshCw,
  Sparkles,
  User,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@vanda-studio/ui/components/avatar";
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
                className="gap-[9px] border border-border-strong bg-inset px-2 transition-colors duration-200 hover:bg-accent data-popup-open:bg-accent group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent"
              />
            }
          >
            <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-sm bg-border-strong text-[11px] font-semibold text-text-2">
              {WORKSPACE.initials}
            </span>
            <span className="grid flex-1 text-left leading-tight">
              <span className="truncate text-[13px] font-semibold">{WORKSPACE.name}</span>
              <span className="truncate text-[11px] text-text-4">{WORKSPACE.plan}</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4 text-text-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Negócios
              </DropdownMenuLabel>
              <DropdownMenuItem className="gap-2 p-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-border-strong text-[10px] font-semibold text-text-2">
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

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function AccountMenu() {
  const { user } = useUser();
  const clerk = useClerk();
  const navigate = useNavigate();
  const name = user?.fullName ?? user?.username ?? "Minha conta";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const initials = getInitials(name) || "MC";
  const handleSignOut = async () => {
    await clerk.signOut();
    await navigate({ to: "/login" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            className="h-auto gap-[10px] rounded-[10px] px-1.5 py-1 text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0!"
          />
        }
      >
        <Avatar className="size-[30px]">
          <AvatarImage src={user?.imageUrl} alt={name} />
          <AvatarFallback className="text-[11px] font-semibold">{initials}</AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
          <span className="block truncate text-[12.5px] font-semibold">{name}</span>
          <span className="block truncate text-[11px] text-text-4">{email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56 rounded-lg" align="end" side="right" sideOffset={4}>
        <DropdownMenuGroup>
          <DropdownMenuItem className="gap-2 p-2" onClick={() => clerk.openUserProfile()}>
            <BadgeCheckIcon className="size-4" />
            Gerenciar conta
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 p-2" onClick={() => void handleSignOut()}>
          <LogOutIcon className="size-4" />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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
                    <span className="flex-1 group-data-[collapsible=icon]:hidden">
                      {item.label}
                    </span>
                    {item.live ? (
                      <span
                        className="flex items-center group-data-[collapsible=icon]:hidden"
                        aria-label="ao vivo"
                        title="ao vivo"
                      >
                        <span className="size-1.5 rounded-full bg-green shadow-[0_0_6px_var(--green)]" />
                      </span>
                    ) : null}
                  </SidebarMenuButton>
                  {item.badge ? (
                    <SidebarMenuBadge className="rounded-full bg-brand-accent/12 text-[11px] font-semibold text-brand-accent">
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
        <div className="mb-3 rounded-lg border border-border bg-surface p-3 group-data-[collapsible=icon]:hidden">
          <div className="mb-[9px] flex items-center justify-between">
            <span className="flex items-center gap-[7px] text-[12.5px] font-semibold text-text-2">
              <Sparkles className="size-[15px] text-brand-accent" />
              Vanda IA
            </span>
            <span className="text-[12px] font-semibold text-text-4">62%</span>
          </div>
          <div className="h-[5px] overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-primary" style={{ width: "62%" }} />
          </div>
        </div>

        <div className="border-t border-border px-1.5 pt-3 group-data-[collapsible=icon]:border-t-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:pt-0">
          <AccountMenu />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
