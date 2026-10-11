import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { currentPostType } from "../../pipeline/constants";
import {
  entityName,
  formatDate,
  jsonFile,
  resolveByName,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceMount,
} from "../types";

const LISTING_CAP = 60;

const loadPosts = async (ctx: QueryCtx, accountId: Id<"accounts">) =>
  ctx.db
    .query("posts")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .order("desc")
    .take(LISTING_CAP);

/** A posts automáticos draft is the slot's current post, or a version it replaced. */
const originOf = async (ctx: QueryCtx, post: Doc<"posts">): Promise<string> => {
  if (post.origin !== "autopilot") return "";

  const slot = post.autopilotSlotId ? await ctx.db.get(post.autopilotSlotId) : null;

  return slot?.postId === post._id
    ? " · post automático do Caetano"
    : " · versão descartada de um post automático (não use; o post vale só se for refeito)";
};

const scheduledOf = (ctx: QueryCtx, postId: Id<"posts">) =>
  ctx.db
    .query("scheduledPosts")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .first();

const statusOf = (post: Doc<"posts">, scheduled: Doc<"scheduledPosts"> | null): string =>
  scheduled === null ? post.status : scheduled.status;

const purposeOf = (post: Doc<"posts">): string =>
  post.purpose === undefined
    ? "sem propósito"
    : `${post.purpose}${post.secondaryPurpose ? ` (+${post.secondaryPurpose})` : ""}`;

const captionHead = (caption: string): string => caption.replaceAll("\n", " ").slice(0, 40).trim();

/** The post calendar: every post's lifecycle state, agent-readable. Posts are
 * created by create_post (or by approving a carousel project) and committed by
 * schedule_post — never by writing files. */
export const postsMount: WorkspaceMount = {
  root: "posts",
  summary:
    "calendário de posts: rascunhos, agendados e publicados, inclusive os posts automáticos do Caetano",
  writeHint: "estado dos posts — somente leitura; crie com create_post e agende com schedule_post.",
  list: async (ctx, accountId, segments): Promise<WorkspaceEntry[] | null> => {
    if (segments.length !== 0) return null;
    const posts = await loadPosts(ctx, accountId);

    return Promise.all(
      posts.map(async (post) => {
        const scheduled = await scheduledOf(ctx, post._id);
        const status = statusOf(post, scheduled);

        return {
          name: `${entityName(captionHead(post.caption) || "post", post._id)}.json`,
          kind: "file" as const,
          summary:
            `${status}` +
            `${scheduled ? ` · ${formatDate(scheduled.scheduledFor)}` : ""}` +
            ` · ${currentPostType(post.type, post.imageIds.length)}${post.format ? ` · ${post.format}` : ""} · ${purposeOf(post)}` +
            ` · ${post.imageIds.length} imagem(ns)` +
            (await originOf(ctx, post)) +
            ` · ${captionHead(post.caption)}`,
        };
      }),
    );
  },
  read: async (ctx, accountId, segments): Promise<WorkspaceFile | null> => {
    if (segments.length !== 1) return null;
    const posts = await loadPosts(ctx, accountId);
    const post = resolveByName(segments[0]!, posts);

    if (!post) return null;
    const scheduled = await scheduledOf(ctx, post._id);

    return jsonFile({
      postId: post._id,
      status: statusOf(post, scheduled),
      type: currentPostType(post.type, post.imageIds.length),
      format: post.format ?? null,
      purpose: post.purpose ?? null,
      secondaryPurpose: post.secondaryPurpose ?? null,
      rationale: post.rationale ?? null,
      caption: post.caption,
      imageIds: post.imageIds,
      createdAt: formatDate(post.createdAt),
      scheduledFor: scheduled ? formatDate(scheduled.scheduledFor) : null,
      permalink: scheduled?.permalink ?? null,
      lastError: scheduled?.lastError ?? null,
      // Autopilot posts are changed with the autopilot_* tools, by slotId (see /autopilot/plan.md).
      autopilotSlotId: post.autopilotSlotId ?? null,
    });
  },
};
