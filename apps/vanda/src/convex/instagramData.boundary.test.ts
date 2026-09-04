// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { apifyInstagramCostUsd } from "./instagram/costs";
import { makeInstagramTools } from "./tools/instagram";
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
      itemCount: 2,
      costUsd: apifyInstagramCostUsd(2),
      observedAt,
      expiresAt: observedAt + 60_000,
    });

    const publicItems = await t.query(internal.instagramData.publicReadItemsSince, {
      accountId,
      since: observedAt - 1,
    });
    expect(publicItems).toBe(2);
    const budget = await t.query(internal.usage.budget, { accountId });
    expect(budget.spentMicroUsd).toBe(5_400);

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
    expect(parsed["costUsd"]).toBe(0.0054);
    expect(parsed["data"]).toEqual({ handle: "cafeexterno", followers: 800 });
  });

  it("returns compact tool results while retaining full cached and workspace data", async () => {
    const { t, accountId } = await setup();
    const now = Date.now();
    const path = "/instagram/searches/cafe.json";
    const payload = [
      {
        handle: "cafeexterno",
        followers: 800,
        latestPosts: [{ id: "post-1", caption: "a".repeat(100_000) }],
      },
    ];
    await t.mutation(internal.instagramData.saveObservation, {
      accountId,
      requestKey: "search:test",
      operation: "search_profiles",
      target: "search:cafe",
      workspacePath: path,
      source: "apify",
      completeness: "complete",
      payload,
      itemCount: 1,
      observedAt: now,
      expiresAt: now + 60_000,
    });
    const cached = await t.query(internal.instagramData.readCachedObservation, {
      accountId,
      requestKey: "search:test",
      now,
    });
    if (!cached) throw new Error("expected cached observation");
    const run = async () => ({
      data: cached.payload,
      savedTo: cached.workspacePath,
      cached: true,
      source: cached.source,
      completeness: cached.completeness,
      observedAt: cached.observedAt,
    });
    const tools = makeInstagramTools({
      searchProfiles: run,
      readProfile: run,
      listPosts: run,
      readPost: run,
      listComments: run,
      readMetrics: run,
    });
    const tool = Object.assign(tools.search_instagram_profiles, {
      ctx: { accountId, threadId: "thread", messageId: "prompt", runMutation: t.mutation.bind(t) },
    });
    const result = await tool.execute!({ query: "cafe" }, { toolCallId: "search-1", messages: [] });
    expect(JSON.stringify(result).length).toBeLessThan(2_000);
    expect(result).toMatchObject({
      data: {
        data: [{ handle: "cafeexterno", followers: 800, latestPostsCount: 1 }],
        savedTo: path,
        cached: true,
      },
      resources: [{ kind: "document", accountId, path }],
    });
    const manifests = await t.run((ctx) => ctx.db.query("threadResourceManifests").collect());
    expect(manifests[0]?.resources).toEqual([{ kind: "document", accountId, path }]);
    const file = await t.query(internal.workspaceData.read, { accountId, path });
    if (!file.ok || file.file.kind !== "text") throw new Error("expected workspace observation");
    expect(JSON.parse(file.file.text).data).toEqual(payload);
    expect(cached.payload).toEqual(payload);
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
    const budget = await t.query(internal.usage.budget, { accountId });
    expect(budget.spentMicroUsd).toBe(0);
  });
});
