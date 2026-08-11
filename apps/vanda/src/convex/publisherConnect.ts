import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, query } from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import {
  deleteProfile,
  ensureProfile,
  generateConnectUrl,
  getProfile,
  instagramStateOf,
} from "./publisher/uploadpost";

/**
 * Instagram connection through the publisher port (Upload-Post). Each Vanda
 * account owns one publisher profile (username = the account id); customers
 * link Instagram on a white-label page we mint a URL for, and their tokens
 * stay inside the publisher — our snapshot is just {handle, connectedAt}.
 */

const originOf = (raw: string): string => {
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("invalid origin");
  }
  return parsed.origin;
};

/** First touchpoint for a brand-new user: upsert the users row, insert the account. */
export const createPendingAccount = internalMutation({
  args: {
    clerkId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"accounts">> => {
    const now = Date.now();
    let user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (!user) {
      const userId = await ctx.db.insert("users", {
        name: args.name ?? "User",
        email: args.email ?? "",
        clerkId: args.clerkId,
        createdAt: now,
        updatedAt: now,
      });
      user = (await ctx.db.get(userId))!;
    }
    return ctx.db.insert("accounts", {
      ownerUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const assertOwned = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
  },
});

/** Write the connection snapshot after a profile sync. */
export const applyConnection = internalMutation({
  args: {
    accountId: v.id("accounts"),
    connected: v.boolean(),
    username: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { accountId, connected, username }) => {
    const account = await requireOwnedAccount(ctx, accountId);
    await ctx.db.patch(accountId, {
      ...(username !== null ? { handle: username } : {}),
      ...(account.name === undefined && username !== null ? { name: username } : {}),
      publisherConnectedAt: connected ? (account.publisherConnectedAt ?? Date.now()) : undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Start (or resume) the Instagram connect flow: ensures the account and its
 * publisher profile exist, then mints the white-label connect URL. The
 * customer lands back on `/onboarding?accountId=…` (or `/perfil`) and
 * `syncConnection` picks up the result.
 */
export const startConnect = action({
  args: {
    accountId: v.optional(v.id("accounts")),
    origin: v.string(),
    returnTo: v.optional(v.literal("perfil")),
  },
  handler: async (ctx, args): Promise<{ accountId: Id<"accounts">; url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    let accountId = args.accountId;
    if (accountId) {
      await ctx.runMutation(internal.publisherConnect.assertOwned, { accountId });
    } else {
      accountId = await ctx.runMutation(internal.publisherConnect.createPendingAccount, {
        clerkId: identity.subject,
        ...(typeof identity.name === "string" ? { name: identity.name } : {}),
        ...(typeof identity.email === "string" ? { email: identity.email } : {}),
      });
    }
    const username = String(accountId);
    await ensureProfile(username);
    const origin = originOf(args.origin);
    const redirectUrl =
      args.returnTo === "perfil"
        ? `${origin}/perfil`
        : `${origin}/onboarding?accountId=${username}`;
    const url = await generateConnectUrl({ username, redirectUrl });
    return { accountId, url };
  },
});

/** Pull the publisher profile and cache the Instagram connection state. */
export const syncConnection = action({
  args: { accountId: v.id("accounts") },
  handler: async (
    ctx,
    { accountId },
  ): Promise<{ connected: boolean; handle: string | null }> => {
    const profile = await getProfile(String(accountId));
    const state = profile
      ? instagramStateOf(profile)
      : { connected: false, username: null };
    await ctx.runMutation(internal.publisherConnect.applyConnection, {
      accountId,
      connected: state.connected,
      username: state.username,
    });
    return { connected: state.connected, handle: state.username };
  },
});

/** Connection state for the perfil card and onboarding gate. */
export const connectionStatus = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await requireOwnedAccount(ctx, accountId);
    return {
      connected: account.publisherConnectedAt !== undefined,
      handle: account.handle ?? null,
      connectedAt: account.publisherConnectedAt ?? null,
    };
  },
});

/** Best-effort publisher-profile removal when a Vanda account is deleted. */
export const cleanupProfile = internalAction({
  args: { username: v.string() },
  handler: async (_ctx, { username }) => {
    await deleteProfile(username);
  },
});
