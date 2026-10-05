// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { PostPurpose } from "./postPurposes";

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
  it("enforces type and format, stores the justification and keeps stories unscheduled", async () => {
    const { t, accountId, imageId } = await setup();

    const sized = (width: number, height: number) =>
      t.run((ctx) =>
        ctx.db.insert("images", {
          accountId,
          origin: "generated",
          purpose: "post",
          externalUrl: `https://example.com/${width}x${height}.jpg`,
          width,
          height,
          createdAt: 1,
        }),
      );

    const verticalId = await sized(1080, 1920);
    const portraitId = await sized(1080, 1350);
    const squareId = await sized(1080, 1080);

    const rationale =
      "  image porque é uma novidade curta; anuncio porque há data; 4:5 porque ocupa mais tela.  ";

    const create = (
      type: "image" | "carousel" | "story",
      format: "1:1" | "4:5" | "3:4" | "4:3" | "9:16",
      imageIds: (typeof imageId)[],
      extra: { rationale?: string; purpose?: PostPurpose } = { purpose: "anuncio", rationale },
    ) =>
      t.mutation(internal.posts.createPostInternal, {
        accountId,
        imageIds,
        caption: "Abrimos às 7h",
        type,
        format,
        ...extra,
      });

    const postId = await create("image", "4:5", [portraitId]);
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({
      type: "image",
      format: "4:5",
      purpose: "anuncio",
      rationale: rationale.trim(),
    });

    // Unknown dimensions are trusted; known ones must match the declared format.
    await create("image", "1:1", [imageId]);
    await expect(create("image", "4:5", [squareId])).rejects.toThrow("1080×1080, não 4:5");
    await expect(create("carousel", "4:5", [portraitId, squareId])).rejects.toThrow("mesmo format");

    // A ready camera photo keeps its feed-valid ratio even off the format list.
    const photo = (width: number, height: number) =>
      t.run((ctx) =>
        ctx.db.insert("images", {
          accountId,
          origin: "uploaded",
          purpose: "post",
          externalUrl: `https://example.com/photo-${width}x${height}.jpg`,
          width,
          height,
          createdAt: 1,
        }),
      );

    const cameraId = await photo(6000, 4000);
    await create("image", "4:3", [cameraId]);
    await create("carousel", "4:3", [cameraId, cameraId]);
    await expect(create("carousel", "4:3", [cameraId, await photo(5000, 4000)])).rejects.toThrow(
      "6000×4000",
    );
    // Outside the feed range (or painted art) the declared format still rules.
    await expect(create("image", "4:5", [await photo(1000, 3000)])).rejects.toThrow("não 4:5");
    await expect(create("image", "4:3", [await sized(6000, 4000)])).rejects.toThrow("não 4:3");
    const carouselId = await create("carousel", "4:5", [portraitId, portraitId]);
    expect(await t.run((ctx) => ctx.db.get(carouselId))).toMatchObject({ type: "carousel" });

    await expect(create("image", "4:5", [portraitId, portraitId])).rejects.toThrow(
      "image precisa de exatamente 1 imagem",
    );
    await expect(create("carousel", "4:5", [portraitId])).rejects.toThrow(
      "carrossel precisa de 2 a 10",
    );
    await expect(create("story", "4:5", [portraitId])).rejects.toThrow("story é sempre 9:16");
    await expect(create("image", "9:16", [verticalId])).rejects.toThrow("image não usa 9:16");
    await expect(create("story", "9:16", [squareId])).rejects.toThrow("não 9:16");
    await expect(create("image", "4:5", [portraitId], { rationale })).rejects.toThrow(
      "exige um propósito",
    );
    await expect(
      create("image", "4:5", [portraitId], { purpose: "anuncio", rationale: "x".repeat(401) }),
    ).rejects.toThrow("400");

    const storyId = await create("story", "9:16", [verticalId]);
    await expect(
      t.mutation(internal.posts.schedulePostInternal, { accountId, postId: storyId }),
    ).rejects.toThrow("stories ainda não são publicados");
    expect(await t.run((ctx) => ctx.db.query("scheduledPosts").collect())).toEqual([]);
  });

  it("infers carousel for legacy callers without a type", async () => {
    const { t, accountId, imageId } = await setup();

    const postId = await t.mutation(internal.posts.createPostInternal, {
      accountId,
      imageIds: [imageId, imageId],
      caption: "Dois slides",
    });

    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({ type: "carousel" });
    await expect(
      t.mutation(internal.posts.createPostInternal, {
        accountId,
        imageIds: [imageId],
        caption: "x",
        format: "1:1",
      }),
    ).rejects.toThrow("format exige um type");
  });

  it("stores the post purpose and validates the secondary one", async () => {
    const { t, accountId, imageId } = await setup();

    const create = (purposes: { purpose?: PostPurpose; secondaryPurpose?: PostPurpose }) =>
      t.mutation(internal.posts.createPostInternal, {
        accountId,
        imageIds: [imageId],
        caption: "Bolo de cenoura, R$ 45, sábado",
        ...purposes,
      });

    const postId = await create({ purpose: "anuncio", secondaryPurpose: "promocional" });
    expect(await t.run((ctx) => ctx.db.get(postId))).toMatchObject({
      purpose: "anuncio",
      secondaryPurpose: "promocional",
    });

    await expect(create({ purpose: "anuncio", secondaryPurpose: "anuncio" })).rejects.toThrow(
      "diferente do principal",
    );
    await expect(create({ secondaryPurpose: "produto" })).rejects.toThrow("propósito principal");
  });

  it("creates a draft from owned images and rejects foreign or empty input", async () => {
    const { t, accountId, imageId } = await setup();

    const postId = await t.mutation(internal.posts.createPostInternal, {
      accountId,
      imageIds: [imageId],
      caption: "bom dia ☕",
    });

    const post = (await t.run((ctx) => ctx.db.get(postId)))!;
    expect(post).toMatchObject({ status: "draft", type: "image", platform: "instagram" });
    expect(await t.run((ctx) => ctx.db.query("scheduledPosts").collect())).toEqual([]);

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
  it("arms the scheduler, flips the post, and re-aims instead of duplicating", async () => {
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

    expect(result).toMatchObject({ scheduledFor, rescheduled: false });

    const post = (await t.run((ctx) => ctx.db.get(postId)))!;
    expect(post.status).toBe("scheduled");
    const scheduled = (await t.run((ctx) => ctx.db.get(result.scheduledPostId)))!;
    expect(scheduled).toMatchObject({ postId, accountId, status: "scheduled", scheduledFor });
    expect(scheduled.scheduledJobId).toBeDefined();

    // Scheduling again RE-AIMS the same row at the new time.
    const later = scheduledFor + 3_600_000;

    const again = await t.mutation(internal.posts.schedulePostInternal, {
      accountId,
      postId,
      scheduledFor: later,
    });

    expect(again).toMatchObject({
      scheduledPostId: result.scheduledPostId,
      scheduledFor: later,
      rescheduled: true,
    });
    const rearmed = (await t.run((ctx) => ctx.db.get(result.scheduledPostId)))!;
    expect(rearmed.scheduledFor).toBe(later);
  });
});

describe("posts.cancelScheduleInternal / deletePostInternal — the inverses", () => {
  it("cancel disarms back to draft; delete removes drafts and scheduled posts", async () => {
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

    await t.mutation(internal.posts.cancelScheduleInternal, { accountId, postId });
    const post = (await t.run((ctx) => ctx.db.get(postId)))!;
    expect(post.status).toBe("draft");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("scheduledPosts")
          .withIndex("by_post", (q) => q.eq("postId", postId))
          .first(),
      ),
    ).toBeNull();
    // Nothing to cancel now.
    await expect(
      t.mutation(internal.posts.cancelScheduleInternal, { accountId, postId }),
    ).rejects.toThrow();

    // Delete cascades a pending schedule and removes the post.
    await t.mutation(internal.posts.schedulePostInternal, {
      accountId,
      postId,
      scheduledFor: Date.now() + 60_000,
    });
    await t.mutation(internal.posts.deletePostInternal, { accountId, postId });
    expect(await t.run((ctx) => ctx.db.get(postId))).toBeNull();
  });

  it("refuses to delete a published post", async () => {
    const { t, accountId, imageId } = await setup();

    const postId = await t.mutation(internal.posts.createPostInternal, {
      accountId,
      imageIds: [imageId],
      caption: "bom dia",
    });

    const { scheduledPostId } = await t.mutation(internal.posts.schedulePostInternal, {
      accountId,
      postId,
      scheduledFor: Date.now() + 60_000,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(scheduledPostId, { status: "published" });
      await ctx.db.patch(postId, { status: "published" });
    });
    await expect(
      t.mutation(internal.posts.deletePostInternal, { accountId, postId }),
    ).rejects.toThrow("não podem ser apagadas");
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
