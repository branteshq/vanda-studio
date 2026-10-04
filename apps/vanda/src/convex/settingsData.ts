import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { describeSetting, readAllSettings, writeSetting } from "./settings/registry";

/** All settings (`id` absent or "*"), or one setting with its options and how to change it. */
export const get = internalQuery({
  args: { userId: v.id("users"), id: v.optional(v.string()) },
  handler: async (ctx, { userId, id }) => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");

    if (!id || id === "*") return { settings: await readAllSettings(ctx, user) };

    return { setting: await describeSetting(ctx, user, id) };
  },
});

export const set = internalMutation({
  args: { userId: v.id("users"), id: v.string(), value: v.string() },
  handler: async (ctx, { userId, id, value }) => {
    const user = await ctx.db.get(userId);

    if (!user) throw new Error("user not found");

    return writeSetting(ctx, user, id, value);
  },
});
