// @vitest-environment edge-runtime
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { Jimp } from "jimp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { imageSize } from "./references";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);

  const { accountId, otherAccountId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Ana", email: "a@e.com", clerkId: "c1" });

    const otherUserId = await ctx.db.insert("users", {
      name: "Bia",
      email: "b@e.com",
      clerkId: "c2",
    });

    const now = Date.now();

    return {
      accountId: await ctx.db.insert("accounts", {
        ownerUserId: userId,
        createdAt: now,
        updatedAt: now,
      }),
      otherAccountId: await ctx.db.insert("accounts", {
        ownerUserId: otherUserId,
        createdAt: now,
        updatedAt: now,
      }),
    };
  });

  const image = (
    account: Id<"accounts">,
    fields: Partial<Omit<Doc<"images">, "_id" | "_creationTime" | "accountId">> = {},
  ) =>
    t.run((ctx) =>
      ctx.db.insert("images", {
        accountId: account,
        origin: "generated",
        purpose: "post",
        externalUrl: "https://files.test/a.png",
        createdAt: Date.now(),
        ...fields,
      }),
    );

  return { t, accountId, otherAccountId, image, owner: t.withIdentity({ subject: "c1" }) };
};

afterEach(() => vi.unstubAllGlobals());

describe("references", () => {
  it("labels any account image, finds it by label and keeps it on removal", async () => {
    const { t, accountId, image } = await setup();
    const painted = await image(accountId);
    const other = await image(accountId);

    const saved = await t.mutation(internal.references.mark, {
      accountId,
      imageId: painted,
      labels: ["style", "layout", "layout"],
      note: "  arco rosa atrás,\n título em caixa alta ",
      addedBy: "vanda",
    });

    // Labels come back unique, in catalog order; notes are one clean line.
    expect(saved.labels).toEqual(["layout", "style"]);

    const found = await t.query(internal.references.search, { accountId, labels: ["layout"] });
    expect(found.total).toBe(1);
    expect(found.counts).toEqual({ layout: 1, style: 1 });
    expect(found.items[0]).toMatchObject({
      imageId: painted,
      note: "arco rosa atrás, título em caixa alta",
      addedBy: "vanda",
    });
    expect(found.items[0]!.path).toMatch(/^\/brand\/references\/layout-\w+\.\w+$/);

    expect(
      (await t.query(internal.references.search, { accountId, labels: ["face"] })).matched,
    ).toBe(0);

    // Relabeling keeps who saved it and the note.
    await t.mutation(internal.references.mark, {
      accountId,
      imageId: painted,
      labels: ["avoid"],
      addedBy: "caetano",
    });
    const relabeled = await t.query(internal.references.search, { accountId });
    expect(relabeled.items[0]).toMatchObject({ labels: ["avoid"], addedBy: "vanda" });
    expect(relabeled.items[0]!.note).toBe("arco rosa atrás, título em caixa alta");

    await t.mutation(internal.references.unmark, { accountId, imageId: painted });
    expect((await t.query(internal.references.search, { accountId })).total).toBe(0);
    expect(await t.run((ctx) => ctx.db.get(painted))).not.toBeNull();
    expect(other).toBeDefined();
  });

  it("refuses another account's image and an empty label list", async () => {
    const { t, accountId, otherAccountId, image } = await setup();
    const foreign = await image(otherAccountId);
    const own = await image(accountId);

    await expect(
      t.mutation(internal.references.mark, {
        accountId,
        imageId: foreign,
        labels: ["layout"],
        addedBy: "vanda",
      }),
    ).rejects.toThrow(/não encontrada/);

    await expect(
      t.mutation(internal.references.mark, {
        accountId,
        imageId: own,
        labels: [],
        addedBy: "vanda",
      }),
    ).rejects.toThrow(/rótulo/);
  });

  it("lets the owner mark, edit and clear references in the gallery", async () => {
    const { t, accountId, image, owner } = await setup();
    const a = await image(accountId);
    const b = await image(accountId, { referenceLabels: ["face"], referenceAddedAt: 1 });

    expect(
      await owner.mutation(api.gallery.markReferences, {
        accountId,
        imageIds: [a, b],
        labels: ["style"],
      }),
    ).toBe(2);

    const listed = await owner.query(api.gallery.references, { accountId });
    expect(listed.counts).toEqual({ style: 2, face: 1 });

    // Marking adds to what the image had.
    expect(listed.items.find((item) => item.id === b)?.reference?.labels).toEqual([
      "style",
      "face",
    ]);

    await owner.mutation(api.gallery.setReference, {
      accountId,
      imageId: a,
      labels: ["layout"],
      note: "grade do feed",
    });
    const detail = await owner.query(api.gallery.get, { accountId, imageId: a });
    expect(detail?.reference).toMatchObject({
      labels: ["layout"],
      note: "grade do feed",
      addedBy: "owner",
    });

    await owner.mutation(api.gallery.setReference, { accountId, imageId: a, labels: [] });
    expect((await owner.query(api.gallery.get, { accountId, imageId: a }))?.reference).toBeNull();
  });

  it("turns a cleared reference-only photo into an ordinary gallery upload", async () => {
    const { t, accountId, image, owner } = await setup();

    const copy = await image(accountId, {
      origin: "uploaded",
      purpose: "reference",
      referenceLabels: ["layout"],
      referenceAddedAt: 1,
    });

    const page = { numItems: 10, cursor: null };
    expect((await owner.query(api.gallery.list, { accountId, paginationOpts: page })).page).toEqual(
      [],
    );

    await owner.mutation(api.gallery.setReference, { accountId, imageId: copy, labels: [] });
    expect(
      (await owner.query(api.gallery.list, { accountId, paginationOpts: page })).page.map(
        (item) => item.id,
      ),
    ).toEqual([copy]);
    expect(await t.run(async (ctx) => (await ctx.db.get(copy))?.purpose)).toBe("post");
  });

  it("copies a post from a recent Instagram read, once", async () => {
    const { t, accountId } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("instagramObservations", {
        accountId,
        requestKey: "posts:connected",
        operation: "posts",
        target: "public:cartorio",
        workspacePath: "/instagram/posts.json",
        source: "upload_post",
        completeness: "complete",
        payload: [
          {
            id: "1789",
            url: "https://www.instagram.com/p/ABC123/",
            mediaType: "image",
            mediaUrl: "https://cdn.test/1789.jpg",
            caption: "Testamento: o que você precisa saber",
          },
        ],
        observedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
    );

    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4,
      0, 0, 0, 5, 0, 8, 6, 0, 0, 0,
    ]);

    const fetchMock = vi.fn(
      async () => new Response(png, { headers: { "content-type": "image/png" } }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const first = await t.action(internal.references.saveFromInstagram, {
      accountId,
      post: "https://www.instagram.com/p/ABC123/?img_index=1",
      labels: ["layout", "face"],
      note: "foto dela à direita",
      addedBy: "caetano",
    });

    expect(first).toMatchObject({ copied: true, labels: ["layout", "face"] });
    expect(first.source).toBe("@cartorio · https://www.instagram.com/p/ABC123/");

    const row = await t.run((ctx) => ctx.db.get(first.imageId));
    expect(row).toMatchObject({
      purpose: "reference",
      width: 1024,
      height: 1280,
      referenceAddedBy: "caetano",
    });

    // The same post again relabels the copy instead of downloading a second one.
    const second = await t.action(internal.references.saveFromInstagram, {
      accountId,
      post: "1789",
      labels: ["style"],
      addedBy: "caetano",
    });

    expect(second).toMatchObject({ imageId: first.imageId, copied: false, labels: ["style"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      t.action(internal.references.saveFromInstagram, {
        accountId,
        post: "999",
        labels: ["layout"],
        addedBy: "caetano",
      }),
    ).rejects.toThrow(/read_instagram_posts/);
  });

  it("crops a face out of a feed post into a new reference, leaving the post alone", async () => {
    const { t, accountId, otherAccountId, image } = await setup();

    const post = await image(accountId, {
      purpose: "reference",
      referenceLabels: ["layout"],
      referenceSource: "@cartorio · feed",
      referenceAddedAt: Date.now(),
      name: "Testamento",
    });

    const source = new Jimp({ width: 400, height: 500, color: 0xffffffff });
    const bytes = new Uint8Array(await source.getBuffer("image/png"));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { headers: { "content-type": "image/png" } })),
    );

    const saved = await t.action(internal.referencesNode.saveCrop, {
      accountId,
      imageId: post,
      crop: { x: 0.5, y: 0.1, width: 0.5, height: 0.4 },
      labels: ["face"],
      note: "rosto de Ana",
      addedBy: "caetano",
    });

    expect(saved).toMatchObject({ labels: ["face"], croppedFrom: "@cartorio · feed" });

    const crop = await t.run((ctx) => ctx.db.get(saved.imageId));
    expect(crop).toMatchObject({
      purpose: "reference",
      mimeType: "image/jpeg",
      width: 200,
      height: 200,
      referenceLabels: ["face"],
      referenceNote: "rosto de Ana",
      referenceSource: "recorte de @cartorio · feed",
    });
    expect((await t.run((ctx) => ctx.db.get(post)))?.referenceLabels).toEqual(["layout"]);

    await expect(
      t.action(internal.referencesNode.saveCrop, {
        accountId,
        imageId: post,
        crop: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 },
        labels: ["face"],
        addedBy: "caetano",
      }),
    ).rejects.toThrow(/pequeno demais/);

    await expect(
      t.action(internal.referencesNode.saveCrop, {
        accountId: otherAccountId,
        imageId: post,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        labels: ["face"],
        addedBy: "caetano",
      }),
    ).rejects.toThrow(/não encontrada/);
  });

  it("takes face photos the owner uploads in Perfil as references", async () => {
    const { t, accountId, otherAccountId, owner } = await setup();

    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["x"], { type: "image/jpeg" })),
    );

    const imageId = await owner.mutation(api.gallery.uploadReference, {
      accountId,
      storageId,
      mimeType: "image/jpeg",
      width: 800,
      height: 1000,
      labels: ["face"],
      name: "Rosto do dono",
    });

    expect(await t.run((ctx) => ctx.db.get(imageId))).toMatchObject({
      purpose: "reference",
      origin: "uploaded",
      referenceLabels: ["face"],
      referenceAddedBy: "owner",
      referenceSource: "perfil",
      name: "Rosto do dono",
    });

    const found = await t.query(internal.references.search, { accountId, labels: ["face"] });
    expect(found.items.map((item) => item.imageId)).toEqual([imageId]);

    await expect(
      owner.mutation(api.gallery.uploadReference, {
        accountId: otherAccountId,
        storageId,
        mimeType: "image/jpeg",
        labels: ["face"],
      }),
    ).rejects.toThrow();
    await expect(
      owner.mutation(api.gallery.uploadReference, {
        accountId,
        storageId,
        mimeType: "image/jpeg",
        labels: [],
      }),
    ).rejects.toThrow(/no labels/);
  });

  it("counts paint uses and puts the counts in the turn context", async () => {
    const { t, accountId, image } = await setup();
    const reference = await image(accountId, { referenceLabels: ["layout"], referenceAddedAt: 1 });
    const plain = await image(accountId);

    await t.mutation(internal.references.recordUse, { accountId, imageIds: [reference, plain] });
    expect(await t.run(async (ctx) => (await ctx.db.get(reference))?.referenceUseCount)).toBe(1);
    expect(await t.run(async (ctx) => (await ctx.db.get(plain))?.referenceUseCount ?? 0)).toBe(0);

    const context = await t.query(internal.brandContext.conversation, { accountId });
    expect(context).toContain("Referências salvas da marca: 1 layout.");
  });

  it("backfills legacy Perfil photos so the reference index finds them", async () => {
    const { t, accountId, image } = await setup();

    const legacy = await image(accountId, {
      origin: "uploaded",
      purpose: "reference",
      referenceKind: "face",
    });

    expect((await t.query(internal.references.search, { accountId })).total).toBe(0);
    await t.mutation(internal.migrations.referenceLabels, { cursor: null });

    const found = await t.query(internal.references.search, { accountId });
    expect(found.items.map((item) => [item.imageId, item.labels])).toEqual([[legacy, ["face"]]]);
  });
});

describe("imageSize", () => {
  it("reads PNG and JPEG headers", () => {
    const png = new Uint8Array(26);
    png.set([0x89, 0x50], 0);
    new DataView(png.buffer).setUint32(16, 1080);
    new DataView(png.buffer).setUint32(20, 1350);
    expect(imageSize(png)).toEqual({ width: 1080, height: 1350 });

    // SOI, an APP0 segment, then SOF0 with height 1350 and width 1080.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x05, 0x46, 0x04, 0x38, 3, 0, 0, 0,
    ]);

    expect(imageSize(jpeg)).toEqual({ width: 1080, height: 1350 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
