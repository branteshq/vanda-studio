// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { callParallel, publicWebUrl, webEvidence, webResultSchema } from "./web";
import { makeWebTools } from "./tools/web";
import { capabilityResultSchema } from "./resourceRefs";

const modules = import.meta.glob("./**/*.ts");

const search = {
  operation: "search" as const,
  objective: "Novidades de cafeterias brasileiras",
  searchQueries: ["cafeterias Brasil novidades"],
};

const page = {
  url: "https://example.com/article",
  title: "Café",
  publish_date: "2026-09-24",
  excerpts: ["Trecho relevante"],
};

async function setup(allowance = 1000000) {
  const t = convexTest(schema, modules);

  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Davi",
      email: "d@example.com",
      clerkId: "web-owner",
      usageAllowanceMicroUsd: allowance,
    });

    const otherUserId = await ctx.db.insert("users", {
      name: "Outro",
      email: "o@example.com",
      clerkId: "other-owner",
    });

    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });

    const otherAccountId = await ctx.db.insert("accounts", {
      ownerUserId: otherUserId,
      createdAt: 1,
      updatedAt: 1,
    });

    return { userId, accountId, otherAccountId };
  });

  return {
    t,
    ...ids,
    identity: { accountId: ids.accountId, threadId: "web-thread", requestId: "web-prompt" },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Parallel web tools", () => {
  it("maps filters and freshness to v1, stores full evidence, tracks resources and charges once", async () => {
    const { t, accountId, otherAccountId, identity } = await setup();
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    const longText = "linha de evidência\n".repeat(4500) + "FATO FINAL";

    const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ results: [{ ...page, excerpts: [longText] }] }),
    );

    vi.stubGlobal("fetch", fetcher);

    const tools = makeWebTools(async (_ctx, scoped, input) =>
      t.action(internal.webActions.research, { ...identity, accountId: scoped, input }),
    );

    const tool = Object.assign(tools.web_search, {
      ctx: {
        accountId,
        threadId: identity.threadId,
        messageId: identity.requestId,
        runMutation: t.mutation.bind(t),
      },
    });

    const result = capabilityResultSchema.extend({ data: webResultSchema }).parse(
      await tool.execute!(
        {
          objective: search.objective,
          searchQueries: search.searchQueries,
          domains: ["example.com"],
          afterDate: "2026-09-01",
          fresh: true,
        },
        { toolCallId: "search-1", messages: [] },
      ),
    );

    expect(result.data.results[0]?.excerpt).toHaveLength(1600);
    expect(JSON.stringify(result).length).toBeLessThan(5000);
    expect(result.data.savedTo).toHaveLength(2);
    const request = fetcher.mock.calls[0];
    expect(request).toBeDefined();
    expect(JSON.parse(String(request![1].body))).toMatchObject({
      objective: search.objective,
      search_queries: search.searchQueries,
      advanced_settings: {
        source_policy: { include_domains: ["example.com"], after_date: "2026-09-01" },
        fetch_policy: { max_age_seconds: 600, disable_cache_fallback: true },
      },
    });
    // Inspect the actual fetch invocation without coupling expected fields to our mapper.
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.parallel.ai/v1/search",
      expect.objectContaining({
        redirect: "error",
        headers: { "Content-Type": "application/json", "x-api-key": "test-key" },
        body: expect.stringContaining('"max_results":5'),
      }),
    );
    const saved: string[] = [];

    for (const path of result.data.savedTo) {
      const file = await t.query(internal.workspaceData.read, { accountId, path });

      if (!file.ok || file.file.kind !== "text") throw new Error("missing evidence");
      saved.push(file.file.text);
      expect(
        await t.query(internal.workspaceData.read, { accountId: otherAccountId, path }),
      ).toMatchObject({ ok: false });
      expect(
        await t.mutation(internal.workspaceData.write, { accountId, path, content: "tampered" }),
      ).toMatchObject({ ok: false });
    }

    expect(saved.join("")).toContain(longText);
    expect(saved.join("")).toContain('"afterDate":"2026-09-01"');
    const manifests = await t.run((ctx) => ctx.db.query("threadResourceManifests").collect());
    expect(manifests[0]?.resources).toEqual(result.resources);
    const budget = await t.query(internal.usage.budget, { accountId });
    expect(budget.spentMicroUsd).toBe(5000);
    const requests = await t.run((ctx) => ctx.db.query("webRequests").collect());
    await t.mutation(internal.webData.finish, {
      id: requests[0]!._id,
      billable: true,
      evidence: "duplicate",
    });
    expect((await t.query(internal.usage.budget, { accountId })).spentMicroUsd).toBe(5000);
  });

  it("requests full content by default or explicitly, and excerpts only for focused reads", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));

        return Response.json({
          results: [{ ...page, full_content: "Texto integral com ressalva" }],
          errors: [],
        });
      }),
    );
    await callParallel({ operation: "read", url: page.url }, "test");
    await callParallel(
      { operation: "read", url: page.url, objective: "Preço", fullContent: true, fresh: true },
      "test",
    );
    await callParallel({ operation: "read", url: page.url, objective: "Preço" }, "test");
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      urls: [page.url],
      advanced_settings: { full_content: true },
    });
    expect(JSON.parse(bodies[1]!)).toMatchObject({
      advanced_settings: {
        full_content: true,
        fetch_policy: { max_age_seconds: 600, disable_cache_fallback: true },
      },
    });
    expect(JSON.parse(bodies[2]!)).toMatchObject({ advanced_settings: { full_content: false } });
    expect(
      webEvidence(
        { operation: "read", url: page.url },
        { results: [{ ...page, full_content: "Ressalva omitida do trecho" }] },
        0,
      ),
    ).toContain("Ressalva omitida do trecho");
  });

  it.each([
    "http://127.0.0.1",
    "https://2130706433",
    "https://[::1]",
    "file:///etc/passwd",
    "https://user:secret@example.com",
    "http://metadata.google.internal",
    "http://localhost.",
    "https://example.com:8443",
    "not a url",
  ])("rejects non-public URL %s before spending", async (url) => {
    const { t, identity } = await setup();
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(() => publicWebUrl.safeParse(url)).not.toThrow();
    await expect(
      t.action(internal.webActions.research, { ...identity, input: { operation: "read", url } }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("webRequests").collect())).toEqual([]);
  });

  it("keeps empty search distinct from failed extraction and never returns provider error text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [] })),
    );
    expect(await callParallel(search, "test")).toMatchObject({
      ok: true,
      response: { results: [] },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [],
          errors: [{ url: page.url, error_type: "fetch_error", content: "secret upstream body" }],
        }),
      ),
    );
    expect(await callParallel({ operation: "read", url: page.url }, "test")).toEqual({
      ok: false,
      billable: true,
      code: "UNAVAILABLE",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ results: [page] })),
    );
    expect(
      await callParallel({ operation: "read", url: page.url, fullContent: true }, "test"),
    ).toMatchObject({ ok: false });
  });

  it.each([401, 429, 503])(
    "does not retry or charge HTTP %s and releases the reservation",
    async (status) => {
      const { t, accountId, identity } = await setup(5000);
      vi.stubEnv("PARALLEL_API_KEY", "secret-key");
      const fetcher = vi.fn(async () => new Response("secret-key upstream body", { status }));
      vi.stubGlobal("fetch", fetcher);
      await expect(
        t.action(internal.webActions.research, { ...identity, input: search }),
      ).rejects.toThrow("UNAVAILABLE");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((await t.query(internal.usage.budget, { accountId })).spentMicroUsd).toBe(0);
      await expect(
        t.mutation(internal.webData.begin, { ...identity, operation: "search" }),
      ).resolves.toBeDefined();
    },
  );

  it("fails closed on malformed/oversized successful responses while preserving their cost", async () => {
    const { t, accountId, identity } = await setup();
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json")),
    );
    await expect(
      t.action(internal.webActions.research, { ...identity, input: search }),
    ).rejects.toThrow("UNAVAILABLE");
    expect((await t.query(internal.usage.budget, { accountId })).spentMicroUsd).toBe(5000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(500001))),
    );
    expect(await callParallel(search, "test")).toEqual({
      ok: false,
      billable: true,
      code: "UNAVAILABLE",
    });
  });

  it("reserves concurrent spend, permits the exact balance, and gates connected subscribers too", async () => {
    const { t, userId, identity } = await setup(5000);
    await t.run((ctx) => ctx.db.patch(userId, { openaiAccessCiphertext: "encrypted-test" }));
    expect(await t.query(internal.openaiSub.subscriberState, { userId })).toMatchObject({
      active: true,
    });
    const id = await t.mutation(internal.webData.begin, { ...identity, operation: "search" });
    await expect(
      t.mutation(internal.webData.begin, { ...identity, requestId: "second", operation: "read" }),
    ).rejects.toThrow("USAGE_LIMIT");
    await t.mutation(internal.webData.finish, { id, billable: true });
    await expect(
      t.mutation(internal.webData.begin, { ...identity, requestId: "third", operation: "read" }),
    ).rejects.toThrow("USAGE_LIMIT");
  });

  it("bounds attempts across turns and enforces the per-turn cap", async () => {
    const { t, identity } = await setup();

    for (let i = 0; i < 8; i++) {
      const id = await t.mutation(internal.webData.begin, { ...identity, operation: "read" });
      await t.mutation(internal.webData.finish, { id, billable: false });
    }

    await expect(
      t.mutation(internal.webData.begin, { ...identity, operation: "read" }),
    ).rejects.toThrow("WEB_LIMIT");
    await expect(
      t.mutation(internal.webData.begin, {
        ...identity,
        requestId: "next-turn",
        operation: "read",
      }),
    ).resolves.toBeDefined();
  });

  it("shares the rolling daily limit across the owner's accounts, excluding expired attempts", async () => {
    const { t, userId, identity } = await setup();

    const secondAccountId = await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        createdAt: 1,
        updatedAt: 1,
      });

      for (let index = 0; index < 100; index++) {
        await ctx.db.insert("webRequests", {
          ...identity,
          userId,
          operation: "read",
          status: "finished",
          requestId: `prior-${index}`,
          createdAt: Date.now() - (index === 0 ? 86400001 : 1000),
        });
      }

      return accountId;
    });

    await expect(
      t.mutation(internal.webData.begin, {
        ...identity,
        accountId: secondAccountId,
        operation: "read",
      }),
    ).resolves.toBeDefined();
    await expect(
      t.mutation(internal.webData.begin, {
        ...identity,
        requestId: "over-limit",
        operation: "read",
      }),
    ).rejects.toThrow("WEB_LIMIT");
  });

  it("preserves Unicode at document boundaries and supports paged evidence reads", async () => {
    const { t, accountId, identity } = await setup();
    const id = await t.mutation(internal.webData.begin, { ...identity, operation: "read" });
    const evidence = "x".repeat(59999) + "🎉\nressalva final";
    const paths = await t.mutation(internal.webData.finish, { id, billable: true, evidence });
    const contents: string[] = [];

    for (const path of paths) {
      const result = await t.query(internal.workspaceData.read, { accountId, path });

      if (!result.ok || result.file.kind !== "text") throw new Error("missing evidence");
      expect(new TextDecoder().decode(new TextEncoder().encode(result.file.text))).toBe(
        result.file.text,
      );
      contents.push(result.file.text);
    }

    expect(contents.join("")).toBe(evidence);

    const slice = await t.query(internal.workspaceData.read, {
      accountId,
      path: paths[1]!,
      offset: 2,
      limit: 1,
    });

    expect(slice.ok && slice.file.kind === "text" && slice.file.text).toContain("ressalva final");
  });

  it("charges cancelled work to its original turn but does not retain its evidence", async () => {
    const { t, userId, accountId, otherAccountId, identity } = await setup();

    const activityId = await t.run((ctx) =>
      ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId: "original-thread",
        promptMessageId: "original-prompt",
        startedAt: Date.now(),
      }),
    );

    await expect(
      t.mutation(internal.webData.begin, {
        ...identity,
        accountId: otherAccountId,
        activityId,
        operation: "read",
      }),
    ).rejects.toThrow();

    const id = await t.mutation(internal.webData.begin, {
      ...identity,
      activityId,
      operation: "read",
    });

    await t.run((ctx) => ctx.db.delete(activityId));
    expect(
      await t.mutation(internal.webData.finish, { id, billable: true, evidence: "cancelled" }),
    ).toEqual([]);

    const costs = await t.query(internal.usage.requestCosts, {
      userId,
      requestId: "original-prompt",
    });

    expect(costs.microUsd).toBe(1000);
    expect(costs.events[0]?.threadId).toBe("original-thread");
    expect(await t.run((ctx) => ctx.db.query("workspaceFiles").collect())).toEqual([]);
  });

  it.skipIf(process.env.RUN_WEB_LIVE !== "1")(
    "live Parallel search and extraction through local Convex actions",
    async () => {
      if (!process.env.PARALLEL_API_KEY) throw new Error("PARALLEL_API_KEY required for live test");
      const { t, accountId, identity } = await setup();

      const found = await t.action(internal.webActions.research, {
        ...identity,
        input: {
          operation: "search",
          objective: "Encontre orientações oficiais brasileiras para abrir um MEI",
          searchQueries: ["abrir MEI portal empreendedor"],
          domains: ["gov.br"],
        },
      });

      expect(found.results.length).toBeGreaterThan(0);
      expect(
        found.results.some(
          (result) => new URL(result.url).hostname.endsWith("gov.br") && result.excerpt.length > 0,
        ),
      ).toBe(true);

      const read = await t.action(internal.webActions.research, {
        ...identity,
        input: { operation: "read", url: "https://example.com", fullContent: true },
      });

      expect(read.results[0]?.excerpt).toContain("Example Domain");

      const evidence = await t.query(internal.workspaceData.read, {
        accountId,
        path: read.savedTo[0]!,
      });

      expect(evidence.ok && evidence.file.kind === "text" && evidence.file.text).toContain(
        "Example Domain",
      );
      expect((await t.query(internal.usage.budget, { accountId })).spentMicroUsd).toBe(6000);
    },
    100000,
  );
});
