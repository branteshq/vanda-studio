import { useState } from "react";
import { useQuery } from "convex-helpers/react/cache";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  PanelRightClose,
} from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@vanda-studio/ui/components/sidebar";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useActiveAccount } from "./active-account";

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

export function PostsRail() {
  const { activeAccount } = useActiveAccount();
  const { state, toggleSidebar } = useSidebar();
  const [selectedId, setSelectedId] = useState<Id<"posts"> | null>(null);

  return (
    <Sidebar
      side="right"
      collapsible="icon"
      className="border-sidebar-border"
    >
      {state === "collapsed" ? (
        <SidebarContent className="items-center pt-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Posts"
                onClick={toggleSidebar}
                aria-label="Abrir posts"
              >
                <CalendarDays />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      ) : (
        <>
          <SidebarHeader className="flex-row items-center gap-2 border-b border-sidebar-border px-3 py-2.5">
            {selectedId !== null ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Voltar para a lista"
                onClick={() => setSelectedId(null)}
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
            {activeAccount === undefined ? null : selectedId !== null ? (
              <PostDetail
                accountId={activeAccount.id}
                postId={selectedId}
              />
            ) : (
              <PostList accountId={activeAccount.id} onOpen={setSelectedId} />
            )}
          </SidebarContent>
        </>
      )}
    </Sidebar>
  );
}

function PostList({
  accountId,
  onOpen,
}: {
  accountId: Id<"accounts">;
  onOpen: (postId: Id<"posts">) => void;
}) {
  const posts = useQuery(api.posts.listForRail, { accountId });

  if (posts === undefined) {
    return (
      <div className="space-y-2 p-3">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    );
  }
  if (posts.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <CalendarDays className="mx-auto size-5 text-text-5" />
        <p className="mt-2 text-body-sm text-text-3">Nenhum post ainda</p>
        <p className="mt-1 text-[12px] leading-relaxed text-text-5">
          Peça na conversa: "posta essa foto pra mim" — o rascunho aparece aqui e nada é
          publicado sem a sua aprovação.
        </p>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <SidebarMenu>
        {posts.map((post) => {
          const meta = STATUS_META[post.status];
          return (
            <SidebarMenuItem key={post.postId}>
              <SidebarMenuButton
                size="lg"
                className="h-auto items-center gap-2.5 py-2"
                onClick={() => onOpen(post.postId)}
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
