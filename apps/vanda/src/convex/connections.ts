import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { accountModes } from "./pipeline/constants";

/** Promote a connected Instagram account into a pipeline `accounts` row (idempotent). */
export const promoteConnection = internalMutation({
  args: {
    connectionId: v.id("instagramConnections"),
    mode: v.optional(v.union(...accountModes.map((mode) => v.literal(mode)))),
  },
  handler: async (ctx, { connectionId, mode }) => {
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .first();
    if (existing !== null) return existing._id;
    const connection = await ctx.db.get(connectionId);
    if (connection === null) throw new Error("connection not found");
    const now = Date.now();
    return ctx.db.insert("accounts", {
      ownerUserId: connection.userId,
      connectionId,
      ...(connection.externalAccountName ? { name: connection.externalAccountName } : {}),
      mode: mode ?? "needs_approval",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Resolves the Instagram connection (id + encrypted token) for an account. */
export const getAccountConnection = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    if (account === null || account.connectionId === undefined) return null;
    const connection = await ctx.db.get(account.connectionId);
    if (connection === null) return null;
    return {
      igUserId: connection.externalAccountId,
      handle: connection.handle,
      lastSyncAt: connection.lastSyncAt,
      tokenCiphertext: connection.tokenCiphertext,
      tokenIv: connection.tokenIv,
      tokenAuthTag: connection.tokenAuthTag,
    };
  },
});
