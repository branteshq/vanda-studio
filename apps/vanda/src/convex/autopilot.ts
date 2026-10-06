import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { publicError } from "../errors";
import { requireOwnedAccount, requireUser } from "./authz";
import {
  applyApprove,
  applyRegenerate,
  applyRestore,
  applySkip,
  getConfig,
  historyOf,
  overviewOf,
  slotView,
  type AutopilotSlotView,
  requestRefresh,
  type AutopilotOverview,
  type AutopilotWeekView,
} from "./autopilotData";
import { writeSetting } from "./settings/registry";

/**
 * The Posts automáticos view and the chat card. Every write goes through the
 * same helpers as Vanda and Caetano's tools (autopilotData.ts). Turning the
 * autopilot on or off is a platform setting: settingsData.writeSetting.
 */

/** Settings act on the active business; the page always shows that one. */
const requireActiveAccount = async (ctx: MutationCtx, accountId: Id<"accounts">) => {
  await requireOwnedAccount(ctx, accountId);
  const user = await requireUser(ctx);

  if (user.activeAccountId !== accountId) throw publicError("INVALID_INPUT");
};

export const overview = query({
  args: { accountId: v.id("accounts"), now: v.optional(v.number()) },
  handler: async (ctx, { accountId, now }): Promise<AutopilotOverview> => {
    await requireOwnedAccount(ctx, accountId);

    return overviewOf(ctx, accountId, now ?? Date.now());
  },
});

/** Just whether Caetano is in control: the sidebar's dot, without the whole overview. */
export const enabled = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<boolean> => {
    await requireOwnedAccount(ctx, accountId);

    return (await getConfig(ctx, accountId))?.enabled ?? false;
  },
});

/** The on/off switch is a platform setting, shared with the agents' settings_set. */
export const setEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }): Promise<void> => {
    await writeSetting(
      ctx,
      await requireUser(ctx),
      "autopilot.enabled",
      enabled ? "ligado" : "desligado",
    );
  },
});

/** One autopilot post, for the editor opened from the Calendário or the rail. */
export const slot = query({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots") },
  handler: async (ctx, { accountId, slotId }): Promise<AutopilotSlotView | null> => {
    await requireOwnedAccount(ctx, accountId);
    const found = await ctx.db.get(slotId);

    return found && found.accountId === accountId ? slotView(ctx, found) : null;
  },
});

export const history = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<AutopilotWeekView[]> => {
    await requireOwnedAccount(ctx, accountId);

    return historyOf(ctx, accountId, Date.now());
  },
});

export const skipSlot = mutation({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots") },
  handler: async (ctx, { accountId, slotId }) => {
    await requireOwnedAccount(ctx, accountId);
    await applySkip(ctx, accountId, slotId);
  },
});

export const restoreSlot = mutation({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots") },
  handler: async (ctx, { accountId, slotId }) => {
    await requireOwnedAccount(ctx, accountId);

    return applyRestore(ctx, accountId, slotId);
  },
});

/** The owner accepts a produced post: it is armed for its time. */
export const approveSlot = mutation({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots") },
  handler: async (ctx, { accountId, slotId }) => {
    await requireOwnedAccount(ctx, accountId);
    await applyApprove(ctx, accountId, slotId);
  },
});

/** Produce the post now: the first version ahead of the 24h mark, or a new one. */
export const regenerateSlot = mutation({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots") },
  handler: async (ctx, { accountId, slotId }) => {
    await requireOwnedAccount(ctx, accountId);
    await applyRegenerate(ctx, accountId, slotId);
  },
});

/** Whether produced posts wait for approval: the autopilot.approval setting. */
export const setApproval = mutation({
  args: {
    accountId: v.id("accounts"),
    approval: v.union(v.literal("required"), v.literal("auto")),
  },
  handler: async (ctx, { accountId, approval }): Promise<void> => {
    await requireActiveAccount(ctx, accountId);
    await writeSetting(
      ctx,
      await requireUser(ctx),
      "autopilot.approval",
      approval === "required" ? "pedir aceite" : "publicar sem aceite",
    );
  },
});

/** "Reanalisar": fresh diagnosis, then replan what isn't produced or fixed yet. */
export const reanalyze = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    await requestRefresh(ctx, accountId, true);
  },
});
