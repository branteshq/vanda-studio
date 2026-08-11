// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("accounts", {
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const foreignAccountId = await ctx.db.insert("accounts", {
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const faceReferenceId = await ctx.db.insert("images", {
      accountId,
      origin: "uploaded",
      purpose: "reference",
      referenceKind: "face",
      externalUrl: "https://images.example/face.jpg",
      createdAt: Date.now(),
    });
    const postImageId = await ctx.db.insert("images", {
      accountId,
      origin: "generated",
      purpose: "post",
      externalUrl: "https://images.example/post.jpg",
      createdAt: Date.now(),
    });
    const foreignReferenceId = await ctx.db.insert("images", {
      accountId: foreignAccountId,
      origin: "uploaded",
      purpose: "reference",
      referenceKind: "face",
      externalUrl: "https://images.example/foreign.jpg",
      createdAt: Date.now(),
    });
    return { accountId, faceReferenceId, postImageId, foreignReferenceId };
  });
  return { t, ...ids };
};

describe("paint image identity boundary", () => {
  it("allows authorized references and any owned edit source", async () => {
    const { t, accountId, faceReferenceId, postImageId } = await setup();
    const resolved = await t.query(internal.imagesData.resolvePaintInput, {
      accountId,
      referenceImageIds: [faceReferenceId],
      editOfImageId: postImageId,
    });
    expect(resolved.references).toMatchObject([
      { imageId: faceReferenceId, referenceKind: "face" },
    ]);
    expect(resolved.editSource?.imageId).toBe(postImageId);
  });

  it("accepts any owned image as conditioning", async () => {
    const { t, accountId, postImageId } = await setup();
    const resolved = await t.query(internal.imagesData.resolvePaintInput, {
      accountId,
      referenceImageIds: [postImageId],
    });
    expect(resolved.references).toMatchObject([{ imageId: postImageId }]);
  });

  it("rejects foreign reference and edit ids", async () => {
    const { t, accountId, foreignReferenceId } = await setup();
    await expect(
      t.query(internal.imagesData.resolvePaintInput, {
        accountId,
        referenceImageIds: [foreignReferenceId],
      }),
    ).rejects.toThrow("image not found");
    await expect(
      t.query(internal.imagesData.resolvePaintInput, {
        accountId,
        referenceImageIds: [],
        editOfImageId: foreignReferenceId,
      }),
    ).rejects.toThrow("image not found");
  });

  it("records a painted image as a loose post asset", async () => {
    const { t, accountId } = await setup();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["image"])));
    const imageId = await t.mutation(internal.imagesData.savePaintedImage, {
      accountId,
      storageId,
      prompt: "warm breakfast",
      mimeType: "image/jpeg",
      width: 1024,
      height: 1280,
    });
    const image = await t.run((ctx) => ctx.db.get(imageId));
    expect(image).toMatchObject({
      accountId,
      origin: "generated",
      purpose: "post",
      prompt: "warm breakfast",
      description: "warm breakfast",
    });
    expect(image?.contentProjectId).toBeUndefined();
    expect(image?.carouselDocumentId).toBeUndefined();
    expect(image?.slideId).toBeUndefined();
  });
});
