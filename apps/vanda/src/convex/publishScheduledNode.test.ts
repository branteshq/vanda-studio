// @vitest-environment node
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("runScheduledPost credential phase", () => {
  it("marks the row failed when the account has no connection", async () => {
    const t = convexTest(schema, modules);
    const scheduledPostId = await t.run(async (ctx) => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", {
        mode: "manual",
        createdAt: now,
        updatedAt: now,
      });
      const postId = await ctx.db.insert("posts", {
        accountId,
        type: "feed",
        imageIds: [],
        caption: "x",
        platform: "instagram",
        status: "ready",
        createdAt: now,
      });
      return ctx.db.insert("scheduledPosts", {
        accountId,
        postId,
        scheduledFor: now,
        status: "scheduled",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.action(internal.publishScheduledNode.runScheduledPost, { scheduledPostId });

    const row = await t.run((ctx) => ctx.db.get(scheduledPostId));
    expect(row!.status).toBe("failed");
    expect(row!.lastError).toBe("no_connected_account");
  });
});

describe("getPublishProfile", () => {
  it("resolves the publisher profile for a connected account", async () => {
    const t = convexTest(schema, modules);
    const { scheduledPostId, accountId } = await t.run(async (ctx) => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", {
        handle: "cafelumiar",
        publisherConnectedAt: now,
        mode: "auto",
        createdAt: now,
        updatedAt: now,
      });
      const postId = await ctx.db.insert("posts", {
        accountId,
        type: "feed",
        imageIds: [],
        caption: "x",
        platform: "instagram",
        status: "ready",
        createdAt: now,
      });
      const scheduledPostId = await ctx.db.insert("scheduledPosts", {
        accountId,
        postId,
        scheduledFor: now,
        status: "scheduled",
        createdAt: now,
        updatedAt: now,
      });
      return { scheduledPostId, accountId };
    });

    const profile = await t.query(internal.publishScheduled.getPublishProfile, {
      scheduledPostId,
    });
    // The publisher profile username is the account id by construction.
    expect(profile).toEqual({ username: String(accountId) });
  });

  it("returns null for an account that never connected", async () => {
    const t = convexTest(schema, modules);
    const scheduledPostId = await t.run(async (ctx) => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", {
        mode: "auto",
        createdAt: now,
        updatedAt: now,
      });
      const postId = await ctx.db.insert("posts", {
        accountId,
        type: "feed",
        imageIds: [],
        caption: "x",
        platform: "instagram",
        status: "ready",
        createdAt: now,
      });
      return ctx.db.insert("scheduledPosts", {
        accountId,
        postId,
        scheduledFor: now,
        status: "scheduled",
        createdAt: now,
        updatedAt: now,
      });
    });

    expect(
      await t.query(internal.publishScheduled.getPublishProfile, { scheduledPostId }),
    ).toBeNull();
  });
});
