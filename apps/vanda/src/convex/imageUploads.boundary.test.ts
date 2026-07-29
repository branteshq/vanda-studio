// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      name: "Owner",
      email: "owner@example.com",
      clerkId: "owner",
    });
    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: ownerId,
      mode: "manual",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const storageId = await ctx.storage.store(new Blob(["image"]));
    return { accountId, storageId };
  });
  return { t, ...ids };
};

describe("composer image uploads", () => {
  it("links an owned image as a loose post asset", async () => {
    const { t, accountId, storageId } = await setup();
    const result = await t.withIdentity({ subject: "owner" }).mutation(api.imageUploads.addImage, {
      accountId,
      storageId,
      mimeType: "image/png",
      width: 800,
      height: 600,
    });
    const image = await t.run((ctx) => ctx.db.get(result.imageId));
    expect(result.url).toContain("http");
    expect(image).toMatchObject({
      accountId,
      origin: "uploaded",
      purpose: "post",
      mimeType: "image/png",
      width: 800,
      height: 600,
    });
    expect(image?.contentProjectId).toBeUndefined();
  });

  it("rejects non-image uploads and non-owners", async () => {
    const { t, accountId, storageId } = await setup();
    await expect(
      t.withIdentity({ subject: "owner" }).mutation(api.imageUploads.addImage, {
        accountId,
        storageId,
        mimeType: "application/pdf",
      }),
    ).rejects.toThrow("only image attachments");
    await expect(
      t.withIdentity({ subject: "other" }).mutation(api.imageUploads.addImage, {
        accountId,
        storageId,
        mimeType: "image/png",
      }),
    ).rejects.toThrow();
  });

  it("sends an account image through the real chat mutation", async () => {
    const { t, accountId, storageId } = await setup();
    const owner = t.withIdentity({ subject: "owner" });
    const uploaded = await owner.mutation(api.imageUploads.addImage, {
      accountId,
      storageId,
      mimeType: "image/png",
      width: 3840,
      height: 2160,
    });

    const sent = await owner.mutation(api.chat.sendMessage, {
      accountId,
      prompt: "o que você vê nessa imagem?",
      imageIds: [uploaded.imageId],
    });

    expect(sent.threadId).toBeTruthy();
    expect(sent.messageId).toBeTruthy();
    const image = await t.run((ctx) => ctx.db.get(uploaded.imageId));
    expect(image?.lastAttachedAt).toEqual(expect.any(Number));
  });

  it("removes an unsent upload but protects an attached image", async () => {
    const { t, accountId, storageId } = await setup();
    const owner = t.withIdentity({ subject: "owner" });
    const first = await owner.mutation(api.imageUploads.addImage, {
      accountId,
      storageId,
      mimeType: "image/jpeg",
    });
    await owner.mutation(api.imageUploads.removeImage, { accountId, imageId: first.imageId });
    expect(await t.run((ctx) => ctx.db.get(first.imageId))).toBeNull();

    const secondStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["image-2"])));
    const second = await owner.mutation(api.imageUploads.addImage, {
      accountId,
      storageId: secondStorageId,
      mimeType: "image/jpeg",
    });
    await t.run((ctx) => ctx.db.patch(second.imageId, { lastAttachedAt: Date.now() }));
    await expect(
      owner.mutation(api.imageUploads.removeImage, { accountId, imageId: second.imageId }),
    ).rejects.toThrow("image not found");
  });
});
