// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("migrations.runAll", () => {
  it("rewrites legacy feed posts once per deployment and is idempotent", async () => {
    const t = convexTest(schema, modules);

    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });

      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        handle: "cafe",
        createdAt: 1,
        updatedAt: 1,
      });

      const imageId = await ctx.db.insert("images", {
        accountId,
        purpose: "post",
        origin: "generated",
        externalUrl: "https://img/1.jpg",
        createdAt: 1,
      });

      const post = (type: "feed" | "story", imageIds: (typeof imageId)[]) =>
        ctx.db.insert("posts", {
          accountId,
          type,
          imageIds,
          caption: "x",
          platform: "instagram",
          status: "draft",
          createdAt: 1,
        });

      return {
        single: await post("feed", [imageId]),
        multi: await post("feed", [imageId, imageId]),
        story: await post("story", [imageId]),
      };
    });

    const types = () =>
      t.run(async (ctx) => ({
        single: (await ctx.db.get(ids.single))?.type,
        multi: (await ctx.db.get(ids.multi))?.type,
        story: (await ctx.db.get(ids.story))?.type,
      }));

    expect(await t.action(internal.migrations.runAll, {})).toEqual({
      // The one account also gets its brand file.
      ran: { feedToCarousel: 2, brandFiles: 1 },
      skipped: [],
    });
    expect(await types()).toEqual({ single: "image", multi: "carousel", story: "story" });

    // Every later deploy finds it done and skips it.
    expect(await t.action(internal.migrations.runAll, {})).toEqual({
      ran: {},
      skipped: ["feedToCarousel", "brandFiles"],
    });

    // A page re-run (a crash mid-migration) changes nothing.
    expect(await t.mutation(internal.migrations.feedToCarousel, { cursor: null })).toEqual({
      migrated: 0,
      cursor: null,
    });
  });
});
