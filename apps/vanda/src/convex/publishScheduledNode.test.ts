// @vitest-environment node
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("runScheduledPost credential phase", () => {
  it("marks the row failed when the account has no connection", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);

    const scheduledPostId = await t.run(async (ctx) => {
      const now = Date.now();

      const accountId = await ctx.db.insert("accounts", {
        createdAt: now,
        updatedAt: now,
      });

      const postId = await ctx.db.insert("posts", {
        accountId,
        type: "carousel",
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
    rateLimiterTest.register(t);

    const { scheduledPostId, accountId } = await t.run(async (ctx) => {
      const now = Date.now();

      const accountId = await ctx.db.insert("accounts", {
        handle: "cafelumiar",
        publisherConnectedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const postId = await ctx.db.insert("posts", {
        accountId,
        type: "carousel",
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
    rateLimiterTest.register(t);

    const scheduledPostId = await t.run(async (ctx) => {
      const now = Date.now();

      const accountId = await ctx.db.insert("accounts", {
        createdAt: now,
        updatedAt: now,
      });

      const postId = await ctx.db.insert("posts", {
        accountId,
        type: "carousel",
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

describe("runScheduledPost publish gate", () => {
  const seed = (t: ReturnType<typeof convexTest>, publishRestrictedUntil?: number) =>
    t.run(async (ctx) => {
      const now = Date.now();

      const accountId = await ctx.db.insert("accounts", {
        publisherConnectedAt: now,
        ...(publishRestrictedUntil !== undefined && { publishRestrictedUntil }),
        createdAt: now,
        updatedAt: now,
      });

      const postId = await ctx.db.insert("posts", {
        accountId,
        type: "image",
        imageIds: [],
        caption: "x",
        platform: "instagram",
        status: "scheduled",
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

      return { accountId, scheduledPostId, scheduledFor: now };
    });

  it("ignores a job armed for a time the post was re-aimed away from", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const { scheduledPostId, scheduledFor } = await seed(t);

    await t.action(internal.publishScheduledNode.runScheduledPost, {
      scheduledPostId,
      scheduledFor: scheduledFor - 60_000,
    });

    expect((await t.run((ctx) => ctx.db.get(scheduledPostId)))!.status).toBe("scheduled");
  });

  it("fails without calling the publisher while the account is restricted", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const { scheduledPostId, scheduledFor } = await seed(t, Date.now() + 3_600_000);

    await t.action(internal.publishScheduledNode.runScheduledPost, {
      scheduledPostId,
      scheduledFor,
    });

    const row = (await t.run((ctx) => ctx.db.get(scheduledPostId)))!;
    expect(row.status).toBe("failed");
    expect(row.lastError).toMatch(/^InstagramRestricted: .*restringiu/);
  });

  it("remembers a spam block reported by the publisher", async () => {
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const { accountId, scheduledPostId } = await seed(t);
    const before = Date.now();

    await t.mutation(internal.publishScheduled.setScheduledStatus, {
      scheduledPostId,
      status: "failed",
      lastError:
        "PublisherRequestFailed: Action suspected as spam. Activity is restricted. If this is a mistake, please review your account.",
    });

    const account = (await t.run((ctx) => ctx.db.get(accountId)))!;
    expect(account.publishRestrictedUntil).toBeGreaterThanOrEqual(before + 24 * 3_600_000);
  });
});
