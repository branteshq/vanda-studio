import { getThreadMetadata, saveMessage } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwnedAccount, requireUser } from "./authz";
import {
  dedupeResources,
  presentableResourceInputValidator,
  threadResourceValidator,
  type ThreadResource,
} from "./resourceRefs";
import { readPath } from "./workspace";

export interface ThreadResourceManifest {
  readonly anchorMessageId: string;
  readonly resources: ThreadResource[];
  readonly presented: ThreadResource[];
}

interface ManifestWrite {
  readonly threadId: string;
  readonly anchorMessageId: string;
  readonly toolCallId: string;
  readonly resources: readonly ThreadResource[];
  readonly presented: readonly ThreadResource[];
}

const upsertManifest = async (ctx: MutationCtx, args: ManifestWrite): Promise<void> => {
  const existing = await ctx.db
    .query("threadResourceManifests")
    .withIndex("by_thread_tool", (q) =>
      q.eq("threadId", args.threadId).eq("toolCallId", args.toolCallId),
    )
    .unique();
  const value = {
    anchorMessageId: args.anchorMessageId,
    resources: dedupeResources(args.resources),
    presented: dedupeResources(args.presented),
  };
  if (existing) {
    await ctx.db.patch(existing._id, value);
    return;
  }
  await ctx.db.insert("threadResourceManifests", {
    threadId: args.threadId,
    toolCallId: args.toolCallId,
    ...value,
    createdAt: Date.now(),
  });
};

export const record = internalMutation({
  args: {
    threadId: v.string(),
    anchorMessageId: v.string(),
    toolCallId: v.string(),
    resources: v.array(threadResourceValidator),
    presented: v.array(threadResourceValidator),
  },
  handler: upsertManifest,
});

const manifestsForThread = async (ctx: QueryCtx, threadId: string) =>
  ctx.db
    .query("threadResourceManifests")
    .withIndex("by_thread_created", (q) => q.eq("threadId", threadId))
    .order("desc")
    .take(500);

export const forPrompt = internalQuery({
  args: { threadId: v.string(), anchorMessageId: v.string() },
  handler: async (ctx, { threadId, anchorMessageId }): Promise<ThreadResourceManifest> => {
    const rows = await manifestsForThread(ctx, threadId);
    const matching = rows.filter((row) => row.anchorMessageId === anchorMessageId);
    return {
      anchorMessageId,
      resources: dedupeResources(matching.flatMap((row) => row.resources)),
      presented: dedupeResources(matching.flatMap((row) => row.presented)),
    };
  },
});

export const postPublicationFollowup = internalMutation({
  args: { scheduledPostId: v.id("scheduledPosts") },
  handler: async (ctx, { scheduledPostId }): Promise<void> => {
    const scheduled = await ctx.db.get(scheduledPostId);
    if (!scheduled || (scheduled.status !== "published" && scheduled.status !== "failed")) return;
    const post = await ctx.db.get(scheduled.postId);
    if (!post) return;
    const succeeded = scheduled.status === "published";
    const operation: ThreadResource = {
      kind: "operation",
      operation: "post.publish",
      operationId: scheduledPostId,
      accountId: post.accountId,
      status: succeeded ? "succeeded" : "failed",
      label: succeeded
        ? "Publicado no Instagram"
        : `Falha ao publicar${scheduled.lastError ? `: ${scheduled.lastError}` : ""}`,
    };
    const resources: ThreadResource[] = [
      { kind: "post", accountId: post.accountId, postId: post._id },
      operation,
      ...(scheduled.permalink
        ? [{ kind: "link" as const, url: scheduled.permalink, title: "Ver no Instagram" }]
        : []),
    ];
    const owner = await ctx.db
      .get(post.accountId)
      .then((account) => (account?.ownerUserId ? ctx.db.get(account.ownerUserId) : null));
    const destinations = [
      ...(post.originThreadId
        ? [
            {
              threadId: post.originThreadId,
              agentName: "vanda",
              expectedUserId: String(post.accountId),
            },
          ]
        : []),
      ...(post.caetanoThreadId && owner
        ? [
            {
              threadId: post.caetanoThreadId,
              agentName: "caetano",
              expectedUserId: `caetano:${owner._id}`,
            },
          ]
        : []),
    ].filter(
      (destination, index, all) =>
        all.findIndex((candidate) => candidate.threadId === destination.threadId) === index,
    );
    for (const destination of destinations) {
      const metadata = await getThreadMetadata(ctx, components.agent, {
        threadId: destination.threadId,
      }).catch(() => null);
      if (!metadata || metadata.userId !== destination.expectedUserId) continue;
      const text = succeeded
        ? "A publicação terminou e já está no Instagram."
        : `A publicação falhou${scheduled.lastError ? `: ${scheduled.lastError}` : "."}`;
      const { messageId } = await saveMessage(ctx, components.agent, {
        threadId: destination.threadId,
        agentName: destination.agentName,
        message: { role: "assistant", content: text },
      });
      await upsertManifest(ctx, {
        threadId: destination.threadId,
        anchorMessageId: messageId,
        toolCallId: `publication:${scheduledPostId}:${scheduled.status}`,
        resources,
        presented: resources,
      });
    }
  },
});

export const listForVanda = query({
  args: { accountId: v.id("accounts"), threadId: v.string() },
  handler: async (ctx, { accountId, threadId }) => {
    await requireOwnedAccount(ctx, accountId);
    const metadata = await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null);
    if (!metadata || metadata.userId !== String(accountId)) throw new Error("thread not found");
    return (await manifestsForThread(ctx, threadId)).map((row) => ({
      anchorMessageId: row.anchorMessageId,
      presented: row.presented,
    }));
  },
});

export const listForCaetano = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const user = await requireUser(ctx);
    const metadata = await getThreadMetadata(ctx, components.agent, { threadId }).catch(() => null);
    if (!metadata || metadata.userId !== `caetano:${user._id}`) {
      throw new Error("conversa não encontrada");
    }
    return (await manifestsForThread(ctx, threadId)).map((row) => ({
      anchorMessageId: row.anchorMessageId,
      presented: row.presented,
    }));
  },
});

export const resolvePresentable = internalQuery({
  args: {
    accountId: v.id("accounts"),
    resources: v.array(presentableResourceInputValidator),
  },
  handler: async (ctx, { accountId, resources }): Promise<ThreadResource[]> => {
    if (!(await ctx.db.get(accountId))) throw new Error("account not found");
    const resolved: ThreadResource[] = [];
    for (const resource of resources) {
      if (resource.kind === "image") {
        const image = await ctx.db.get(resource.imageId);
        if (!image || image.accountId !== accountId) throw new Error("imagem não encontrada");
        resolved.push({ kind: "image", accountId, imageId: resource.imageId });
        continue;
      }
      if (resource.kind === "post") {
        const post = await ctx.db.get(resource.postId);
        if (!post || post.accountId !== accountId) throw new Error("post não encontrado");
        resolved.push({ kind: "post", accountId, postId: resource.postId });
        continue;
      }
      if (resource.kind === "document") {
        const document = await readPath(ctx, accountId, resource.path);
        if (!document.ok) throw new Error(`documento não encontrado: ${resource.path}`);
        resolved.push({
          kind: "document",
          accountId,
          path: document.path,
          ...(resource.title ? { title: resource.title } : {}),
        });
        continue;
      }
      const url = new URL(resource.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("link inválido");
      }
      resolved.push(resource);
    }
    return dedupeResources(resolved);
  },
});

const MAX_DOCUMENT_PREVIEW_CHARS = 20_000;

export const readDocument = query({
  args: { accountId: v.id("accounts"), path: v.string() },
  handler: async (ctx, { accountId, path }) => {
    await requireOwnedAccount(ctx, accountId);
    const result = await readPath(ctx, accountId, path);
    if (!result.ok || result.file.kind !== "text") return null;
    const truncated = result.file.text.length > MAX_DOCUMENT_PREVIEW_CHARS;
    return {
      path: result.path,
      text: truncated ? result.file.text.slice(0, MAX_DOCUMENT_PREVIEW_CHARS) : result.file.text,
      truncated,
    };
  },
});
