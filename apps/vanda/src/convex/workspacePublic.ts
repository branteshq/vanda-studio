import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import { listPath, readPath, type ListResult, type ReadResult } from "./workspace";

/**
 * The owner-facing window into the agent's workspace — the same resolver the
 * list/read tools use, gated by account ownership. What Vanda sees, the owner
 * can see: memory, templates and brand notes stop being invisible state.
 */

export const browse = query({
  args: { accountId: v.id("accounts"), path: v.string() },
  handler: async (ctx, { accountId, path }): Promise<ListResult> => {
    await requireOwnedAccount(ctx, accountId);
    return listPath(ctx, accountId, path);
  },
});

export const file = query({
  args: { accountId: v.id("accounts"), path: v.string() },
  handler: async (ctx, { accountId, path }): Promise<ReadResult> => {
    await requireOwnedAccount(ctx, accountId);
    return readPath(ctx, accountId, path);
  },
});
