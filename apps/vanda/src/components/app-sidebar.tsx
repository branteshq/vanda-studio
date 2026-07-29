import { useMemo, useState } from "react";
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import {
  Archive,
  BadgeCheckIcon,
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
  UsersRound,
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

interface ThreadItem {
  threadId: string;
  title: string | null;
  createdAt: number;
}

interface ThreadSection {
  label: string;
  threads: ThreadItem[];
}

function ProfileDock() {
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = useNavigate();
  const { accounts, activeAccount: active, selectAccount } = useActiveAccount();
  const removeAccount = useMutation(api.accounts.remove);
  const [removing, setRemoving] = useState(false);
  const readyAccounts = accounts?.filter((account) => account.onboardedAt !== null) ?? [];
  const name = active?.name ?? "negócio atual";

  const handleSelect = (account: NonNullable<typeof accounts>[number]) => {
    if (account.id === active?.id) return;
    if (account.onboardedAt === null) {
      void navigate({ to: "/onboarding", search: { accountId: account.id } });
      return;
    }
    // Optimistic: the switcher highlights and the workspace swaps this frame.
    selectAccount(account.id);
    setOpenMobile(false);
    void navigate({ to: "/conversa", search: {} });
  };

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

  return (
    <div className="flex h-14 items-center gap-1 border-t border-border px-1 pt-1">
      <AccountMenu />

      <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
        {accounts === undefined ? (
          <>
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="size-8 rounded-lg" />
          </>
        ) : (
          readyAccounts.slice(0, 3).map((account) => {
            const selected = account.id === active?.id;
            return (
              <button
                key={account.id}
                type="button"
                title={account.name}
                aria-label={`Trocar para ${account.name}`}
                aria-pressed={selected}
                onClick={() => handleSelect(account)}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-text-3 transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97]",
                  selected
                    ? "bg-accent text-text ring-1 ring-border-strong"
                    : "hover:bg-accent hover:text-text",
                )}
              >
                {getInitials(account.name) || "?"}
              </button>
            );
          })
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Selecionar negócio"
              title="Selecionar negócio"
              className="size-9 shrink-0 text-text-3 data-popup-open:bg-accent data-popup-open:text-text"
            />
          }
        >
          <UsersRound />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="min-w-64 rounded-lg"
          align="end"
          side={isMobile ? "top" : "right"}
          sideOffset={6}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Negócios
            </DropdownMenuLabel>
            {accounts?.map((account) => (
              <DropdownMenuItem
                key={account.id}
                className="gap-2 p-2"
                onClick={() => handleSelect(account)}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-border-strong text-[10px] font-semibold text-text-2">
                  {getInitials(account.name) || "?"}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {account.name}
                  {account.handle ? (
                    <span className="block text-[10px] text-muted-foreground">
                      @{account.handle}
                    </span>
                  ) : account.onboardedAt === null ? (
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
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border">
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
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-destructive/30">
                <Trash2 className="size-4" />
              </span>
              <span className="font-medium">
                {removing ? "Removendo..." : "Remover negócio atual"}
              </span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
  const initials = getInitials(name) || "MC";
  const handleSignOut = async () => {
    await clerk.signOut();
    await navigate({ to: "/login" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={name}
            title={name}
            className="size-10 shrink-0 rounded-full p-0 data-popup-open:bg-accent"
          />
        }
      >
        <Avatar className="size-8">
          <AvatarImage src={user?.imageUrl} alt={name} />
          <AvatarFallback className="text-[11px] font-semibold">{initials}</AvatarFallback>
        </Avatar>
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
  const renameThread = useMutation(api.chat.renameThread);
  const archiveThread = useMutation(api.chat.archiveThread);
  const [query, setQuery] = useState("");

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

  const openThread = (threadId: string) => {
    setOpenMobile(false);
    void navigate({ to: "/conversa", search: { t: threadId } });
  };
  // Pure navigation — no thread exists until the first message is sent.
  const startThread = () => {
    setOpenMobile(false);
    void navigate({ to: "/conversa", search: {} });
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
            onClick={startThread}
            className="h-11 gap-2.5 border border-brand-accent/35 bg-brand-accent/10 px-3 text-[13px] font-semibold text-text transition-colors duration-150 hover:bg-brand-accent/15 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-border group-data-[collapsible=icon]:bg-surface group-data-[collapsible=icon]:px-0!"
          >
            <PencilLine className="size-4" />
            <span className="group-data-[collapsible=icon]:hidden">Nova conversa</span>
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
                          onClick={() => openThread(thread.threadId)}
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
  const navigate = useNavigate();

  if (state !== "collapsed") return null;

  const openSearch = () => {
    setOpen(true);
    requestAnimationFrame(() => document.getElementById("conversation-search")?.focus());
  };
  // Pure navigation — the thread is created on first send.
  const startThread = () => {
    void navigate({ to: "/conversa", search: {} });
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
        onClick={startThread}
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
      </SidebarHeader>

      <SidebarContent className="min-h-0 px-2">
        {activeAccount ? <ThreadHistory accountId={activeAccount.id} /> : null}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-2">
        <ProfileDock />
      </SidebarFooter>
    </Sidebar>
  );
}
