import { useMemo, useState } from "react";
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  Archive,
  BadgeCheckIcon,
  ChevronsUpDown,
  GalleryHorizontalEnd,
  LogOutIcon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  PencilLine,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@vanda-studio/ui/components/avatar";
import { Button } from "@vanda-studio/ui/components/button";
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@vanda-studio/ui/components/sidebar";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useActiveAccount } from "./active-account";
import { VandaMark } from "./vanda-mark";

const MODE_LABEL: Record<string, string> = {
  auto: "Automático",
  needs_approval: "Aprovação",
  manual: "Manual",
};

interface ThreadItem {
  threadId: string;
  title: string | null;
  createdAt: number;
}

interface ThreadSection {
  label: string;
  threads: ThreadItem[];
}

function WorkspaceSwitcher() {
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const { accounts, activeAccount: active, selectAccount } = useActiveAccount();
  const removeAccount = useMutation(api.accounts.remove);
  const [removing, setRemoving] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  if (accounts !== undefined && accounts.length === 0) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            render={<Link to="/perfil" />}
            tooltip="Configurar negócio"
            className="gap-[9px] border border-border-strong bg-inset px-2 transition-colors duration-150 hover:bg-accent"
          >
            <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md border border-border-strong">
              <Plus className="size-4 text-text-4" />
            </span>
            <span className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-[13px] font-semibold">Configurar negócio</span>
              <span className="truncate text-[11px] text-text-4">Conecte seu Instagram</span>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const name = active?.name ?? "Vanda Studio";
  const initials = getInitials(name) || "VS";
  const subtitle = active
    ? active.handle
      ? `@${active.handle}`
      : (MODE_LABEL[active.mode] ?? active.mode)
    : "Carregando...";

  const handleRemoveCurrent = async () => {
    if (!active || removing) return;
    const confirmed = window.confirm(
      `Remover ${name}? A Vanda vai apagar os dados desse negócio neste app e desconectar o Instagram salvo.`,
    );
    if (!confirmed) return;

    setRemoving(true);
    try {
      await removeAccount({ accountId: active.id });
      const hasRemainingBusiness = accounts?.some(
        (account) => account.id !== active.id && account.onboardedAt !== null,
      );
      if (!hasRemainingBusiness) await navigate({ to: "/onboarding" });
    } finally {
      setRemoving(false);
    }
  };

  const handleSelect = async (account: NonNullable<typeof accounts>[number]) => {
    if (account.id === active?.id || switching !== null) return;
    if (account.onboardedAt === null) {
      await navigate({ to: "/onboarding", search: { accountId: account.id } });
      return;
    }
    setSwitching(account.id);
    try {
      await selectAccount(account.id);
      setOpenMobile(false);
      await navigate({ to: "/conversa", search: {} });
    } finally {
      setSwitching(null);
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={name}
                className="gap-[9px] border border-border bg-inset/70 px-2 transition-colors duration-150 hover:bg-accent data-popup-open:bg-accent group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent"
              />
            }
          >
            <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-border-strong text-[11px] font-semibold text-text-2">
              {initials}
            </span>
            <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-[13px] font-semibold">{name}</span>
              <span className="truncate text-[11px] text-text-4">{subtitle}</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4 text-text-4 group-data-[collapsible=icon]:hidden" />
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
              {accounts?.map((account) => (
                <DropdownMenuItem
                  key={account.id}
                  className="gap-2 p-2"
                  disabled={switching !== null}
                  onClick={() => void handleSelect(account)}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-border-strong text-[10px] font-semibold text-text-2">
                    {getInitials(account.name) || "?"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {account.name}
                    {account.onboardedAt === null ? (
                      <span className="block text-[10px] text-muted-foreground">
                        Configuração pendente
                      </span>
                    ) : null}
                  </span>
                  {account.id === active?.id ? <BadgeCheckIcon className="size-4" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="gap-2 p-2"
                onClick={() => void navigate({ to: "/onboarding", search: { flow: "add" } })}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md border">
                  <Plus className="size-4" />
                </span>
                <span className="font-medium text-muted-foreground">Adicionar negócio</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                className="gap-2 p-2"
                disabled={!active || removing}
                onClick={() => void handleRemoveCurrent()}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-destructive/30">
                  <Trash2 className="size-4" />
                </span>
                <span className="font-medium">
                  {removing ? "Removendo..." : "Remover negócio atual"}
                </span>
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
            tooltip={name}
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

function sectionThreads(threads: ThreadItem[]): ThreadSection[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayAt = today.getTime();
  const yesterdayAt = todayAt - 86_400_000;
  const weekAt = todayAt - 7 * 86_400_000;
  const groups: ThreadSection[] = [
    { label: "Hoje", threads: [] },
    { label: "Ontem", threads: [] },
    { label: "7 dias", threads: [] },
    { label: "Anteriores", threads: [] },
  ];
  for (const thread of threads) {
    if (thread.createdAt >= todayAt) groups[0]!.threads.push(thread);
    else if (thread.createdAt >= yesterdayAt) groups[1]!.threads.push(thread);
    else if (thread.createdAt >= weekAt) groups[2]!.threads.push(thread);
    else groups[3]!.threads.push(thread);
  }
  return groups.filter((group) => group.threads.length > 0);
}

function ThreadHistory({ accountId }: { accountId: Id<"accounts"> }) {
  const { setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const threads = useQuery(api.chat.listThreads, { accountId });
  const createNewThread = useMutation(api.chat.createNewThread);
  const renameThread = useMutation(api.chat.renameThread);
  const archiveThread = useMutation(api.chat.archiveThread);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const activeThreadId =
    location.pathname.startsWith("/conversa") &&
    typeof (location.search as Record<string, unknown>).t === "string"
      ? ((location.search as Record<string, unknown>).t as string)
      : null;

  const filtered = useMemo(() => {
    if (!threads) return [];
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return threads;
    return threads.filter((thread) =>
      (thread.title ?? "Nova conversa").toLocaleLowerCase("pt-BR").includes(normalized),
    );
  }, [threads, query]);
  const sections = sectionThreads(filtered);

  const openThread = async (threadId: string) => {
    setOpenMobile(false);
    await navigate({ to: "/conversa", search: { t: threadId } });
  };
  const startThread = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const threadId = await createNewThread({ accountId });
      await openThread(threadId);
    } finally {
      setCreating(false);
    }
  };
  const rename = (thread: ThreadItem) => {
    const title = window.prompt("Renomear conversa", thread.title ?? "");
    if (title?.trim()) void renameThread({ accountId, threadId: thread.threadId, title });
  };
  const archive = (thread: ThreadItem) => {
    if (!window.confirm("Arquivar esta conversa?")) return;
    void archiveThread({ accountId, threadId: thread.threadId });
  };

  return (
    <>
      <SidebarMenu className="px-1 pt-1">
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            tooltip="Nova conversa"
            onClick={() => void startThread()}
            disabled={creating}
            className="h-11 gap-2.5 border border-brand-accent/35 bg-brand-accent/10 px-3 text-[13px] font-semibold text-text transition-colors duration-150 hover:bg-brand-accent/15 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-border group-data-[collapsible=icon]:bg-surface group-data-[collapsible=icon]:px-0!"
          >
            <PencilLine className="size-4" />
            <span className="group-data-[collapsible=icon]:hidden">
              {creating ? "Criando…" : "Nova conversa"}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      <div className="relative mx-1 mt-2 group-data-[collapsible=icon]:hidden">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-5" />
        <input
          id="conversation-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar conversas…"
          aria-label="Buscar conversas"
          className="h-9 w-full rounded-md border border-transparent bg-transparent pr-2 pl-8 text-[13px] text-text outline-none placeholder:text-text-5 hover:bg-surface/60 focus:border-border focus:bg-surface"
        />
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-t border-border px-1 pt-2 group-data-[collapsible=icon]:hidden">
        {threads === undefined ? (
          <div className="space-y-2 px-2 pt-2" aria-hidden>
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-4/5 rounded-md" />
          </div>
        ) : sections.length === 0 ? (
          <p className="px-2 py-4 text-xs text-text-5">
            {query ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}
          </p>
        ) : (
          <div className="space-y-4 pb-4">
            {sections.map((section) => (
              <section key={section.label}>
                <h3 className="px-2 py-1 font-mono text-[10px] tracking-[0.18em] text-text-5 uppercase">
                  {section.label}
                </h3>
                <div className="space-y-0.5">
                  {section.threads.map((thread) => {
                    const active = thread.threadId === activeThreadId;
                    return (
                      <div
                        key={thread.threadId}
                        className={cn(
                          "group/thread flex min-w-0 items-center rounded-md border transition-colors duration-150",
                          active
                            ? "border-brand-accent/25 bg-brand-accent/8"
                            : "border-transparent hover:bg-surface/70",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => void openThread(thread.threadId)}
                          className={cn(
                            "min-w-0 flex-1 truncate px-2.5 py-2 text-left text-[13px]",
                            active ? "font-medium text-text" : "text-text-3",
                          )}
                        >
                          {thread.title ?? "Nova conversa"}
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                type="button"
                                aria-label="Opções da conversa"
                                className={cn(
                                  "mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-text-5 opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-accent hover:text-text group-hover/thread:opacity-100 data-popup-open:opacity-100",
                                  active && "opacity-100",
                                )}
                              />
                            }
                          >
                            <MoreHorizontal className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="right" sideOffset={4}>
                            <DropdownMenuItem onClick={() => rename(thread)}>
                              <Pencil className="size-4" />
                              Renomear
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => archive(thread)}>
                              <Archive className="size-4" />
                              Arquivar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function CollapsedSidebarControls() {
  const { state, setOpen } = useSidebar();
  const { activeAccount } = useActiveAccount();
  const createNewThread = useMutation(api.chat.createNewThread);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  if (state !== "collapsed") return null;

  const openSearch = () => {
    setOpen(true);
    requestAnimationFrame(() => document.getElementById("conversation-search")?.focus());
  };
  const startThread = async () => {
    if (!activeAccount || creating) return;
    setCreating(true);
    try {
      const threadId = await createNewThread({ accountId: activeAccount.id });
      await navigate({ to: "/conversa", search: { t: threadId } });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="absolute top-3 left-3 z-20 hidden items-center rounded-lg border border-border bg-surface/90 p-0.5 shadow-sm backdrop-blur-sm md:flex">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Abrir barra lateral"
        title="Abrir barra lateral"
        onClick={() => setOpen(true)}
      >
        <PanelLeftOpen />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Buscar conversas"
        title="Buscar conversas"
        onClick={openSearch}
      >
        <Search />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Nova conversa"
        title="Nova conversa"
        disabled={!activeAccount || creating}
        onClick={() => void startThread()}
      >
        <Plus />
      </Button>
    </div>
  );
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { state, toggleSidebar } = useSidebar();
  const { activeAccount } = useActiveAccount();
  const galleryActive = pathname.startsWith("/galeria");

  return (
    <Sidebar
      collapsible="offcanvas"
      className="border-sidebar-border transition-[left,right] duration-200 ease-[var(--ease-out)]"
    >
      <SidebarHeader className="gap-2 px-2 pt-2.5 pb-1.5">
        <div className="flex h-9 items-center gap-1 overflow-hidden px-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={state === "collapsed" ? "Expandir barra lateral" : "Recolher barra lateral"}
            title={state === "collapsed" ? "Expandir" : "Recolher"}
            onClick={toggleSidebar}
            className="shrink-0 text-text-4 hover:text-text"
          >
            {state === "collapsed" ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
          <span className="flex size-7 shrink-0 items-center justify-center text-brand-accent">
            <VandaMark size={17} />
          </span>
          <span className="min-w-0 flex-1 truncate pl-1 text-[14px] font-semibold text-text group-data-[collapsible=icon]:hidden">
            Vanda Studio
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link to="/galeria" />}
            aria-label="Abrir galeria"
            title="Galeria"
            className={cn(
              "shrink-0 text-text-4 hover:text-text group-data-[collapsible=icon]:hidden",
              galleryActive && "bg-accent text-text",
            )}
          >
            <GalleryHorizontalEnd />
          </Button>
        </div>
        <WorkspaceSwitcher />
      </SidebarHeader>

      <SidebarContent className="min-h-0 px-2">
        {activeAccount ? <ThreadHistory accountId={activeAccount.id} /> : null}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-2.5">
        <div className="border-t border-border px-1 pt-2 group-data-[collapsible=icon]:border-t-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:pt-0">
          <AccountMenu />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
