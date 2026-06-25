// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("create — compose + promote through the ctx-backed store", () => {
  it("composes a post from generated media and promotes the suggestion", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    const accountId = await t.run((ctx) =>
      ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("beliefs", {
        accountId,
        statement: "the resident golden retriever delights customers",
        kind: "audience",
        confidence: 0.8,
        supportingSignalIds: ["s1"],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "active",
      });
      await ctx.db.insert("beliefs", {
        accountId,
        statement: "retired lore nobody should retrieve",
        kind: "trend",
        confidence: 0.1,
        supportingSignalIds: [],
        firstSeenAt: now,
        confidenceAsOf: now,
        status: "retired",
      });
      await ctx.db.insert("themes", {
        accountId,
        name: "Dog content",
        summary: "the cafe's pet-friendly charm",
        momentum: "rising",
        postCount: 0,
        signalCount: 3,
      });
    });

    const suggestionId = await t.run((ctx) =>
      ctx.db.insert("suggestions", {
        accountId,
        title: "Golden retriever Monday",
        rationale: "dogs are trending",
        format: "feed",
        themeName: "Dog content",
        beliefStatements: ["the resident golden retriever delights customers"],
        signalIds: ["s1"],
        status: "approved",
        requiresApproval: false,
        createdAt: now,
      }),
    );

    // The read create needs to compose.
    const creatable = await t.query(internal.create.loadCreatableSuggestion, { suggestionId });
    expect(creatable.title).toBe("Golden retriever Monday");
    expect(creatable.format).toBe("feed");
    expect(creatable.beliefStatements).toEqual([
      "the resident golden retriever delights customers",
    ]);

    // The RAG corpus excludes retired beliefs and renders themes as voice.
    const corpus = await t.query(internal.create.brandCorpus, { accountId });
    expect(corpus.statements).toEqual(["the resident golden retriever delights customers"]);
    expect(corpus.themeSummary).toContain("Dog content");

    // Claim then compose: the claim promotes (approved → creating); compose
    // writes two image units + the ordered post.
    expect(await t.mutation(internal.create.claimForCreate, { suggestionId })).toBe(true);
    const composed = await t.mutation(internal.create.composePost, {
      accountId,
      suggestionId,
      type: "feed",
      caption: "Come meet our golden 🐕",
      images: [
        { prompt: "golden by the bar", width: 1024, height: 1024, externalUrl: "mock://a" },
        { prompt: "latte art", width: 1024, height: 1024, externalUrl: "mock://b" },
      ],
    });
    expect(composed.imageIds).toHaveLength(2);
    expect(composed.type).toBe("feed");

    const post = await t.run((ctx) => ctx.db.get(composed.postId as Id<"posts">));
    expect(post!.status).toBe("ready");
    expect(post!.platform).toBe("instagram");
    expect(post!.suggestionId).toBe(suggestionId);
    expect(post!.imageIds).toEqual(composed.imageIds);

    const images = await t.run((ctx) =>
      ctx.db
        .query("images")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect(),
    );
    expect(images).toHaveLength(2);
    expect(images.every((image) => image.origin === "generated")).toBe(true);

    const suggestion = await t.run((ctx) => ctx.db.get(suggestionId));
    expect(suggestion!.status).toBe("creating");
  });

  it("claims only an approved suggestion and releases a failed claim", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const accountId = await t.run((ctx) =>
      ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now }),
    );
    const approvedId = await t.run((ctx) =>
      ctx.db.insert("suggestions", {
        accountId,
        title: "t",
        rationale: "r",
        themeName: "Dogs",
        beliefStatements: [],
        signalIds: [],
        status: "approved",
        requiresApproval: false,
        createdAt: now,
      }),
    );

    // Claim wins once on an approved suggestion, then loses (already creating).
    expect(await t.mutation(internal.create.claimForCreate, { suggestionId: approvedId })).toBe(
      true,
    );
    expect(await t.mutation(internal.create.claimForCreate, { suggestionId: approvedId })).toBe(
      false,
    );
    expect((await t.run((ctx) => ctx.db.get(approvedId)))!.status).toBe("creating");

    // Release reverts a claimed suggestion; on a non-creating one it is a no-op.
    await t.mutation(internal.create.releaseCreate, { suggestionId: approvedId });
    expect((await t.run((ctx) => ctx.db.get(approvedId)))!.status).toBe("approved");
    await t.mutation(internal.create.releaseCreate, { suggestionId: approvedId });
    expect((await t.run((ctx) => ctx.db.get(approvedId)))!.status).toBe("approved");
  });

  it("refuses to compose an idea steered out of creating mid-flight", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const accountId = await t.run((ctx) =>
      ctx.db.insert("accounts", { mode: "auto", createdAt: now, updatedAt: now }),
    );
    // The owner paused it (needs_you) while the create was already running.
    const suggestionId = await t.run((ctx) =>
      ctx.db.insert("suggestions", {
        accountId,
        title: "t",
        rationale: "r",
        themeName: "Dogs",
        beliefStatements: [],
        signalIds: [],
        status: "needs_you",
        requiresApproval: true,
        createdAt: now,
      }),
    );

    await expect(
      t.mutation(internal.create.composePost, {
        accountId,
        suggestionId,
        type: "feed",
        caption: "x",
        images: [{ prompt: "p", width: 1024, height: 1024, externalUrl: "mock://a" }],
      }),
    ).rejects.toThrow();
    const posts = await t.run((ctx) =>
      ctx.db
        .query("posts")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect(),
    );
    expect(posts).toHaveLength(0);
  });
});
