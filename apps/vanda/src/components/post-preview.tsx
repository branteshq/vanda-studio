import { useEffect, useState } from "react";
import { useQuery } from "convex-helpers/react/cache";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Send,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@vanda-studio/ui/components/avatar";
import { Button } from "@vanda-studio/ui/components/button";
import {
  Lightbox,
  LightboxContent,
  LightboxMedia,
  LightboxPanel,
} from "@vanda-studio/ui/components/lightbox";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useActiveAccount } from "./active-account";

/**
 * The post's expanded view: a faithful Instagram-style preview (header,
 * media, action row, caption) inside the same Lightbox shell the image
 * viewer uses, with the lifecycle details docked in the side panel.
 */

type RailStatus = "draft" | "ready" | "scheduled" | "publishing" | "published" | "failed";

const STATUS_META: Record<
  RailStatus,
  { label: string; tone: "neutral" | "suggestion" | "scheduled" | "creating" | "live" | "needs" }
> = {
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
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);

export function PostPreviewDialog({
  accountId,
  postId,
  onClose,
}: {
  accountId: Id<"accounts">;
  postId: Id<"posts"> | null;
  onClose: () => void;
}) {
  return (
    <Lightbox open={postId !== null} onOpenChange={(open) => !open && onClose()}>
      {postId !== null ? <PostPreviewContent accountId={accountId} postId={postId} /> : null}
    </Lightbox>
  );
}

function PostPreviewContent({
  accountId,
  postId,
}: {
  accountId: Id<"accounts">;
  postId: Id<"posts">;
}) {
  const { activeAccount } = useActiveAccount();
  const post = useQuery(api.posts.detail, { accountId, postId });
  const [slide, setSlide] = useState(0);
  useEffect(() => setSlide(0), [postId]);

  const handle = activeAccount?.handle ?? activeAccount?.name ?? "sua_marca";
  const meta = post ? STATUS_META[post.status] : null;
  const total = post?.imageUrls.length ?? 0;
  const current = Math.min(slide, Math.max(0, total - 1));

  return (
    <LightboxContent label="Prévia do post">
      <LightboxMedia>
        <div className="w-[min(24rem,90vw)] overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          {/* Header — exactly the Instagram anatomy */}
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs font-semibold">
                {handle.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-body-sm font-semibold text-text">{handle}</span>
            <MoreHorizontal className="ml-auto size-4 text-text-3" />
          </div>

          {/* Media */}
          <div className="relative aspect-[4/5] bg-inset">
            {post === undefined ? (
              <Skeleton className="absolute inset-0 rounded-none" />
            ) : post === null || total === 0 ? (
              <div className="absolute inset-0 grid place-items-center text-body-sm text-text-4">
                Sem mídia
              </div>
            ) : (
              <img
                src={post.imageUrls[current]}
                alt={`Slide ${current + 1}`}
                className="absolute inset-0 size-full object-cover"
              />
            )}
            {total > 1 ? (
              <>
                <Button
                  variant="soft"
                  size="icon-sm"
                  aria-label="Slide anterior"
                  className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full"
                  disabled={current === 0}
                  onClick={() => setSlide(current - 1)}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="soft"
                  size="icon-sm"
                  aria-label="Próximo slide"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full"
                  disabled={current === total - 1}
                  onClick={() => setSlide(current + 1)}
                >
                  <ChevronRight />
                </Button>
                <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white">
                  {current + 1}/{total}
                </span>
              </>
            ) : null}
          </div>

          {/* Action row + carousel dots */}
          <div className="relative flex items-center gap-3.5 px-3 pt-2.5 text-text">
            <Heart className="size-5.5" strokeWidth={1.8} />
            <MessageCircle className="size-5.5" strokeWidth={1.8} />
            <Send className="size-5.5" strokeWidth={1.8} />
            {total > 1 ? (
              <span className="absolute inset-x-0 flex justify-center gap-1">
                {Array.from({ length: total }, (_, index) => (
                  <span
                    key={`dot-${index}`}
                    className={
                      index === current
                        ? "size-1.5 rounded-full bg-brand-accent"
                        : "size-1.5 rounded-full bg-text-5/40"
                    }
                  />
                ))}
              </span>
            ) : null}
            <Bookmark className="ml-auto size-5.5" strokeWidth={1.8} />
          </div>

          {/* Caption */}
          <div className="max-h-36 overflow-y-auto px-3 pt-2 pb-3">
            {post === undefined ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <p className="text-body-sm leading-relaxed whitespace-pre-wrap text-text">
                <span className="font-semibold">{handle}</span> {post?.caption ?? ""}
              </p>
            )}
          </div>
        </div>
      </LightboxMedia>

      <LightboxPanel className="p-4">
        <h3 className="text-body font-semibold text-text">Post</h3>
        {post === undefined ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : post === null ? (
          <p className="mt-3 text-body-sm text-text-3">Post não encontrado.</p>
        ) : (
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <div className="flex items-center gap-2">
              {meta ? <StatusPill tone={meta.tone}>{meta.label}</StatusPill> : null}
              {post.imageUrls.length > 1 ? (
                <span className="text-note text-text-4">{post.imageUrls.length} slides</span>
              ) : null}
            </div>
            <dl className="space-y-1.5 text-body-sm">
              {post.scheduledFor !== null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-text-4">
                    {post.status === "published" ? "Publicado em" : "Agendado para"}
                  </dt>
                  <dd className="text-text-2">{formatWhen(post.scheduledFor)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3">
                <dt className="text-text-4">Criado em</dt>
                <dd className="text-text-2">{formatWhen(post.createdAt)}</dd>
              </div>
            </dl>
            {post.lastError !== null && post.status === "failed" ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
                {post.lastError}
              </p>
            ) : null}
            {post.permalink !== null ? (
              <Button
                variant="outline"
                size="sm"
                render={<a href={post.permalink} target="_blank" rel="noreferrer" />}
              >
                <ExternalLink />
                Ver no Instagram
              </Button>
            ) : null}
          </div>
        )}
      </LightboxPanel>
    </LightboxContent>
  );
}
