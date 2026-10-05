import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { publicError } from "../errors";
import { requireOwnedAccount, requireUser } from "./authz";
import {
  applyApprove,
  applyForgetRule,
  applyRegenerate,
  applyReject,
  applyRestore,
  applySkip,
  applySlotChange,
  historyOf,
  overviewOf,
  slotView,
  type AutopilotSlotView,
  requestRefresh,
  slotChangeValidator,
  type AutopilotOverview,
  type AutopilotWeekView,
} from "./autopilotData";
import { cadenceEntryValidator } from "./autopilotModel";
import { writeSetting } from "./settings/registry";

/**
 * The Piloto automático view and the chat card. Every write goes through the
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

/** The cadence is the autopilot.cadence setting, the same write settings_set makes. */
export const updateCadence = mutation({
  args: { accountId: v.id("accounts"), cadence: v.array(cadenceEntryValidator) },
  handler: async (ctx, { accountId, cadence }): Promise<void> => {
    await requireActiveAccount(ctx, accountId);
    await writeSetting(ctx, await requireUser(ctx), "autopilot.cadence", JSON.stringify(cadence));
  },
});

export const resetCadence = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<void> => {
    await requireActiveAccount(ctx, accountId);
    await writeSetting(ctx, await requireUser(ctx), "autopilot.cadence", "vanda");
  },
});

export const updateSlot = mutation({
  args: {
    accountId: v.id("accounts"),
    slotId: v.id("autopilotSlots"),
    change: slotChangeValidator,
  },
  handler: async (ctx, { accountId, slotId, change }) => {
    await requireOwnedAccount(ctx, accountId);

    return applySlotChange(ctx, accountId, slotId, change);
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

export const regenerateSlot = mutation({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots") },
  handler: async (ctx, { accountId, slotId }) => {
    await requireOwnedAccount(ctx, accountId);
    await applyRegenerate(ctx, accountId, slotId);
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

/** The owner refuses a produced post; the reason is required and teaches the autopilot. */
export const rejectSlot = mutation({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots"), reason: v.string() },
  handler: async (ctx, { accountId, slotId, reason }) => {
    await requireOwnedAccount(ctx, accountId);

    return applyReject(ctx, accountId, slotId, reason);
  },
});

/** Retire a rule the autopilot learned from a rejection. */
export const forgetRule = mutation({
  args: { accountId: v.id("accounts"), feedbackId: v.id("autopilotFeedback") },
  handler: async (ctx, { accountId, feedbackId }) => {
    await requireOwnedAccount(ctx, accountId);
    await applyForgetRule(ctx, accountId, feedbackId);
  },
});

/** Whether produced posts wait for approval: the autopilot.approval setting. */
export const setApproval = mutation({
  args: { accountId: v.id("accounts"), approval: v.union(v.literal("required"), v.literal("auto")) },
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
