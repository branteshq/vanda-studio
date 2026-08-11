// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { accountId, imageId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });
    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      handle: "cafelumiar",
      publisherConnectedAt: now,
      mode: "needs_approval",
      onboardedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const imageId = await ctx.db.insert("images", {
      accountId,
      name: "foto",
      purpose: "post",
      origin: "generated",
      externalUrl: "https://img/1.jpg",
      createdAt: now,
    });
    return { accountId, imageId };
  });
  return { t, accountId, imageId };
};

describe("posts.createPostInternal — the light post path", () => {
  it("creates a draft from owned images and rejects foreign or empty input", async () => {
    const { t, accountId, imageId } = await setup();

    const postId = await t.mutation(internal.posts.createPostInternal, {
      accountId,
      imageIds: [imageId],
      caption: "bom dia ☕",
    });
    const post = (await t.run((ctx) => ctx.db.get(postId)))!;
    expect(post).toMatchObject({ status: "draft", type: "image", platform: "instagram" });

    await expect(
      t.mutation(internal.posts.createPostInternal, { accountId, imageIds: [], caption: "x" }),
    ).rejects.toThrow();
    await expect(
      t.mutation(internal.posts.createPostInternal, {
        accountId,
        imageIds: [imageId],
        caption: "",
      }),
    ).rejects.toThrow();

    // An image belonging to another account is rejected.
    const foreign = await t.run(async (ctx) => {
      const otherAccount = await ctx.db.insert("accounts", {
        mode: "auto",
        createdAt: 1,
        updatedAt: 1,
      });
      return ctx.db.insert("images", {
        accountId: otherAccount,
        name: "alheia",
        purpose: "post",
        origin: "generated",
        externalUrl: "https://img/2.jpg",
        createdAt: 1,
      });
    });
    await expect(
      t.mutation(internal.posts.createPostInternal, {
        accountId,
        imageIds: [foreign],
        caption: "x",
      }),
    ).rejects.toThrow("não encontrada");
  });
});

describe("posts.schedulePostInternal — the approved commit", () => {
  it("arms the scheduler, flips the post, and refuses a double schedule", async () => {
    const { t, accountId, imageId } = await setup();
    const postId = await t.mutation(internal.posts.createPostInternal, {
      accountId,
      imageIds: [imageId],
      caption: "bom dia",
    });

    const scheduledFor = Date.now() + 60_000;
    const result = await t.mutation(internal.posts.schedulePostInternal, {
      accountId,
      postId,
      scheduledFor,
    });
    expect(result.scheduledFor).toBe(scheduledFor);

    const post = (await t.run((ctx) => ctx.db.get(postId)))!;
    expect(post.status).toBe("scheduled");
    const scheduled = (await t.run((ctx) => ctx.db.get(result.scheduledPostId)))!;
    expect(scheduled).toMatchObject({ postId, accountId, status: "scheduled", scheduledFor });

    await expect(
      t.mutation(internal.posts.schedulePostInternal, { accountId, postId }),
    ).rejects.toThrow();
  });
});

describe("posts.listForRail", () => {
  it("returns the merged lifecycle state, scoped to the owner", async () => {
    const { t, accountId, imageId } = await setup();
    const postId = await t.mutation(internal.posts.createPostInternal, {
      accountId,
      imageIds: [imageId],
      caption: "bom dia",
    });
    await t.mutation(internal.posts.schedulePostInternal, {
      accountId,
      postId,
      scheduledFor: Date.now() + 60_000,
    });

    const rows = await t
      .withIdentity({ subject: "me" })
      .query(api.posts.listForRail, { accountId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      postId,
      status: "scheduled",
      slideCount: 1,
      thumbnailUrl: "https://img/1.jpg",
    });

    await expect(
      t.withIdentity({ subject: "other" }).query(api.posts.listForRail, { accountId }),
    ).rejects.toThrow();
  });
});
