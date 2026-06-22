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

describe("getPublishConnection", () => {
  it("resolves the connection id + token for a linked account", async () => {
    const t = convexTest(schema, modules);
    const scheduledPostId = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { name: "U", email: "u@e.com", clerkId: "c1" });
      const connectionId = await ctx.db.insert("instagramConnections", {
        userId,
        provider: "instagram_graph",
        status: "connected",
        externalAccountId: "ig_123",
        tokenCiphertext: "ct",
        tokenIv: "iv",
        tokenAuthTag: "tag",
        lastConnectedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const accountId = await ctx.db.insert("accounts", {
        connectionId,
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

    const connection = await t.query(internal.publishScheduled.getPublishConnection, {
      scheduledPostId,
    });
    expect(connection).toMatchObject({
      igUserId: "ig_123",
      tokenCiphertext: "ct",
      tokenIv: "iv",
      tokenAuthTag: "tag",
    });
  });
});
