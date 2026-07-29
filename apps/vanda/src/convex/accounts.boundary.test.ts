// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("accounts.listMine — the owner's businesses", () => {
  it("returns only my accounts, names defaulted from the IG connection", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { withName, override } = await t.run(async (ctx) => {
      const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });
      const other = await ctx.db.insert("users", { name: "O", email: "o@e.com", clerkId: "other" });
      const conn = await ctx.db.insert("instagramConnections", {
        userId: me,
        provider: "instagram_graph",
        status: "connected",
        externalAccountId: "ig1",
        externalAccountName: "Café Lumiar",
        handle: "cafelumiar",
        lastConnectedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const withName = await ctx.db.insert("accounts", {
        ownerUserId: me,
        connectionId: conn,
        mode: "auto",
        createdAt: now,
        updatedAt: now,
      });
      const override = await ctx.db.insert("accounts", {
        ownerUserId: me,
        name: "Segundo Negócio",
        mode: "needs_approval",
        createdAt: now,
        updatedAt: now,
      });
      // Another owner's account must never surface in my switcher.
      await ctx.db.insert("accounts", {
        ownerUserId: other,
        mode: "auto",
        createdAt: now,
        updatedAt: now,
      });
      return { withName, override };
    });

    const rows = await t.withIdentity({ subject: "me" }).query(api.accounts.listMine, {});
    expect(rows).toHaveLength(2);
    const find = (id: string) => rows.find((r) => r.id === id)!;
    expect(find(withName).name).toBe("Café Lumiar"); // defaults from the connection
    expect(find(withName).connected).toBe(true);
    expect(find(override).name).toBe("Segundo Negócio"); // explicit override wins
    expect(find(override).connected).toBe(false);
  });

  it("returns [] when signed out", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.accounts.listMine, {})).toEqual([]);
  });
});

describe("accounts.setMode", () => {
  it("updates a mode the caller owns and rejects another owner's account", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { mine, theirs } = await t.run(async (ctx) => {
      const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });
      const other = await ctx.db.insert("users", { name: "O", email: "o@e.com", clerkId: "other" });
      const mine = await ctx.db.insert("accounts", {
        ownerUserId: me,
        mode: "auto",
        createdAt: now,
        updatedAt: now,
      });
      const theirs = await ctx.db.insert("accounts", {
        ownerUserId: other,
        mode: "auto",
        createdAt: now,
        updatedAt: now,
      });
      return { mine, theirs };
    });

    const asMe = t.withIdentity({ subject: "me" });
    await asMe.mutation(api.accounts.setMode, { accountId: mine, mode: "manual" });
    expect((await t.run((ctx) => ctx.db.get(mine)))!.mode).toBe("manual");

    await expect(
      asMe.mutation(api.accounts.setMode, { accountId: theirs, mode: "manual" }),
    ).rejects.toThrow();
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
        mode: "auto",
        onboardedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const pending = await ctx.db.insert("accounts", {
        ownerUserId: me,
        mode: "auto",
        createdAt: now + 1,
        updatedAt: now + 1,
      });
      const theirs = await ctx.db.insert("accounts", {
        ownerUserId: other,
        mode: "auto",
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

describe("instagramGraph.upsertConnectionInternal", () => {
  it("refreshes the owner's connection but rejects cross-user takeover", async () => {
    const t = convexTest(schema, modules);
    const args = {
      externalAccountId: "ig-shared",
      tokenCiphertext: "cipher",
      tokenIv: "iv",
      tokenAuthTag: "tag",
    };
    const first = await t.mutation(internal.instagramGraph.upsertConnectionInternal, {
      clerkId: "me",
      ...args,
    });
    const refreshed = await t.mutation(internal.instagramGraph.upsertConnectionInternal, {
      clerkId: "me",
      ...args,
      handle: "mine",
    });
    expect(refreshed._id).toBe(first._id);
    await expect(
      t.mutation(internal.instagramGraph.upsertConnectionInternal, {
        clerkId: "other",
        ...args,
      }),
    ).rejects.toThrow("already connected");
  });
});

describe("accounts.remove", () => {
  it("removes an owned business, clears account data, and expires its connection", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { mine, theirs, connectionId, canonId } = await t.run(async (ctx) => {
      const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });
      const other = await ctx.db.insert("users", { name: "O", email: "o@e.com", clerkId: "other" });
      const connectionId = await ctx.db.insert("instagramConnections", {
        userId: me,
        provider: "instagram_graph",
        status: "connected",
        externalAccountId: "ig1",
        externalAccountName: "Café Lumiar",
        handle: "cafelumiar",
        scopes: ["instagram_business_basic"],
        tokenCiphertext: "cipher",
        tokenIv: "iv",
        tokenAuthTag: "tag",
        lastConnectedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const mine = await ctx.db.insert("accounts", {
        ownerUserId: me,
        connectionId,
        mode: "auto",
        createdAt: now,
        updatedAt: now,
      });
      const theirs = await ctx.db.insert("accounts", {
        ownerUserId: other,
        mode: "auto",
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
      return { mine, theirs, connectionId, canonId };
    });

    const asMe = t.withIdentity({ subject: "me" });
    await expect(asMe.mutation(api.accounts.remove, { accountId: theirs })).rejects.toThrow();

    await asMe.mutation(api.accounts.remove, { accountId: mine });

    expect(await t.run((ctx) => ctx.db.get(mine))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(canonId))).toBeNull();

    const connection = await t.run((ctx) => ctx.db.get(connectionId));
    expect(connection?.status).toBe("expired");
    expect(connection).not.toHaveProperty("tokenCiphertext");
    expect(connection).not.toHaveProperty("tokenIv");
    expect(connection).not.toHaveProperty("tokenAuthTag");
  });

  it("moves active selection to the oldest remaining onboarded business", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const { me, active, fallback } = await t.run(async (ctx) => {
      const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });
      const fallback = await ctx.db.insert("accounts", {
        ownerUserId: me,
        mode: "auto",
        onboardedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const active = await ctx.db.insert("accounts", {
        ownerUserId: me,
        mode: "auto",
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
