// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const slides = [1, 2, 3].map((position) => ({
  slideId: `slide-${position}`,
  position,
  role:
    position === 1 ? ("cover" as const) : position === 3 ? ("cta" as const) : ("content" as const),
  layout:
    position === 1 ? ("statement" as const) : position === 3 ? ("cta" as const) : ("list" as const),
  kicker: "",
  headline: `Slide ${position}`,
  body: "",
  bullets: [],
  factIds: [],
  visual: {
    kind: "illustration" as const,
    strategy: "generate" as const,
    assetIds: [],
    prompt: `Ilustração ${position}`,
    altText: `Ilustração ${position}`,
    treatment: "inset" as const,
  },
  productionNotes: [],
}));

const seedRenderableProject = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const ownerUserId = await ctx.db.insert("users", {
      clerkId: "render-owner",
      name: "Render Owner",
      email: "render@example.com",
    });
    const accountId = await ctx.db.insert("accounts", {
      ownerUserId,
      mode: "needs_approval",
      createdAt: now,
      updatedAt: now,
    });
    const projectId = await ctx.db.insert("contentProjects", {
      accountId,
      kind: "carousel",
      origin: "manual",
      title: "Carrossel",
      status: "ready_for_render",
      latestVersion: 0,
      createdAt: now,
      updatedAt: now,
    });
    const documentId = await ctx.db.insert("carouselDocuments", {
      accountId,
      projectId,
      version: 1,
      changeKind: "generated",
      status: "ready_for_render",
      reviewStatus: "approved",
      title: "Carrossel",
      caption: "Legenda final",
      accessibilityDescription: "Três slides editoriais.",
      canvas: { preset: "instagram_portrait_4_5", width: 1080, height: 1350 },
      style: {
        theme: "brand",
        density: "balanced",
        headlineCase: "sentence",
        cornerStyle: "soft",
        imageTreatment: "none",
        motifs: [],
        referenceAssetIds: [],
      },
      brandFactIds: [],
      slides,
      reviewSummary: "Aprovado",
      unsupportedClaims: [],
      brandIssues: [],
      similarityRisks: [],
      productionIssues: [],
      corrections: [],
      reviewConfidence: 0.9,
      deterministicIssues: [],
      deterministicWarnings: [],
      sourceSimilarity: 0.1,
      model: "test",
      promptVersion: "test-v1",
      reviewModel: "test-review",
      reviewPromptVersion: "test-review-v1",
      createdBy: "model",
      createdAt: now,
    });
    await ctx.db.patch(projectId, { activeDocumentId: documentId, latestVersion: 1 });
    const renderJobId = await ctx.db.insert("carouselRenderJobs", {
      accountId,
      projectId,
      documentId,
      status: "queued",
      rendererVersion: "test-renderer",
      attempt: 1,
      outputImageIds: [],
      createdAt: now,
    });
    return { projectId, documentId, renderJobId };
  });

describe("content studio persistence", () => {
  it("turns an ordered render result into gallery media and a ready post atomically", async () => {
    const t = convexTest(schema, modules);
    const { projectId, documentId, renderJobId } = await seedRenderableProject(t);
    expect(await t.mutation(internal.contentStudio.startRender, { renderJobId })).toBe(true);
    const postId = await t.mutation(internal.contentStudio.completeRender, {
      renderJobId,
      outputs: slides.map((slide) => ({
        slideId: slide.slideId,
        width: 1080,
        height: 1350,
        externalUrl: `https://cdn.example/${slide.slideId}.jpg`,
        mimeType: "image/jpeg",
        description: slide.headline,
        altText: slide.visual.altText,
      })),
    });
    const state = await t.run(async (ctx) => ({
      project: await ctx.db.get(projectId),
      document: await ctx.db.get(documentId),
      job: await ctx.db.get(renderJobId),
      post: await ctx.db.get(postId),
      images: await ctx.db.query("images").collect(),
    }));
    expect(state.project).toMatchObject({ status: "ready", postId });
    expect(state.job).toMatchObject({ status: "succeeded", postId });
    expect(state.post).toMatchObject({ status: "ready", carouselDocumentId: documentId });
    expect(state.post?.imageIds).toEqual(state.images.map((image) => image._id));
    expect(state.images.map((image) => image.slideId)).toEqual(["slide-1", "slide-2", "slide-3"]);
  });

  it("serves one account-scoped gallery across projects, posts, and standalone images", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        clerkId: "gallery-user",
        name: "Gallery User",
        email: "gallery@example.com",
      });
      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        mode: "needs_approval",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("contentProjects", {
        accountId,
        kind: "carousel",
        origin: "manual",
        title: "Projeto",
        status: "draft",
        latestVersion: 0,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("posts", {
        accountId,
        type: "reel",
        imageIds: [],
        caption: "Reel legado",
        platform: "instagram",
        status: "ready",
        createdAt: now,
      });
      await ctx.db.insert("images", {
        accountId,
        origin: "gallery",
        externalUrl: "https://cdn.example/standalone.jpg",
        description: "Imagem avulsa",
        createdAt: now,
      });
      return accountId;
    });
    const authed = t.withIdentity({ subject: "gallery-user" });
    const summary = await authed.query(api.contentStudio.gallerySummary, { accountId });
    const items = await authed.query(api.contentStudio.gallery, { accountId });
    expect(summary).toMatchObject({
      total: 3,
      counts: { post: 1, image: 1, reel: 1, story: 0, tweet: 0 },
    });
    expect(new Set(items.map((item) => item.entity))).toEqual(
      new Set(["content_project", "post", "image"]),
    );
  });

  it("keeps owner edits as immutable versions that require a fresh review", async () => {
    const t = convexTest(schema, modules);
    const { projectId, documentId } = await seedRenderableProject(t);
    const original = await t.run((ctx) => ctx.db.get(documentId));
    if (!original) throw new Error("missing fixture document");
    const authed = t.withIdentity({ subject: "render-owner" });
    const editedId = await authed.mutation(api.contentStudio.saveOwnerDraft, {
      projectId,
      parentDocumentId: documentId,
      title: "Carrossel revisado",
      caption: original.caption,
      accessibilityDescription: original.accessibilityDescription,
      canvas: original.canvas,
      style: original.style,
      brandFactIds: original.brandFactIds,
      slides: original.slides.map((slide, index) =>
        index === 0 ? Object.assign({}, slide, { headline: "Nova abertura" }) : slide,
      ),
    });
    const state = await t.run(async (ctx) => ({
      original: await ctx.db.get(documentId),
      edited: await ctx.db.get(editedId),
      project: await ctx.db.get(projectId),
    }));
    expect(state.original?.title).toBe("Carrossel");
    expect(state.edited).toMatchObject({
      version: 2,
      parentDocumentId: documentId,
      changeKind: "manual_edit",
      reviewStatus: "pending",
      status: "draft",
    });
    expect(state.project).toMatchObject({ activeDocumentId: editedId, latestVersion: 2 });
  });

  it("does not accept incomplete render output", async () => {
    const t = convexTest(schema, modules);
    const { renderJobId } = await seedRenderableProject(t);
    await t.mutation(internal.contentStudio.startRender, { renderJobId });
    await expect(
      t.mutation(internal.contentStudio.completeRender, {
        renderJobId,
        outputs: [],
      }),
    ).rejects.toThrow("render output does not match carousel document");
  });
});
