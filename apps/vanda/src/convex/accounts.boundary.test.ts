// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("accounts.listMine — the owner's businesses", () => {
  it("returns only my accounts, names defaulted from the connected handle", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { withHandle, override } = await t.run(async (ctx) => {
      const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });
      const other = await ctx.db.insert("users", { name: "O", email: "o@e.com", clerkId: "other" });
      const withHandle = await ctx.db.insert("accounts", {
        ownerUserId: me,
        handle: "cafelumiar",
        publisherConnectedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const override = await ctx.db.insert("accounts", {
        ownerUserId: me,
        name: "Segundo Negócio",
        createdAt: now,
        updatedAt: now,
      });
      // Another owner's account must never surface in my switcher.
      await ctx.db.insert("accounts", {
        ownerUserId: other,
        createdAt: now,
        updatedAt: now,
      });
      return { withHandle, override };
    });

    const rows = await t.withIdentity({ subject: "me" }).query(api.accounts.listMine, {});
    expect(rows).toHaveLength(2);
    const find = (id: string) => rows.find((r) => r.id === id)!;
    expect(find(withHandle).name).toBe("cafelumiar"); // defaults from the handle
    expect(find(withHandle).connected).toBe(true);
    expect(find(override).name).toBe("Segundo Negócio"); // explicit override wins
    expect(find(override).connected).toBe(false);
  });

  it("returns [] when signed out", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.accounts.listMine, {})).toEqual([]);
  });
});

describe("accounts.selectActive", () => {
  it("persists an owned onboarded business and rejects pending or unowned accounts", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { me, ready, pending, theirs } = await t.run(async (ctx) => {
      const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });
      const other = await ctx.db.insert("users", { name: "O", email: "o@e.com", clerkId: "other" });
      const ready = await ctx.db.insert("accounts", {
        ownerUserId: me,
        onboardedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const pending = await ctx.db.insert("accounts", {
        ownerUserId: me,
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      const theirs = await ctx.db.insert("accounts", {
        ownerUserId: other,
        onboardedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      return { me, ready, pending, theirs };
    });

    const asMe = t.withIdentity({ subject: "me" });
    await asMe.mutation(api.accounts.selectActive, { accountId: ready });
    expect((await t.run((ctx) => ctx.db.get(me)))?.activeAccountId).toBe(ready);
    await expect(asMe.mutation(api.accounts.selectActive, { accountId: pending })).rejects.toThrow();
    await expect(asMe.mutation(api.accounts.selectActive, { accountId: theirs })).rejects.toThrow();
  });
});

describe("publisherConnect.applyConnection", () => {
  it("caches the synced handle, defaults the name, and clears on disconnect", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const accountId = await t.run(async (ctx) => {
      const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });
      return ctx.db.insert("accounts", {
        ownerUserId: me,
        createdAt: now,
        updatedAt: now,
      });
    });

    const asMe = t.withIdentity({ subject: "me" });
    await asMe.mutation(internal.publisherConnect.applyConnection, {
      accountId,
      connected: true,
      username: "cafelumiar",
    });
    let account = (await t.run((ctx) => ctx.db.get(accountId)))!;
    expect(account.handle).toBe("cafelumiar");
    expect(account.name).toBe("cafelumiar");
    expect(account.publisherConnectedAt).toBeDefined();

    // Disconnect clears the connection but keeps the handle for brand context.
    await asMe.mutation(internal.publisherConnect.applyConnection, {
      accountId,
      connected: false,
      username: null,
    });
    account = (await t.run((ctx) => ctx.db.get(accountId)))!;
    expect(account.publisherConnectedAt).toBeUndefined();
    expect(account.handle).toBe("cafelumiar");

    // Ownership is enforced: another user cannot touch my account.
    await expect(
      t.withIdentity({ subject: "other" }).mutation(internal.publisherConnect.applyConnection, {
        accountId,
        connected: true,
        username: "hijack",
      }),
    ).rejects.toThrow();
  });
});

describe("accounts.remove", () => {
  it("removes an owned business and clears its account data", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { mine, theirs, canonId } = await t.run(async (ctx) => {
      const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });
      const other = await ctx.db.insert("users", { name: "O", email: "o@e.com", clerkId: "other" });
      const mine = await ctx.db.insert("accounts", {
        ownerUserId: me,
        handle: "cafelumiar",
        publisherConnectedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const theirs = await ctx.db.insert("accounts", {
        ownerUserId: other,
        createdAt: now,
        updatedAt: now,
      });
      const canonId = await ctx.db.insert("brandCanon", {
        accountId: mine,
        kind: "identity",
        text: "Cafe",
        confirmedByOwner: true,
        createdAt: now,
      });
      return { mine, theirs, canonId };
    });

    const asMe = t.withIdentity({ subject: "me" });
    await expect(asMe.mutation(api.accounts.remove, { accountId: theirs })).rejects.toThrow();

    await asMe.mutation(api.accounts.remove, { accountId: mine });

    expect(await t.run((ctx) => ctx.db.get(mine))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(canonId))).toBeNull();
  });

  it("moves active selection to the oldest remaining onboarded business", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { me, active, fallback } = await t.run(async (ctx) => {
      const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });
      const fallback = await ctx.db.insert("accounts", {
        ownerUserId: me,
        onboardedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const active = await ctx.db.insert("accounts", {
        ownerUserId: me,
        onboardedAt: now + 1,
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      await ctx.db.patch(me, { activeAccountId: active });
      return { me, active, fallback };
    });

    await t.withIdentity({ subject: "me" }).mutation(api.accounts.remove, { accountId: active });
    expect((await t.run((ctx) => ctx.db.get(me)))?.activeAccountId).toBe(fallback);
  });
});
