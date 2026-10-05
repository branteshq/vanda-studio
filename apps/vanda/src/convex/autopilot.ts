import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import {
  applyCadence,
  applyRegenerate,
  applyResetCadence,
  applyRestore,
  applySkip,
  applySlotChange,
  historyOf,
  overviewOf,
  requestRefresh,
  slotChangeValidator,
  type AutopilotOverview,
  type AutopilotWeekView,
} from "./autopilotData";
import { cadenceEntryValidator } from "./autopilotModel";

/**
 * The Piloto automático view and the chat card. Every write goes through the
 * same helpers as Vanda and Caetano's tools (autopilotData.ts). Turning the
 * autopilot on or off is a platform setting: settingsData.writeSetting.
 */

export const overview = query({
  args: { accountId: v.id("accounts"), now: v.optional(v.number()) },
  handler: async (ctx, { accountId, now }): Promise<AutopilotOverview> => {
    await requireOwnedAccount(ctx, accountId);

    return overviewOf(ctx, accountId, now ?? Date.now());
  },
});

export const history = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<AutopilotWeekView[]> => {
    await requireOwnedAccount(ctx, accountId);

    return historyOf(ctx, accountId, Date.now());
  },
});

export const updateCadence = mutation({
  args: { accountId: v.id("accounts"), cadence: v.array(cadenceEntryValidator) },
  handler: async (ctx, { accountId, cadence }) => {
    await requireOwnedAccount(ctx, accountId);

    return applyCadence(ctx, accountId, cadence);
  },
});

export const resetCadence = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    await applyResetCadence(ctx, accountId);
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

/** "Reanalisar": fresh diagnosis, then replan what isn't produced or fixed yet. */
export const reanalyze = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    await requestRefresh(ctx, accountId, true);
  },
});
