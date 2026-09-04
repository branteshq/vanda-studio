import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import type { ThreadResource } from "./resourceRefs";

export interface VandaDelegationResult {
  readonly accountId: Id<"accounts">;
  readonly threadId: string;
  readonly response: string;
  readonly link: string;
  readonly resources: ThreadResource[];
  readonly presented: ThreadResource[];
}

/** One complete Vanda turn delegated by Caetano. */
export const askVanda = internalAction({
  args: {
    userId: v.id("users"),
    caetanoThreadId: v.string(),
    accountId: v.optional(v.id("accounts")),
    threadId: v.optional(v.string()),
    request: v.string(),
  },
  handler: async (ctx, args): Promise<VandaDelegationResult> => {
    const prepared = await ctx.runMutation(internal.caetanoData.prepareVandaTurn, {
      userId: args.userId,
      request: args.request,
      ...(args.accountId ? { accountId: args.accountId } : {}),
      ...(args.threadId ? { threadId: args.threadId } : {}),
    });
    await ctx.runMutation(internal.caetanoData.setActiveVandaThread, {
      userId: args.userId,
      caetanoThreadId: args.caetanoThreadId,
      vandaThreadId: prepared.threadId,
    });
    const response = await ctx.runAction(internal.chat.generateResponse, prepared);
    const manifest = await ctx.runQuery(internal.threadResources.forPrompt, {
      threadId: prepared.threadId,
      anchorMessageId: prepared.promptMessageId,
    });
    return {
      accountId: prepared.accountId,
      threadId: prepared.threadId,
      response,
      link: `/conversa?t=${encodeURIComponent(prepared.threadId)}`,
      resources: manifest.resources,
      presented: manifest.presented,
    };
  },
});
