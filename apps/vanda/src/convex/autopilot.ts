import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOwnedAccount, requireUser } from "./authz";
import {
  applyApprove,
  applyRegenerate,
  applyRestore,
  applySkip,
  overviewOf,
  slotView,
  type AutopilotSlotView,
  type AutopilotOverview,
} from "./autopilotData";
import { writeSetting } from "./settings/registry";

/**
 * The Posts automáticos panel on the Calendário and the post dialog. Every
 * write goes through the same helpers as Vanda and Caetano's tools
 * (autopilotData.ts). On/off and approval are platform settings
 * (settings/registry.writeSetting); cadence changes in the conversation.
 */

export const overview = query({
  args: { accountId: v.id("accounts"), now: v.optional(v.number()) },
  handler: async (ctx, { accountId, now }): Promise<AutopilotOverview> => {
    await requireOwnedAccount(ctx, accountId);

    return overviewOf(ctx, accountId, now ?? Date.now());
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

/** Whether posts wait for the owner's approval: the autopilot.approval setting. */
export const setApproval = mutation({
  args: { required: v.boolean() },
  handler: async (ctx, { required }): Promise<void> => {
    await writeSetting(
      ctx,
      await requireUser(ctx),
      "autopilot.approval",
      required ? "pedir aceite" : "publicar sem aceite",
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
