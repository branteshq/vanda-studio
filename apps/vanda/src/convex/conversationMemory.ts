import { getThreadMetadata } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";

const identity = { threadId: v.string(), ownerKey: v.string(), promptMessageId: v.string() };

async function requirePrompt(
  ctx: QueryCtx,
  args: { threadId: string; ownerKey: string; promptMessageId: string },
) {
  const thread = await getThreadMetadata(ctx, components.agent, { threadId: args.threadId });

  const [prompt] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
    messageIds: [args.promptMessageId],
  });

  if (
    thread.userId !== args.ownerKey ||
    !prompt ||
    prompt.threadId !== args.threadId ||
    prompt.message?.role !== "user"
  )
    throw new Error("conversa não encontrada");

  return prompt;
}

export const checkpoint = internalQuery({
  args: identity,
  handler: async (ctx, args) => {
    const prompt = await requirePrompt(ctx, args);

    const summary = await ctx.db
      .query("conversationSummaries")
      .withIndex("by_thread_order", (q) =>
        q.eq("threadId", args.threadId).lt("throughOrder", prompt.order),
      )
      .order("desc")
      .first();

    return { summary, promptOrder: prompt.order };
  },
});

export const page = internalQuery({
  args: { ...identity, cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    await requirePrompt(ctx, args);

    return ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
      threadId: args.threadId,
      upToAndIncludingMessageId: args.promptMessageId,
      order: "desc",
      paginationOpts: { cursor: args.cursor, numItems: 100 },
    });
  },
});

export const save = internalMutation({
  args: { ...identity, throughMessageId: v.string(), summary: v.string() },
  handler: async (ctx, args) => {
    const prompt = await requirePrompt(ctx, args);

    const [through] = await ctx.runQuery(components.agent.messages.getMessagesByIds, {
      messageIds: [args.throughMessageId],
    });

    if (
      !through ||
      through.threadId !== args.threadId ||
      through.order >= prompt.order ||
      through.status !== "success"
    )
      throw new Error("invalid summary boundary");

    if (!args.summary.trim() || args.summary.length > 18_000)
      throw new Error("invalid summary size");

    const existing = await ctx.db
      .query("conversationSummaries")
      .withIndex("by_thread_order", (q) =>
        q.eq("threadId", args.threadId).eq("throughOrder", through.order),
      )
      .first();

    if (existing) return;

    await ctx.db.insert("conversationSummaries", {
      threadId: args.threadId,
      ownerKey: args.ownerKey,
      throughOrder: through.order,
      throughMessageId: args.throughMessageId,
      summary: args.summary,
    });
  },
});
