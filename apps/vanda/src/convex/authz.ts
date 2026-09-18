import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { publicError } from "../errors";

/**
 * The signed-in app user, or throw. The auth gate every public app-facing
 * function shares (queries that must not fall back to `[]`, and every mutation).
 */
export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) throw publicError("UNAUTHENTICATED");

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user) throw publicError("NOT_FOUND");

  return user;
}

/**
 * Resolve the caller's owned account or throw — the auth gate for every
 * account-scoped op. A missing user and an unowned account collapse to the same
 * "account not found" so ownership is never revealed by the error.
 */
export async function requireOwnedAccount(ctx: QueryCtx | MutationCtx, accountId: Id<"accounts">) {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) throw publicError("UNAUTHENTICATED");

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();

  const account = await ctx.db.get(accountId);

  if (!user || account === null || account.ownerUserId !== user._id) {
    throw publicError("NOT_FOUND");
  }

  return account;
}
