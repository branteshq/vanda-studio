import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import type { AutopilotSlotStatus } from "./autopilotModel";
import { purposeLabels } from "./pipeline/autopilot";

/**
 * The account's publication calendar: every scheduled/published post inside
 * [start, end), plus Caetano's automatic posts that are planned but not
 * produced yet, with enough of each to render a compact calendar item.
 */

export type CalendarStatus =
  | Doc<"scheduledPosts">["status"]
  | Extract<AutopilotSlotStatus, "planned" | "generating" | "awaiting_approval" | "skipped">;

export interface CalendarItem {
  key: string;
  scheduledFor: number;
  status: CalendarStatus;
  lastError: string | null;
  caption: string;
  slideCount: number;
  coverUrl: string | null;
  scheduledPostId: Id<"scheduledPosts"> | null;
  /** The post itself, once it exists: what the preview opens for posts made in the conversation. */
  postId: Id<"posts"> | null;
  /** Set for Caetano's automatic posts: the slot the editor opens. */
  autopilot: { slotId: Id<"autopilotSlots">; hook: string; purposeLabel: string } | null;
}

const coverOf = async (ctx: QueryCtx, post: Doc<"posts"> | null): Promise<string | null> => {
  const image = post?.imageIds[0] ? await ctx.db.get(post.imageIds[0]) : null;

  return (
    image?.externalUrl ?? (image?.storageId ? await ctx.storage.getUrl(image.storageId) : null)
  );
};

const autopilotOf = (slot: Doc<"autopilotSlots"> | null): CalendarItem["autopilot"] =>
  slot ? { slotId: slot._id, hook: slot.hook, purposeLabel: purposeLabels[slot.purpose] } : null;

/** Slot states that have no publication row yet; later states show through scheduledPosts. */
const UNPUBLISHED = new Set<AutopilotSlotStatus>([
  "planned",
  "generating",
  "awaiting_approval",
  "skipped",
  "failed",
]);

export const range = query({
  args: {
    accountId: v.id("accounts"),
    start: v.number(),
    end: v.number(),
  },
  handler: async (ctx, { accountId, start, end }): Promise<CalendarItem[]> => {
    await requireOwnedAccount(ctx, accountId);

    const scheduled = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_account_scheduledFor", (q) =>
        q.eq("accountId", accountId).gte("scheduledFor", start).lt("scheduledFor", end),
      )
      .collect();

    const published = await Promise.all(
      scheduled.map(async (item): Promise<CalendarItem> => {
        const post = await ctx.db.get(item.postId);
        const slot = post?.autopilotSlotId ? await ctx.db.get(post.autopilotSlotId) : null;

        return {
          key: item._id,
          scheduledFor: item.scheduledFor,
          status: item.status,
          lastError: item.lastError ?? null,
          caption: post?.caption ?? "",
          slideCount: post?.imageIds.length ?? 0,
          coverUrl: await coverOf(ctx, post),
          scheduledPostId: item._id,
          postId: item.postId,
          autopilot: autopilotOf(slot),
        };
      }),
    );

    const slots = await ctx.db
      .query("autopilotSlots")
      .withIndex("by_account_scheduledFor", (q) =>
        q.eq("accountId", accountId).gte("scheduledFor", start).lt("scheduledFor", end),
      )
      .collect();

    const pending: CalendarItem[] = [];

    for (const slot of slots) {
      if (!UNPUBLISHED.has(slot.status)) continue;

      const hasPublication =
        slot.postId !== undefined &&
        (await ctx.db
          .query("scheduledPosts")
          .withIndex("by_post", (q) => q.eq("postId", slot.postId!))
          .first()) !== null;

      if (hasPublication) continue;

      const post = slot.postId ? await ctx.db.get(slot.postId) : null;

      pending.push({
        key: slot._id,
        scheduledFor: slot.scheduledFor,
        // A slot that failed before a publication row existed reads as a failed publication.
        status: slot.status === "failed" ? "failed" : slot.status,
        lastError: slot.lastError ?? null,
        caption: post?.caption ?? slot.hook,
        slideCount: slot.slideCount,
        coverUrl: await coverOf(ctx, post),
        scheduledPostId: null,
        postId: slot.postId ?? null,
        autopilot: autopilotOf(slot),
      });
    }

    return [...published, ...pending].toSorted((a, b) => a.scheduledFor - b.scheduledFor);
  },
});
