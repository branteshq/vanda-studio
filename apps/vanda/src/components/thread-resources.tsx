import type { UIMessage } from "@convex-dev/agent/react";
import { useQuery } from "convex-helpers/react/cache";
import { Check, Clock3, ExternalLink, FileText, ImageOff, LoaderCircle, X } from "lucide-react";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import { dedupeResources, resourceKey, type ThreadResource } from "../convex/resourceRefs";

export interface PresentedResourceManifest {
  readonly anchorMessageId: string;
  readonly presented: readonly ThreadResource[];
}

/** Resolve tool resources against their prompt, or against a standalone follow-up message. */
export const resourcesForMessage = (
  messages: readonly UIMessage[],
  index: number,
  manifests: readonly PresentedResourceManifest[],
): ThreadResource[] => {
  const message = messages[index];
  if (!message) return [];
  const anchors = new Set([message.id]);
  if (message.role === "assistant") {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = messages[cursor];
      if (previous?.role === "user") {
        anchors.add(previous.id);
        break;
      }
    }
  }
  return dedupeResources(
    manifests
      .filter((manifest) => anchors.has(manifest.anchorMessageId))
      .flatMap((manifest) => manifest.presented),
  );
};

export function ThreadResourceList({ resources }: { resources: readonly ThreadResource[] }) {
  const unique = dedupeResources(resources);
  if (unique.length === 0) return null;
  return (
    <div className="grid w-full gap-2.5">
      {unique.map((resource) => (
        <ThreadResourceView key={resourceKey(resource)} resource={resource} />
      ))}
    </div>
  );
}

function ThreadResourceView({ resource }: { resource: ThreadResource }) {
  switch (resource.kind) {
    case "image":
      return <ImageResource resource={resource} />;
    case "post":
      return <PostResource resource={resource} />;
    case "document":
      return <DocumentResource resource={resource} />;
    case "link":
      return <LinkResource resource={resource} />;
    case "operation":
      return <OperationResource resource={resource} />;
  }
}

function ImageResource({ resource }: { resource: Extract<ThreadResource, { kind: "image" }> }) {
  const image = useQuery(api.gallery.get, {
    accountId: resource.accountId,
    imageId: resource.imageId,
  });
  if (image === undefined) return <Skeleton className="aspect-[4/5] w-full max-w-sm rounded-xl" />;
  if (image === null || !image.url) {
    return (
      <ResourceNotice icon={<ImageOff />} title="Imagem indisponível">
        Ela pode ter sido removida da galeria.
      </ResourceNotice>
    );
  }
  const ratio = image.width && image.height ? image.width / image.height : 4 / 5;
  return (
    <a
      href={image.url}
      target="_blank"
      rel="noreferrer"
      className="group relative block w-full max-w-sm overflow-hidden rounded-xl border border-border bg-inset"
    >
      <div style={{ aspectRatio: ratio }}>
        <img
          src={image.url}
          alt={image.name ?? "Imagem criada pela Vanda"}
          loading="lazy"
          className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.015]"
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pt-8 pb-2.5 text-white">
        <p className="truncate text-sm font-medium">{image.name ?? "Imagem"}</p>
      </div>
    </a>
  );
}

const POST_STATUS: Record<string, string> = {
  draft: "Rascunho",
  ready: "Pronto",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
};

function PostResource({ resource }: { resource: Extract<ThreadResource, { kind: "post" }> }) {
  const post = useQuery(api.posts.detail, {
    accountId: resource.accountId,
    postId: resource.postId,
  });
  if (post === undefined) return <Skeleton className="h-64 w-full max-w-lg rounded-xl" />;
  if (post === null) {
    return (
      <ResourceNotice icon={<X />} title="Post indisponível">
        O post foi removido.
      </ResourceNotice>
    );
  }
  return (
    <article className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface">
      {post.imageUrls.length > 0 ? (
        <div className="flex snap-x gap-1 overflow-x-auto bg-inset p-1">
          {post.imageUrls.map((url, index) => (
            <img
              key={url}
              src={url}
              alt={`Slide ${index + 1}`}
              loading="lazy"
              className="aspect-[4/5] w-[72%] shrink-0 snap-center rounded-lg object-cover first:w-full"
            />
          ))}
        </div>
      ) : null}
      <div className="space-y-2.5 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-text-3">
            {POST_STATUS[post.status] ?? post.status}
          </span>
          {post.scheduledFor ? (
            <span className="text-[11px] text-text-4">
              {new Intl.DateTimeFormat("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              }).format(post.scheduledFor)}
            </span>
          ) : null}
        </div>
        <div className="line-clamp-6 text-sm leading-5 text-text-2">
          <Markdown>{post.caption}</Markdown>
        </div>
        {post.lastError ? <p className="text-xs text-destructive">{post.lastError}</p> : null}
        {post.permalink ? (
          <a
            href={post.permalink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-accent hover:underline"
          >
            Ver no Instagram <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
    </article>
  );
}

function DocumentResource({
  resource,
}: {
  resource: Extract<ThreadResource, { kind: "document" }>;
}) {
  const document = useQuery(api.threadResources.readDocument, {
    accountId: resource.accountId,
    path: resource.path,
  });
  const title = resource.title ?? resource.path.split("/").at(-1) ?? resource.path;
  if (document === undefined) return <Skeleton className="h-24 w-full max-w-lg rounded-xl" />;
  if (document === null) {
    return (
      <ResourceNotice icon={<FileText />} title={title}>
        Documento indisponível.
      </ResourceNotice>
    );
  }
  const markdown = resource.path.endsWith(".md");
  return (
    <details className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-text-2">
        <FileText className="size-4 text-text-4" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="text-[11px] font-normal text-text-4">{resource.path}</span>
      </summary>
      <div className="max-h-80 overflow-auto border-t border-border p-3 text-xs leading-5 text-text-3">
        {markdown ? (
          <Markdown variant="reading">{document.text}</Markdown>
        ) : (
          <pre className="font-mono whitespace-pre-wrap">{document.text}</pre>
        )}
        {document.truncated ? <p className="mt-2 text-text-4">Prévia truncada.</p> : null}
      </div>
    </details>
  );
}

function LinkResource({ resource }: { resource: Extract<ThreadResource, { kind: "link" }> }) {
  return (
    <a
      href={resource.url}
      target="_blank"
      rel="noreferrer"
      className="flex w-full max-w-lg items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm font-medium text-text-2 hover:bg-muted/50"
    >
      <ExternalLink className="size-4 text-text-4" />
      <span className="min-w-0 flex-1 truncate">{resource.title}</span>
    </a>
  );
}

const OPERATION_ICON = {
  pending: <Clock3 />,
  running: <LoaderCircle className="animate-spin" />,
  succeeded: <Check />,
  failed: <X />,
  cancelled: <X />,
};

function OperationResource({
  resource,
}: {
  resource: Extract<ThreadResource, { kind: "operation" }>;
}) {
  return (
    <div
      className={cn(
        "flex w-full max-w-lg items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-2",
        resource.status === "failed" && "border-destructive/30 text-destructive",
      )}
    >
      <span className="[&_svg]:size-4">{OPERATION_ICON[resource.status]}</span>
      <span>{resource.label}</span>
    </div>
  );
}

function ResourceNotice({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full max-w-lg items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-2.5">
      <span className="text-text-4 [&_svg]:size-4">{icon}</span>
      <div>
        <p className="text-sm font-medium text-text-2">{title}</p>
        <p className="text-xs text-text-4">{children}</p>
      </div>
    </div>
  );
}
