// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { publishStoreLive } from "./pipeline/livePublish";
import { publishDue } from "./pipeline/publish";
import { makeFakePublisher } from "./pipeline/publish.testing";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("schedulePost + calendar", () => {
  it("pins a post to a datetime and lists it within a calendar range", async () => {
    const t = convexTest(schema, modules);
    const { accountId, postId } = await t.run(async (ctx) => {
      const now = Date.now();
      const account = await ctx.db.insert("accounts", {
        mode: "manual",
        createdAt: now,
        updatedAt: now,
      });
      const post = await ctx.db.insert("posts", {
        accountId: account,
        type: "feed",
        imageIds: [],
        caption: "hello",
        platform: "instagram",
        status: "ready",
        createdAt: now,
      });
      return { accountId: account, postId: post };
    });

    const at = Date.now() + 86_400_000;
    const scheduledPostId = await t.mutation(internal.publishScheduled.schedulePost, {
      postId,
      scheduledFor: at,
    });

    const inRange = await t.query(internal.publishScheduled.listScheduledBetween, {
      accountId,
      from: at - 1000,
      to: at + 1000,
    });
    expect(inRange).toHaveLength(1);
    expect(inRange[0]!._id).toBe(scheduledPostId);
    expect(inRange[0]!.status).toBe("scheduled");

    const outOfRange = await t.query(internal.publishScheduled.listScheduledBetween, {
      accountId,
      from: 0,
      to: 1000,
    });
    expect(outOfRange).toHaveLength(0);
  });
});

describe("publishDue through the ctx-backed store + fake publisher", () => {
  it("publishes a carousel and records the external id on the row", async () => {
    const t = convexTest(schema, modules);
    const scheduledPostId = await t.run(async (ctx) => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", {
        mode: "manual",
        createdAt: now,
        updatedAt: now,
      });
      const imageIds = [
        await ctx.db.insert("images", {
          accountId,
          origin: "uploaded",
          externalUrl: "https://img/1.jpg",
          createdAt: now,
        }),
        await ctx.db.insert("images", {
          accountId,
          origin: "uploaded",
          externalUrl: "https://img/2.jpg",
          createdAt: now,
        }),
      ];
      const postId = await ctx.db.insert("posts", {
        accountId,
        type: "feed",
        imageIds,
        caption: "winter combo",
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

    const fake = makeFakePublisher();
    const media = await t.action(async (ctx) =>
      Effect.runPromise(
        publishDue(scheduledPostId).pipe(
          Effect.provide(Layer.mergeAll(publishStoreLive(ctx), fake.layer)),
        ),
      ),
    );

    expect(media).toMatch(/^media_/);
    expect(fake.created.filter((s) => s.kind === "image")).toHaveLength(2);
    expect(fake.published).toHaveLength(1);

    const row = await t.run((ctx) => ctx.db.get(scheduledPostId));
    expect(row!.status).toBe("published");
    expect(row!.externalPostId).toBe(media);
  });
});
