// @vitest-environment edge-runtime
import { createThread, listUIMessages } from "@convex-dev/agent";
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("publication thread follow-up", () => {
  it("posts the final receipt to Vanda and Caetano with rendered resources", async () => {
    const t = convexTest(schema, modules);
    agentComponent.register(t);
    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        clerkId: "owner",
        name: "Dono",
        email: "dono@example.com",
        createdAt: now,
        updatedAt: now,
      });
      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        createdAt: now,
        updatedAt: now,
      });
      const imageId = await ctx.db.insert("images", {
        accountId,
        origin: "generated",
        purpose: "post",
        createdAt: now,
      });
      const originThreadId = await createThread(ctx, components.agent, {
        userId: String(accountId),
      });
      const caetanoThreadId = await createThread(ctx, components.agent, {
        userId: `caetano:${userId}`,
      });
      const postId = await ctx.db.insert("posts", {
        accountId,
        originThreadId,
        caetanoThreadId,
        type: "image",
        imageIds: [imageId],
        caption: "Legenda",
        platform: "instagram",
        status: "published",
        createdAt: now,
      });
      const scheduledPostId = await ctx.db.insert("scheduledPosts", {
        accountId,
        postId,
        scheduledFor: now,
        status: "published",
        permalink: "https://instagram.com/p/result",
        createdAt: now,
        updatedAt: now,
      });
      return { accountId, postId, scheduledPostId, originThreadId, caetanoThreadId };
    });

    await t.mutation(internal.threadResources.postPublicationFollowup, {
      scheduledPostId: setup.scheduledPostId,
    });

    const manifests = await t.run((ctx) => ctx.db.query("threadResourceManifests").collect());
    expect(manifests).toHaveLength(2);
    for (const manifest of manifests) {
      expect(manifest.presented).toEqual(
        expect.arrayContaining([
          { kind: "post", accountId: setup.accountId, postId: setup.postId },
          expect.objectContaining({
            kind: "operation",
            operation: "post.publish",
            status: "succeeded",
          }),
          {
            kind: "link",
            url: "https://instagram.com/p/result",
            title: "Ver no Instagram",
          },
        ]),
      );
    }

    for (const threadId of [setup.originThreadId, setup.caetanoThreadId]) {
      const messages = await t.run((ctx) =>
        listUIMessages(ctx, components.agent, {
          threadId,
          paginationOpts: { cursor: null, numItems: 10 },
        }),
      );
      expect(messages.page.at(-1)?.text).toContain("já está no Instagram");
    }
  });
});
