import { v } from "convex/values";
import type { BrandContextSnapshot } from "./pipeline/brandContext";
import { internalQuery } from "./_generated/server";

export const load = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<BrandContextSnapshot> => {
    const account = await ctx.db.get(accountId);
    const connection =
      account?.connectionId === undefined ? null : await ctx.db.get(account.connectionId);
    const canon = await ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const references = (
      await ctx.db
        .query("images")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    ).filter((image) => image.purpose === "reference");
    const referenceImageUrls = (
      await Promise.all(
        references.map(
          async (image) =>
            image.externalUrl ??
            (image.storageId === undefined ? null : await ctx.storage.getUrl(image.storageId)),
        ),
      )
    ).filter((url): url is string => url !== null);

    return {
      locale: "pt-BR",
      accountName: account?.name,
      handle: connection?.handle,
      brandKind: account?.kind,
      canon: canon
        .filter((entry) => entry.confirmedByOwner)
        .map((entry) => ({ kind: entry.kind, text: entry.text })),
      referenceImageUrls,
    };
  },
});
