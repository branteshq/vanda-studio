import type { ToolCtx } from "@convex-dev/agent";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { AgentActivityId } from "./agentActivity";

export type AgentCtx = {
  accountId?: Id<"accounts">;
  ownerUserId?: Id<"users">;
  // Shared by the tool contexts within one owner turn; only select_account changes it.
  accountScope?: { accountId: Id<"accounts"> | undefined };
  activityId?: AgentActivityId | undefined;
  caetanoThreadId?: string | undefined;
};

export const agentOwner = async (ctx: ToolCtx & AgentCtx): Promise<Id<"users">> => {
  if (ctx.ownerUserId) return ctx.ownerUserId;

  if (!ctx.accountId) throw new Error("conta não encontrada");

  const state = await ctx.runQuery(internal.openaiSub.subscriberState, {
    accountId: ctx.accountId,
  });

  if (!state.userId) throw new Error("dono não encontrado");

  return state.userId;
};

export const agentIdentity = async (ctx: ToolCtx & AgentCtx, requested?: string) => {
  const userId = await agentOwner(ctx);

  // SAFETY: the receiving account queries validate ownership of requested account IDs.
  const accountId = requested
    ? (requested as Id<"accounts">)
    : (ctx.accountId ?? ctx.accountScope?.accountId);

  if (!accountId && ctx.accountScope) throw new Error("nenhuma conta ativa");

  if (accountId) return { userId, accountId };

  return { userId };
};

/** Account conversations stay pinned; owner conversations follow the selected business. */
export const agentAccount = async (ctx: ToolCtx & AgentCtx): Promise<Id<"accounts">> => {
  if (ctx.accountId) return ctx.accountId;
  const account = await ctx.runQuery(internal.caetanoData.accountStatus, await agentIdentity(ctx));

  if (!account.onboardingComplete) throw new Error("conta ainda não concluiu o onboarding");

  return account.accountId;
};
