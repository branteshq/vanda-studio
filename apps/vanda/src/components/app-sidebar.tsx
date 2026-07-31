import { useMemo, useState } from "react";
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import {
  Archive,
  BadgeCheckIcon,
  Images,
  LogOutIcon,
  MessageSquareText,
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
import { Input } from "@vanda-studio/ui/components/input";
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
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useActiveAccount } from "./active-account";
import { GalleryComposer } from "./gallery-composer";
import { useModeNav } from "./mode-nav";
import { VandaMark } from "./vanda-mark";

interface ThreadItem {
  threadId: string;
  title: string | null;
  createdAt: number;
  processing: boolean;
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
    <div className="flex h-14 items-center gap-1 border-t border-sidebar-border px-1 pt-1">
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
              <ActionTooltip key={account.id} label={account.name} side="top">
                <button
                  type="button"
                  aria-label={`Trocar para ${account.name}`}
                  aria-pressed={selected}
                  onClick={() => handleSelect(account)}
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-sidebar-foreground/70 transition-[background-color,color,box-shadow,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97]",
                    selected
                      ? "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-sidebar-border"
                      : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  {getInitials(account.name) || "?"}
                </button>
              </ActionTooltip>
            );
          })
        )}
      </div>

      <DropdownMenu>
        <ActionTooltip label="Selecionar negócio" side="top">
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Selecionar negócio"
                className="size-9 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <UsersRound />
          </DropdownMenuTrigger>
        </ActionTooltip>
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
            className="size-10 shrink-0 rounded-full p-0 hover:bg-sidebar-accent data-popup-open:bg-sidebar-accent"
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
  // Both mutate the visible list optimistically: the row updates/disappears the
  // frame the user confirms, and the server result reconciles afterwards.
  const renameThread = useMutation(api.chat.renameThread).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.chat.listThreads, { accountId: args.accountId });
    if (!current) return;
    store.setQuery(
      api.chat.listThreads,
      { accountId: args.accountId },
      current.map((thread) =>
        thread.threadId === args.threadId
          ? { ...thread, title: args.title.trim().slice(0, 80) }
          : thread,
      ),
    );
  });
  const archiveThread = useMutation(api.chat.archiveThread).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.chat.listThreads, { accountId: args.accountId });
    if (!current) return;
    store.setQuery(
      api.chat.listThreads,
      { accountId: args.accountId },
      current.filter((thread) => thread.threadId !== args.threadId),
    );
  });
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<ThreadItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

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
    setRenameTitle(thread.title ?? "");
    setRenaming(thread);
  };
  const saveRename = () => {
    const title = renameTitle.trim();
    setRenaming((thread) => {
      if (thread && title && title !== thread.title) {
        void renameThread({ accountId, threadId: thread.threadId, title });
      }
      return null;
    });
  };
  const archive = (thread: ThreadItem) => {
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
            className="h-11 justify-center gap-2.5 border border-sidebar-primary-soft-border bg-sidebar-primary-soft px-3 text-body font-semibold text-sidebar-foreground hover:bg-sidebar-primary-soft hover:brightness-110 active:bg-sidebar-primary-soft group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!"
          >
            <PencilLine className="size-4" />
            <span className="group-data-[collapsible=icon]:hidden">Nova conversa</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      <div className="relative mx-1 mt-2 group-data-[collapsible=icon]:hidden">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-sidebar-foreground/50" />
        <input
          id="conversation-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar conversas…"
          aria-label="Buscar conversas"
          className="h-9 w-full rounded-md border border-transparent bg-transparent pr-2 pl-8 text-[13px] text-sidebar-foreground outline-none transition-colors duration-150 ease-[var(--ease-out)] placeholder:text-sidebar-foreground/50 hover:bg-sidebar-accent focus:border-sidebar-ring focus:bg-sidebar-accent"
        />
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border px-1 pt-2 group-data-[collapsible=icon]:hidden">
        {threads === undefined ? (
          <div className="space-y-2 px-2 pt-2" aria-hidden>
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-4/5 rounded-md" />
          </div>
        ) : sections.length === 0 ? (
          <p className="px-2 py-4 text-xs text-sidebar-foreground/50">
            {query ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}
          </p>
        ) : (
          <div className="space-y-4 pb-4">
            {sections.map((section) => (
              <section key={section.label}>
                <h3 className="section-label px-2 py-1 text-sidebar-foreground/75">
                  {section.label}
                </h3>
                <div className="space-y-0.5">
                  {section.threads.map((thread) => {
                    const active = thread.threadId === activeThreadId;
                    const editing = thread.threadId === renaming?.threadId;
                    return (
                      <div
                        key={thread.threadId}
                        className={cn(
                          "group/thread flex h-9 min-w-0 items-center rounded-md border transition-colors duration-150 ease-[var(--ease-out)] focus-within:bg-sidebar-accent",
                          active
                            ? "border-sidebar-border bg-sidebar-accent"
                            : "border-transparent hover:bg-sidebar-accent",
                        )}
                      >
                        {editing ? (
                          <form
                            className="flex h-full min-w-0 flex-1"
                            onSubmit={(event) => {
                              event.preventDefault();
                              saveRename();
                            }}
                          >
                            <Input
                              aria-label="Nome da conversa"
                              value={renameTitle}
                              onChange={(event) => setRenameTitle(event.target.value)}
                              onFocus={(event) => event.currentTarget.select()}
                              onBlur={saveRename}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setRenaming(null);
                                }
                              }}
                              maxLength={80}
                              autoComplete="off"
                              autoFocus
                              style={{
                                fontSize: "var(--text-body)",
                                lineHeight: "var(--text-body--line-height)",
                              }}
                              className={cn(
                                "h-full rounded-md border-0 bg-transparent px-2.5 py-2 text-sidebar-accent-foreground focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent",
                                active && "font-medium",
                              )}
                            />
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => openThread(thread.threadId)}
                              className={cn(
                                "h-full min-w-0 flex-1 truncate px-2.5 py-2 text-left text-body outline-none transition-colors duration-150 ease-[var(--ease-out)] group-hover/thread:text-sidebar-accent-foreground focus-visible:text-sidebar-accent-foreground",
                                active
                                  ? "font-medium text-sidebar-accent-foreground"
                                  : "text-sidebar-foreground/70",
                              )}
                            >
                              {thread.title ?? "Nova conversa"}
                            </button>
                            <div className="pointer-events-none relative mr-1 w-[3.625rem] shrink-0 overflow-hidden group-hover/thread:pointer-events-auto group-focus-within/thread:pointer-events-auto">
                              {thread.processing ? (
                                <Spinner
                                  aria-label="Vanda está trabalhando nesta conversa"
                                  className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-brand-accent transition-opacity duration-100 group-hover/thread:opacity-0 group-focus-within/thread:opacity-0 motion-reduce:transition-none"
                                />
                              ) : null}
                              <div className="flex translate-x-full items-center gap-0.5 transition-transform duration-180 ease-[var(--ease-out)] group-hover/thread:translate-x-0 group-focus-within/thread:translate-x-0 motion-reduce:transition-none">
                                <ActionTooltip label="Renomear" side="bottom">
                                  <button
                                    type="button"
                                    aria-label="Renomear conversa"
                                    onClick={() => rename(thread)}
                                    className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/55 outline-none transition-[color,transform] duration-150 ease-[var(--ease-out)] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring active:scale-[0.94] motion-reduce:transform-none"
                                  >
                                    <Pencil className="size-3.5" />
                                  </button>
                                </ActionTooltip>
                                <ActionTooltip label="Arquivar" side="bottom">
                                  <button
                                    type="button"
                                    aria-label="Arquivar conversa"
                                    onClick={() => archive(thread)}
                                    className="flex size-7 items-center justify-center rounded-md text-sidebar-foreground/55 outline-none transition-[color,transform] duration-150 ease-[var(--ease-out)] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring active:scale-[0.94] motion-reduce:transform-none"
                                  >
                                    <Archive className="size-3.5" />
                                  </button>
                                </ActionTooltip>
                              </div>
                            </div>
                          </>
                        )}
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

/**
 * The floating rail shown when the sidebar is collapsed in chat mode. Gallery
 * mode has no floating rail — its grid header carries its own inline expand
 * button, so the controls never overlap the always-visible search field.
 */
export function CollapsedSidebarControls() {
  const { state, setOpen } = useSidebar();
  const navigate = useNavigate();
  const gallery = useRouterState({
    select: (s) => s.location.pathname.startsWith("/galeria"),
  });

  if (state !== "collapsed" || gallery) return null;

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
      <ActionTooltip label="Abrir barra lateral" side="bottom">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Abrir barra lateral"
          onClick={() => setOpen(true)}
        >
          <PanelLeftOpen />
        </Button>
      </ActionTooltip>
      <ActionTooltip label="Buscar conversas" side="bottom">
        <Button variant="ghost" size="icon-sm" aria-label="Buscar conversas" onClick={openSearch}>
          <Search />
        </Button>
      </ActionTooltip>
      <ActionTooltip label="Nova conversa" side="bottom">
        <Button variant="ghost" size="icon-sm" aria-label="Nova conversa" onClick={startThread}>
          <Plus />
        </Button>
      </ActionTooltip>
    </div>
  );
}

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const { activeAccount } = useActiveAccount();
  const { galleryActive, toChat, toGallery } = useModeNav();

  return (
    <Sidebar
      collapsible="offcanvas"
      resizable
      resizeLabel="Redimensionar barra lateral"
      className="border-sidebar-border transition-[left,right] duration-200 ease-[var(--ease-out)]"
    >
      <SidebarHeader className="gap-2 px-2 pt-2.5 pb-1.5">
        <div className="relative flex h-9 items-center justify-center overflow-hidden px-0.5">
          <span className="absolute inset-y-0 left-0 flex items-center">
            <ActionTooltip
              label={state === "collapsed" ? "Expandir barra lateral" : "Recolher barra lateral"}
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={
                  state === "collapsed" ? "Expandir barra lateral" : "Recolher barra lateral"
                }
                onClick={toggleSidebar}
                className="shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                {state === "collapsed" ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            </ActionTooltip>
          </span>
          <div className="flex items-center gap-1.5 group-data-[collapsible=icon]:hidden">
            <VandaMark size={18} />
            <span className="text-body font-semibold tracking-tight text-sidebar-foreground">
              Vanda Studio
            </span>
          </div>
          <span className="absolute inset-y-0 right-0 flex items-center group-data-[collapsible=icon]:hidden">
            <ActionTooltip label={galleryActive ? "Conversas" : "Galeria"} side="bottom">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={galleryActive ? toChat : toGallery}
                aria-label={galleryActive ? "Ir para conversas" : "Ir para a galeria"}
                className="shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                {galleryActive ? <MessageSquareText /> : <Images />}
              </Button>
            </ActionTooltip>
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className="min-h-0 px-2">
        {activeAccount ? (
          <div
            key={galleryActive ? "gallery" : "chat"}
            className="animate-mode-in flex min-h-0 flex-1 flex-col"
          >
            {galleryActive ? (
              <GalleryComposer accountId={activeAccount.id} />
            ) : (
              <ThreadHistory accountId={activeAccount.id} />
            )}
          </div>
        ) : null}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-2">
        <ProfileDock />
      </SidebarFooter>
    </Sidebar>
  );
}
