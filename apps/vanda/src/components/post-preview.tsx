import { useEffect, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Frame,
  Heart,
  Images,
  MessageCircle,
  MoreHorizontal,
  Send,
  Trash2,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@vanda-studio/ui/components/avatar";
import {
  Lightbox,
  LightboxContent,
  LightboxMedia,
  LightboxPanel,
} from "@vanda-studio/ui/components/lightbox";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useActiveAccount } from "./active-account";

/**
 * PostPreview — the expanded view of a post, on the exact same Lightbox
 * anatomy as the image viewer (media left, docked panel right, edge arrows
 * navigate the collection). The creative bit is the media itself: a faithful
 * Instagram-style rendering of the post. The panel is the working surface —
 * the caption is edited here, saved on blur, NameInput-style.
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
  postIds,
  postId,
  onSelect,
  onClose,
}: {
  accountId: Id<"accounts">;
  /** The posts in display order — powers ←/→ navigation, image-viewer style. */
  postIds: ReadonlyArray<Id<"posts">>;
  postId: Id<"posts"> | null;
  onSelect: (postId: Id<"posts">) => void;
  onClose: () => void;
}) {
  const index = postId === null ? -1 : postIds.indexOf(postId);
  const prev = index > 0 ? postIds[index - 1] : undefined;
  const next = index >= 0 && index < postIds.length - 1 ? postIds[index + 1] : undefined;

  return (
    <Lightbox open={postId !== null} onOpenChange={(open) => !open && onClose()}>
      {postId !== null ? (
        <LightboxContent
          label="Prévia do post"
          onPrev={prev !== undefined ? () => onSelect(prev) : undefined}
          onNext={next !== undefined ? () => onSelect(next) : undefined}
        >
          <PostPreviewBody accountId={accountId} postId={postId} onClose={onClose} />
        </LightboxContent>
      ) : null}
    </Lightbox>
  );
}

function PostPreviewBody({
  accountId,
  postId,
  onClose,
}: {
  accountId: Id<"accounts">;
  postId: Id<"posts">;
  onClose: () => void;
}) {
  const { activeAccount } = useActiveAccount();
  const post = useQuery(api.posts.detail, { accountId, postId });
  const removePost = useMutation(api.posts.removePost);
  const [slide, setSlide] = useState(0);
  useEffect(() => setSlide(0), [postId]);

  const handle = activeAccount?.handle ?? activeAccount?.name ?? "sua_marca";
  const total = post?.imageUrls.length ?? 0;
  const current = Math.min(slide, Math.max(0, total - 1));
  const editable =
    post != null && post.status !== "published" && post.status !== "publishing";

  return (
    <LightboxMedia>
      {/* The media: an Instagram-faithful card instead of a bare image. */}
      <div className="w-[min(24rem,90vw)] overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs font-semibold">
              {handle.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-body-sm font-semibold text-text">{handle}</span>
          <MoreHorizontal className="ml-auto size-4 text-text-3" />
        </div>

        <div className="relative aspect-[4/5] bg-inset">
          {post === undefined ? (
            <div className="absolute inset-0 grid place-items-center">
              <Spinner className="size-5 text-text-4" />
            </div>
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
              <ActionTooltip label="Slide anterior" side="right">
                <button
                  type="button"
                  aria-label="Slide anterior"
                  disabled={current === 0}
                  onClick={() => setSlide(current - 1)}
                  className="absolute top-1/2 left-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-text shadow-sm backdrop-blur-sm disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" />
                </button>
              </ActionTooltip>
              <ActionTooltip label="Próximo slide" side="left">
                <button
                  type="button"
                  aria-label="Próximo slide"
                  disabled={current === total - 1}
                  onClick={() => setSlide(current + 1)}
                  className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 text-text shadow-sm backdrop-blur-sm disabled:opacity-40"
                >
                  <ChevronRight className="size-4" />
                </button>
              </ActionTooltip>
              <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white">
                {current + 1}/{total}
              </span>
            </>
          ) : null}
        </div>

        <div className="relative flex items-center gap-3.5 px-3 pt-2.5 text-text">
          <Heart className="size-5.5" strokeWidth={1.8} />
          <MessageCircle className="size-5.5" strokeWidth={1.8} />
          <Send className="size-5.5" strokeWidth={1.8} />
          {total > 1 ? (
            <span className="pointer-events-none absolute inset-x-0 flex justify-center gap-1">
              {Array.from({ length: total }, (_, index) => (
                <span
                  key={`dot-${index}`}
                  className={cn(
                    "size-1.5 rounded-full",
                    index === current ? "bg-brand-accent" : "bg-text-5/40",
                  )}
                />
              ))}
            </span>
          ) : null}
          <Bookmark className="ml-auto size-5.5" strokeWidth={1.8} />
        </div>

        <div className="max-h-32 overflow-y-auto px-3 pt-2 pb-3">
          {post === undefined ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <p className="text-body-sm leading-relaxed whitespace-pre-wrap text-text">
              <span className="font-semibold">{handle}</span> {post?.caption ?? ""}
            </p>
          )}
        </div>
      </div>

      <LightboxPanel>
        {post === undefined ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <Spinner className="size-5 text-text-4" />
          </div>
        ) : post === null ? (
          <p className="p-4 text-body-sm text-text-3">Post não encontrado.</p>
        ) : (
          <>
            <div className="flex items-start gap-2 p-4 pb-0">
              <h2 className="min-w-0 flex-1 truncate px-1 py-0.5 text-card-title font-semibold text-text">
                Post
              </h2>
              <div className="flex shrink-0 items-center gap-0.5">
                <CopyCaptionAction caption={post.caption} />
                {editable ? (
                  <PanelAction
                    label="Excluir post"
                    onClick={() => {
                      if (window.confirm("Apagar este post? As imagens continuam na galeria.")) {
                        void removePost({ accountId, postId }).then(onClose);
                      }
                    }}
                    className="hover:text-destructive"
                  >
                    <Trash2 />
                  </PanelAction>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusPill tone={STATUS_META[post.status].tone}>
                  {STATUS_META[post.status].label}
                </StatusPill>
                {total > 0 && (
                  <MetaChip icon={<Images />}>
                    {total === 1 ? "1 imagem" : `${total} slides`}
                  </MetaChip>
                )}
                <MetaChip icon={<Frame />}>4:5</MetaChip>
              </div>

              <div>
                <p className="section-label mb-1 text-text-2">Legenda</p>
                {editable ? (
                  <CaptionEditor
                    key={post.postId}
                    accountId={accountId}
                    postId={post.postId}
                    caption={post.caption}
                  />
                ) : (
                  <p className="rounded-lg bg-muted p-2.5 text-body-sm whitespace-pre-wrap text-text-2">
                    {post.caption || "Sem legenda."}
                  </p>
                )}
              </div>

              {post.lastError !== null && post.status === "failed" ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
                  {post.lastError}
                </p>
              ) : null}

              {post.permalink !== null ? (
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-body-sm text-brand-accent underline-offset-4 hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  Ver no Instagram
                </a>
              ) : null}

              <p className="text-note text-text-4">
                {post.scheduledFor !== null
                  ? `${post.status === "published" ? "Publicado em" : "Agendado para"} ${formatWhen(post.scheduledFor)} · `
                  : ""}
                Criado em {formatWhen(post.createdAt)}
              </p>
            </div>
          </>
        )}
      </LightboxPanel>
    </LightboxMedia>
  );
}

/** NameInput's sibling: a caption textarea, seeded per post, saved on blur. */
function CaptionEditor({
  accountId,
  postId,
  caption,
}: {
  accountId: Id<"accounts">;
  postId: Id<"posts">;
  caption: string;
}) {
  const updateCaption = useMutation(api.posts.updateCaption);
  const [draft, setDraft] = useState(caption);
  return (
    <textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== caption) void updateCaption({ accountId, postId, caption: draft });
      }}
      placeholder="Escreva a legenda…"
      aria-label="Legenda do post"
      maxLength={2200}
      rows={6}
      className="w-full resize-y rounded-lg border border-transparent bg-muted p-2.5 text-body-sm leading-relaxed text-text-2 outline-none transition-colors duration-150 ease-[var(--ease-out)] hover:border-border focus-visible:border-border"
    />
  );
}

function CopyCaptionAction({ caption }: { caption: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <PanelAction
      label="Copiar legenda"
      onClick={() => {
        void navigator.clipboard.writeText(caption).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={copied ? "text-green" : undefined}
    >
      <Copy />
    </PanelAction>
  );
}

function PanelAction({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <ActionTooltip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          "flex size-8 items-center justify-center rounded-lg text-text-4 outline-none transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] hover:bg-muted hover:text-text focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:transform-none [&_svg]:size-4",
          className,
        )}
      >
        {children}
      </button>
    </ActionTooltip>
  );
}

function MetaChip({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-note text-text-3 [&_svg]:size-3 [&_svg]:text-text-4">
      {icon}
      {children}
    </span>
  );
}
