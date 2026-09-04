import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { dedupeResources, threadResourceValidator, type ThreadResource } from "./resourceRefs";

export interface ThreadResourceManifest {
  readonly anchorMessageId: string;
  readonly resources: ThreadResource[];
  readonly presented: ThreadResource[];
}

export const record = internalMutation({
  args: {
    threadId: v.string(),
    anchorMessageId: v.string(),
    toolCallId: v.string(),
    resources: v.array(threadResourceValidator),
    presented: v.array(threadResourceValidator),
  },
  handler: async (ctx, args): Promise<void> => {
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
  },
});

export const forPrompt = internalQuery({
  args: { threadId: v.string(), anchorMessageId: v.string() },
  handler: async (ctx, { threadId, anchorMessageId }): Promise<ThreadResourceManifest> => {
    const rows = await ctx.db
      .query("threadResourceManifests")
      .withIndex("by_thread_created", (q) => q.eq("threadId", threadId))
      .collect();
    const matching = rows.filter((row) => row.anchorMessageId === anchorMessageId);
    return {
      anchorMessageId,
      resources: dedupeResources(matching.flatMap((row) => row.resources)),
      presented: dedupeResources(matching.flatMap((row) => row.presented)),
    };
  },
});
