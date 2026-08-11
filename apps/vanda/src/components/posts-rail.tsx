import { useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "convex-helpers/react/cache";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  PanelRightClose,
} from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Calendar } from "@vanda-studio/ui/components/calendar";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@vanda-studio/ui/components/sidebar";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useActiveAccount } from "./active-account";
import { ProjectReview } from "./project-review";
import { useWorkRail } from "./work-rail";

/**
 * The global right rail — the posts surface of the workspace, present on
 * every conversation (Codex-style: left rail = threads, right rail = work).
 * Collapsed it is a slim icon strip; expanded it lists every post of the
 * active business with its lifecycle state, and drills into a detail view.
 * Same primitives as the left sidebar; content palette (bg-app) so it reads
 * as a work surface rather than navigation chrome.
 */

type RailStatus = "draft" | "ready" | "scheduled" | "publishing" | "published" | "failed";

const STATUS_META: Record<RailStatus, { label: string; tone: "neutral" | "suggestion" | "scheduled" | "creating" | "live" | "needs" }> = {
  draft: { label: "Rascunho", tone: "neutral" },
  ready: { label: "Pronto", tone: "suggestion" },
  scheduled: { label: "Agendado", tone: "scheduled" },
  publishing: { label: "Publicando", tone: "creating" },
  published: { label: "Publicado", tone: "live" },
  failed: { label: "Falhou", tone: "needs" },
};

const formatWhen = (timestamp: number): string =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);

/** Hosts the rail inside its own provider, driven by the WorkRail state. */
export function PostsRailHost() {
  const rail = useWorkRail();
  return (
    <SidebarProvider
      className="contents"
      open={rail.open}
      onOpenChange={rail.setOpen}
      defaultWidth={352}
      cookieName="posts_rail_state"
      keyboardShortcut="."
    >
      <PostsRail />
    </SidebarProvider>
  );
}

/** The floating opener shown while the rail is closed — the right-side twin
 * of `CollapsedSidebarControls`. Rendered inside the inset by the layout;
 * the gallery renders its opener inline in its own header instead. */
export function CollapsedRailControls() {
  const rail = useWorkRail();
  const gallery = useRouterState({
    select: (s) => s.location.pathname.startsWith("/galeria"),
  });
  if (rail.open || gallery) return null;
  return (
    <div className="absolute top-3 right-3 z-20 hidden items-center rounded-lg border border-border bg-surface/90 p-0.5 shadow-sm backdrop-blur-sm md:flex">
      <ActionTooltip label="Abrir posts" side="bottom">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Abrir posts"
          onClick={() => rail.setOpen(true)}
        >
          <CalendarDays />
        </Button>
      </ActionTooltip>
    </div>
  );
}

function PostsRail() {
  const { activeAccount } = useActiveAccount();
  const { toggleSidebar } = useSidebar();
  const rail = useWorkRail();

  return (
    <Sidebar
      side="right"
      collapsible="offcanvas"
      resizable
      resizeLabel="Redimensionar painel de posts"
      className="border-sidebar-border transition-[left,right] duration-200 ease-[var(--ease-out)]"
    >
      <SidebarHeader className="flex-row items-center gap-2 border-b border-sidebar-border px-3 py-2.5">
        {rail.view.kind !== "list" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Voltar para a lista"
            onClick={rail.openList}
          >
            <ArrowLeft />
          </Button>
        ) : null}
        <h2 className="min-w-0 flex-1 truncate text-body font-semibold">Posts</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Recolher posts"
          onClick={toggleSidebar}
        >
          <PanelRightClose />
        </Button>
      </SidebarHeader>
      <SidebarContent className="min-h-0">
        {activeAccount === undefined ? null : rail.view.kind === "project" ? (
          <ProjectReview
            projectId={rail.view.projectId}
            accountId={activeAccount.id}
            threadId={rail.view.kind === "project" ? rail.view.threadId : undefined}
            onClose={rail.openList}
          />
        ) : rail.view.kind === "post" ? (
          <PostDetail accountId={activeAccount.id} postId={rail.view.postId} />
        ) : (
          <PostList accountId={activeAccount.id} />
        )}
      </SidebarContent>
    </Sidebar>
  );
}

/** The day a post lives on in the calendar: its slot when scheduled, else creation. */
const dayOf = (post: { scheduledFor: number | null; createdAt: number }): Date => {
  const date = new Date(post.scheduledFor ?? post.createdAt);
  date.setHours(0, 0, 0, 0);
  return date;
};

function PostList({ accountId }: { accountId: Id<"accounts"> }) {
  const rail = useWorkRail();
  const posts = useQuery(api.posts.listForRail, { accountId });
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(undefined);

  const postDays = useMemo(
    () => [...new Set((posts ?? []).map((post) => dayOf(post).getTime()))].map((t) => new Date(t)),
    [posts],
  );
  const visible =
    selectedDay === undefined
      ? (posts ?? [])
      : (posts ?? []).filter((post) => dayOf(post).getTime() === selectedDay.getTime());

  if (posts === undefined) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Calendar
        mode="single"
        locale={ptBR}
        fullWidth
        selected={selectedDay}
        onSelect={setSelectedDay}
        modifiers={{ hasPosts: postDays }}
        modifiersClassNames={{
          hasPosts:
            "relative after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-brand-accent after:content-[''] data-[selected-single=true]:after:bg-primary-foreground",
        }}
        className="shrink-0"
      />
      {posts.length === 0 ? (
        <div className="border-t border-sidebar-border px-4 py-8 text-center">
          <CalendarDays className="mx-auto size-5 text-text-5" />
          <p className="mt-2 text-body-sm text-text-3">Nenhum post ainda</p>
          <p className="mt-1 text-[12px] leading-relaxed text-text-5">
            Peça na conversa: "posta essa foto pra mim" — o rascunho aparece aqui e nada é
            publicado sem a sua aprovação.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border p-2">
          {visible.length === 0 ? (
            <p className="px-2 py-6 text-center text-body-sm text-text-4">
              Nenhum post neste dia.
            </p>
          ) : null}
          <SidebarMenu>
            {visible.map((post) => {
          const meta = STATUS_META[post.status];
          return (
            <SidebarMenuItem key={post.postId}>
              <SidebarMenuButton
                size="lg"
                className="h-auto items-center gap-2.5 py-2"
                onClick={() =>
                  // Project-backed posts get the full review surface.
                  post.contentProjectId !== null
                    ? rail.openProject(post.contentProjectId)
                    : rail.openPost(post.postId)
                }
              >
                {post.thumbnailUrl !== null ? (
                  <img
                    src={post.thumbnailUrl}
                    alt=""
                    className="size-9 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="grid size-9 shrink-0 place-items-center rounded-md bg-sidebar-accent">
                    <CalendarDays className="size-4 text-text-5" />
                  </div>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm text-sidebar-foreground">
                    {post.caption.replaceAll("\n", " ") || "(sem legenda)"}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                    <span className="truncate text-[11px] text-text-5">
                      {post.scheduledFor !== null
                        ? formatWhen(post.scheduledFor)
                        : formatWhen(post.createdAt)}
                      {post.slideCount > 1 ? ` · ${post.slideCount} slides` : ""}
                    </span>
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
            })}
          </SidebarMenu>
        </div>
      )}
    </div>
  );
}

function PostDetail({
  accountId,
  postId,
}: {
  accountId: Id<"accounts">;
  postId: Id<"posts">;
}) {
  const post = useQuery(api.posts.detail, { accountId, postId });
  const [slide, setSlide] = useState(0);

  if (post === undefined) {
    return (
      <div className="space-y-3 p-3">
        <Skeleton className="aspect-[4/5] w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    );
  }
  if (post === null) {
    return <p className="p-4 text-body-sm text-text-3">Post não encontrado.</p>;
  }
  const meta = STATUS_META[post.status];
  const current = Math.min(slide, Math.max(0, post.imageUrls.length - 1));
  const url = post.imageUrls[current];

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
        <span className="text-[11px] text-text-5">
          {post.scheduledFor !== null ? formatWhen(post.scheduledFor) : formatWhen(post.createdAt)}
        </span>
      </div>

      {url !== undefined ? (
        <div className="relative overflow-hidden rounded-lg border border-border bg-inset">
          <img src={url} alt="" className="aspect-[4/5] w-full object-cover" />
          {post.imageUrls.length > 1 ? (
            <>
              <Button
                variant="soft"
                size="icon-sm"
                aria-label="Slide anterior"
                className="absolute top-1/2 left-1.5 -translate-y-1/2"
                disabled={current === 0}
                onClick={() => setSlide(current - 1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="soft"
                size="icon-sm"
                aria-label="Próximo slide"
                className="absolute top-1/2 right-1.5 -translate-y-1/2"
                disabled={current === post.imageUrls.length - 1}
                onClick={() => setSlide(current + 1)}
              >
                <ChevronRight />
              </Button>
              <span className="absolute right-1.5 bottom-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
                {current + 1}/{post.imageUrls.length}
              </span>
            </>
          ) : null}
        </div>
      ) : null}

      <section>
        <h3 className="section-label text-text-3">Legenda</h3>
        <div
          className={cn(
            "mt-1.5 rounded-lg border border-border bg-surface p-3 text-body-sm",
          )}
        >
          <Markdown variant="reading">{post.caption}</Markdown>
        </div>
      </section>

      {post.lastError !== null && post.status === "failed" ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
          {post.lastError}
        </p>
      ) : null}

      {post.permalink !== null ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          render={<a href={post.permalink} target="_blank" rel="noreferrer" />}
        >
          <ExternalLink />
          Ver no Instagram
        </Button>
      ) : null}
    </div>
  );
}
