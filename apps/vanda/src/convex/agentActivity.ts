import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

export type AgentActivityId = Id<"chatThreadActivity"> | Id<"caetanoThreadActivity">;

export const agentActivityIdValidator = v.union(
  v.id("chatThreadActivity"),
  v.id("caetanoThreadActivity"),
);

export type AgentActivity = Doc<"chatThreadActivity"> | Doc<"caetanoThreadActivity">;

/** Require the exact originating turn and ensure it belongs to the account owner. */
export const requireOwnedAgentActivity = async (
  ctx: Pick<QueryCtx, "db">,
  accountId: Id<"accounts">,
  activityId: AgentActivityId,
): Promise<AgentActivity> => {
  const [account, activity] = await Promise.all([ctx.db.get(accountId), ctx.db.get(activityId)]);

  if (
    !account ||
    !activity ||
    ("accountId" in activity
      ? activity.accountId !== accountId
      : activity.userId !== account.ownerUserId)
  ) {
    throw new Error("activity expired");
  }

  return activity;
};
