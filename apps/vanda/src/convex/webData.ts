import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { agentActivityIdValidator, requireOwnedAgentActivity } from "./agentActivity";
import { publicError } from "../errors";
import { budgetOf, chargeUsage } from "./usage";
import { webCostUsd } from "./web";
import { saveDocument } from "./workspace/documents";

export const begin = internalMutation({
  args: {
    accountId: v.id("accounts"),
    activityId: v.optional(agentActivityIdValidator),
    requestId: v.string(),
    threadId: v.string(),
    operation: v.union(v.literal("search"), v.literal("read")),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    const user = account?.ownerUserId ? await ctx.db.get(account.ownerUserId) : null;

    if (!user) throw publicError("NOT_FOUND");
    let requestId = args.requestId;
    let threadId = args.threadId;

    if (args.activityId) {
      const activity = await requireOwnedAgentActivity(ctx, args.accountId, args.activityId);
      requestId =
        "accountId" in activity
          ? (activity.requestId ?? activity.promptMessageId)
          : activity.promptMessageId;
      threadId = activity.threadId;
    }

    const now = Date.now();

    const recent = await ctx.db
      .query("webRequests")
      .withIndex("by_user_created", (q) =>
        q.eq("userId", user._id).gte("createdAt", now - 86400000),
      )
      .collect();

    // Failed attempts count, so provider failures cannot cause an unbounded retry loop.
    if (
      recent.length >= 100 ||
      recent.filter((row) => row.requestId === requestId && row.threadId === threadId).length >= 8
    ) {
      throw publicError("WEB_LIMIT");
    }

    const budget = await budgetOf(ctx, user);

    const reserved = recent.reduce(
      (total, row) =>
        total + (row.status === "pending" ? webCostUsd(row.operation) * 1_000_000 : 0),
      0,
    );

    if (
      !budget.ok ||
      budget.spentMicroUsd + reserved + webCostUsd(args.operation) * 1_000_000 >
        budget.allowanceMicroUsd
    ) {
      throw publicError("USAGE_LIMIT");
    }

    return ctx.db.insert("webRequests", {
      ...args,
      userId: user._id,
      requestId,
      threadId,
      createdAt: now,
      status: "pending",
    });
  },
});

export const finish = internalMutation({
  args: { id: v.id("webRequests"), billable: v.boolean(), evidence: v.optional(v.string()) },
  handler: async (ctx, { id, billable, evidence }): Promise<string[]> => {
    const request = await ctx.db.get(id);

    if (!request || request.status !== "pending") return [];
    const { accountId, userId, requestId, threadId, activityId } = request;

    await ctx.db.patch(id, { status: "finished" });

    if (billable)
      await chargeUsage(ctx, {
        accountId,
        userId,
        requestId,
        threadId,
        kind: `web_parallel_${request.operation}`,
        usd: webCostUsd(request.operation),
        ref: String(id),
      });

    // Completed provider work remains charged even if the owner cancelled the turn.
    if (activityId) {
      const activity = await ctx.db.get(activityId);

      if (!activity) return [];
      await requireOwnedAgentActivity(ctx, accountId, activityId);

      const currentRequest =
        "accountId" in activity
          ? (activity.requestId ?? activity.promptMessageId)
          : activity.promptMessageId;

      if (currentRequest !== requestId || activity.threadId !== threadId) return [];
    }

    if (!evidence || !(await ctx.db.get(accountId))) return [];
    const paths: string[] = [];

    // Preserve every received character, split below the workspace document limit.
    for (let offset = 0; offset < evidence.length; ) {
      let end = Math.min(offset + 60000, evidence.length);

      // Do not split an emoji's UTF-16 surrogate pair across stored documents.
      const last = evidence.charCodeAt(end - 1);

      if (end < evidence.length && last >= 0xd800 && last <= 0xdbff) end--;
      const path = `/web/${id}-${paths.length + 1}.md`;

      const saved = await saveDocument(ctx, accountId, path, evidence.slice(offset, end));

      if (!saved.ok) throw publicError("UNEXPECTED");
      paths.push(path);
      offset = end;
    }

    return paths;
  },
});
