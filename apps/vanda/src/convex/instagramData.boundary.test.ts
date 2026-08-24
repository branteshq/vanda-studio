// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  const accountId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Marina",
      email: "m@example.com",
      clerkId: "clerk-1",
    });
    return ctx.db.insert("accounts", {
      ownerUserId: userId,
      handle: "cafelumiar",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
  return { t, accountId };
};

describe("Instagram observation cache and workspace", () => {
  it("upserts cached reads and projects normalized JSON under /instagram", async () => {
    const { t, accountId } = await setup();
    const observedAt = Date.now();
    await t.mutation(internal.instagramData.saveObservation, {
      accountId,
      requestKey: 'profile:{"scope":"public","handle":"cafeexterno"}',
      operation: "profile",
      target: "public:cafeexterno",
      workspacePath: "/instagram/public/cafeexterno/profile.json",
      source: "apify",
      completeness: "complete",
      payload: { handle: "cafeexterno", followers: 800 },
      observedAt,
      expiresAt: observedAt + 60_000,
    });

    const publicItems = await t.query(internal.instagramData.publicReadItemsSince, {
      accountId,
      since: observedAt - 1,
    });
    expect(publicItems).toBe(1);

    const root = await t.query(internal.workspaceData.list, {
      accountId,
      path: "/instagram",
    });
    expect(root.ok && root.entries.map((entry) => entry.name)).toEqual([
      "self",
      "public",
      "posts",
      "searches",
    ]);

    const file = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/instagram/public/cafeexterno/profile.json",
    });
    expect(file.ok).toBe(true);
    if (!file.ok || file.file.kind !== "text") throw new Error("expected text observation");
    const parsed = JSON.parse(file.file.text) as Record<string, unknown>;
    expect(parsed["source"]).toBe("apify");
    expect(parsed["data"]).toEqual({ handle: "cafeexterno", followers: 800 });
  });

  it("does not serve expired observations as cache hits", async () => {
    const { t, accountId } = await setup();
    await t.mutation(internal.instagramData.saveObservation, {
      accountId,
      requestKey: "posts:self",
      operation: "posts",
      target: "self",
      workspacePath: "/instagram/self/posts.json",
      source: "upload_post",
      completeness: "partial",
      payload: [],
      observedAt: 100,
      expiresAt: 200,
    });

    const cached = await t.query(internal.instagramData.readCachedObservation, {
      accountId,
      requestKey: "posts:self",
      now: 201,
    });
    expect(cached).toBeNull();
  });
});
