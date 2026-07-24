import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import {
  carouselDocumentStatuses,
  contentProjectStatuses,
  documentReviewStatuses,
} from "./pipeline/constants";

const assetStrategy = v.union(
  v.literal("available"),
  v.literal("generate"),
  v.literal("needs_owner"),
  v.literal("not_needed"),
);

const carouselSlideArg = v.object({
  slideId: v.string(),
  position: v.number(),
  role: v.union(
    v.literal("cover"),
    v.literal("context"),
    v.literal("content"),
    v.literal("proof"),
    v.literal("summary"),
    v.literal("cta"),
  ),
  layout: v.union(
    v.literal("statement"),
    v.literal("editorial"),
    v.literal("list"),
    v.literal("steps"),
    v.literal("comparison"),
    v.literal("split"),
    v.literal("quote"),
    v.literal("cta"),
  ),
  kicker: v.string(),
  headline: v.string(),
  body: v.string(),
  bullets: v.array(v.string()),
  factIds: v.array(v.string()),
  visual: v.object({
    kind: v.union(
      v.literal("none"),
      v.literal("reference"),
      v.literal("photo"),
      v.literal("illustration"),
      v.literal("icon"),
      v.literal("diagram"),
      v.literal("texture"),
    ),
    strategy: assetStrategy,
    assetIds: v.array(v.string()),
    prompt: v.string(),
    altText: v.string(),
    treatment: v.union(
      v.literal("none"),
      v.literal("background"),
      v.literal("full_bleed"),
      v.literal("split"),
      v.literal("inset"),
      v.literal("cutout"),
    ),
  }),
  productionNotes: v.array(v.string()),
});

const documentArg = {
  title: v.string(),
  caption: v.string(),
  accessibilityDescription: v.string(),
  canvas: v.object({
    preset: v.literal("instagram_portrait_4_5"),
    width: v.literal(1080),
    height: v.literal(1350),
  }),
  style: v.object({
    theme: v.union(v.literal("light"), v.literal("dark"), v.literal("brand")),
    density: v.union(v.literal("sparse"), v.literal("balanced"), v.literal("rich")),
    headlineCase: v.union(v.literal("sentence"), v.literal("uppercase")),
    cornerStyle: v.union(v.literal("square"), v.literal("soft"), v.literal("rounded")),
    imageTreatment: v.union(
      v.literal("natural"),
      v.literal("duotone"),
      v.literal("cutout"),
      v.literal("none"),
    ),
    motifs: v.array(v.string()),
    referenceAssetIds: v.array(v.string()),
  }),
  brandFactIds: v.array(v.string()),
  slides: v.array(carouselSlideArg),
};

const reviewArg = {
  reviewDecision: v.union(v.literal("approved"), v.literal("rejected")),
  reviewSummary: v.string(),
  unsupportedClaims: v.array(v.string()),
  brandIssues: v.array(v.string()),
  similarityRisks: v.array(v.string()),
  productionIssues: v.array(v.string()),
  corrections: v.array(v.string()),
  reviewConfidence: v.number(),
};

const productionMetadataArg = {
  deterministicIssues: v.array(v.string()),
  deterministicWarnings: v.array(v.string()),
  sourceSimilarity: v.number(),
  model: v.string(),
  promptVersion: v.string(),
  reviewModel: v.string(),
  reviewPromptVersion: v.string(),
};

export const requireBriefOwner = internalQuery({
  args: { creativeBriefId: v.id("creativeBriefs") },
  handler: async (ctx, { creativeBriefId }) => {
    const brief = await ctx.db.get(creativeBriefId);
    if (!brief) throw new Error("creative brief not found");
    await requireOwnedAccount(ctx, brief.accountId);
    return brief.accountId;
  },
});

export const requireProjectOwner = internalQuery({
  args: { projectId: v.id("contentProjects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("content project not found");
    await requireOwnedAccount(ctx, project.accountId);
    return project.accountId;
  },
});

export const loadProductionInput = internalQuery({
  args: { creativeBriefId: v.id("creativeBriefs") },
  handler: async (ctx, { creativeBriefId }) => {
    const brief = await ctx.db.get(creativeBriefId);
    if (!brief || brief.status !== "ready") return null;
    const opportunity = await ctx.db.get(brief.opportunityId);
    if (!opportunity) return null;
    const dossier = opportunity.dossierId ? await ctx.db.get(opportunity.dossierId) : null;
    const brandSnapshot = opportunity.brandSnapshotId
      ? await ctx.db.get(opportunity.brandSnapshotId)
      : null;
    if (!dossier || !brandSnapshot) return null;
    const facts = [];
    for (const id of brandSnapshot.canonIds) {
      const fact = await ctx.db.get(id);
      if (fact?.confirmedByOwner)
        facts.push({ id: String(fact._id), kind: fact.kind, text: fact.text });
    }
    const assets = (
      await ctx.db
        .query("images")
        .withIndex("by_account", (q) => q.eq("accountId", brief.accountId))
        .collect()
    ).filter((image) => image.purpose === "reference");
    return {
      brief,
      opportunity,
      dossier,
      brand: {
        facts,
        restrictions: facts
          .filter((fact) => fact.kind === "restriction" || fact.kind === "forbidden_claim")
          .map((fact) => fact.text),
        authorizedAssets: assets.map((asset) => ({
          id: String(asset._id),
          kind: "reference_image",
          description: asset.description ?? "Imagem de referência com conteúdo não inspecionado",
        })),
      },
      source: {
        caption: dossier.caption,
        transcript: dossier.transcript,
        onScreenText: (dossier.frameEvidence ?? []).flatMap((frame) =>
          frame.onScreenText ? [frame.onScreenText] : [],
        ),
      },
    };
  },
});

export const loadProjectDocument = internalQuery({
  args: { projectId: v.id("contentProjects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project?.activeDocumentId || !project.creativeBriefId) return null;
    const document = await ctx.db.get(project.activeDocumentId);
    return document ? { project, document, creativeBriefId: project.creativeBriefId } : null;
  },
});

export const claimBriefPlanning = internalMutation({
  args: { creativeBriefId: v.id("creativeBriefs"), retry: v.boolean() },
  handler: async (ctx, { creativeBriefId, retry }) => {
    const brief = await ctx.db.get(creativeBriefId);
    if (!brief || brief.status !== "ready") throw new Error("production-ready brief not found");
    const existing = await ctx.db
      .query("contentProjects")
      .withIndex("by_brief", (q) => q.eq("creativeBriefId", creativeBriefId))
      .unique();
    const now = Date.now();
    if (existing) {
      const retryable = ["failed", "blocked", "draft"].includes(existing.status);
      if (!retry || !retryable) return { projectId: existing._id, claimed: false };
      await ctx.db.patch(existing._id, {
        status: "planning",
        lastError: undefined,
        updatedAt: now,
      });
      await ctx.db.patch(brief.opportunityId, {
        contentProjectId: existing._id,
        status: "adapting",
        updatedAt: now,
      });
      return { projectId: existing._id, claimed: true };
    }
    const projectId = await ctx.db.insert("contentProjects", {
      accountId: brief.accountId,
      creativeBriefId,
      opportunityId: brief.opportunityId,
      kind: "carousel",
      origin: "creative_director",
      title: brief.title,
      status: "planning",
      latestVersion: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(brief.opportunityId, {
      contentProjectId: projectId,
      status: "adapting",
      updatedAt: now,
    });
    return { projectId, claimed: true };
  },
});

const createAssetRequests = async (
  ctx: MutationCtx,
  project: Doc<"contentProjects">,
  documentId: Id<"carouselDocuments">,
  slides: ReadonlyArray<{
    slideId: string;
    visual: {
      kind: string;
      strategy: "available" | "generate" | "needs_owner" | "not_needed";
      assetIds: ReadonlyArray<string>;
      prompt: string;
    };
  }>,
  now: number,
): Promise<void> => {
  for (const slide of slides) {
    if (slide.visual.strategy === "not_needed" || slide.visual.kind === "none") continue;
    await ctx.db.insert("contentAssetRequests", {
      accountId: project.accountId,
      projectId: project._id,
      documentId,
      slideId: slide.slideId,
      kind: slide.visual.kind,
      strategy: slide.visual.strategy,
      sourceImageIds: slide.visual.assetIds.map((id) => id as Id<"images">),
      prompt: slide.visual.prompt,
      status:
        slide.visual.strategy === "available"
          ? "ready"
          : slide.visual.strategy === "needs_owner"
            ? "blocked"
            : "planned",
      createdAt: now,
      updatedAt: now,
    });
  }
};

export const savePlannedDocument = internalMutation({
  args: {
    projectId: v.id("contentProjects"),
    creativeBriefId: v.id("creativeBriefs"),
    changeKind: v.union(
      v.literal("generated"),
      v.literal("slide_regeneration"),
      v.literal("review_retry"),
    ),
    parentDocumentId: v.optional(v.id("carouselDocuments")),
    createdBy: v.union(v.literal("model"), v.literal("system")),
    ...documentArg,
    ...reviewArg,
    ...productionMetadataArg,
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.creativeBriefId !== args.creativeBriefId)
      throw new Error("content project mismatch");
    const ready = args.reviewDecision === "approved" && args.deterministicIssues.length === 0;
    const blocked = args.deterministicIssues.some((issue) =>
      issue.startsWith("owner_asset_required:"),
    );
    const documentStatus = ready ? "ready_for_render" : blocked ? "blocked" : "draft";
    const projectStatus = ready ? "ready_for_render" : blocked ? "blocked" : "draft";
    const now = Date.now();
    const version = project.latestVersion + 1;
    const documentId = await ctx.db.insert("carouselDocuments", {
      accountId: project.accountId,
      projectId: project._id,
      creativeBriefId: args.creativeBriefId,
      version,
      ...(args.parentDocumentId !== undefined ? { parentDocumentId: args.parentDocumentId } : {}),
      changeKind: args.changeKind,
      status: documentStatus,
      reviewStatus: args.reviewDecision === "approved" ? "approved" : "rejected",
      title: args.title,
      caption: args.caption,
      accessibilityDescription: args.accessibilityDescription,
      canvas: args.canvas,
      style: args.style,
      brandFactIds: args.brandFactIds,
      slides: args.slides,
      reviewSummary: args.reviewSummary,
      unsupportedClaims: args.unsupportedClaims,
      brandIssues: args.brandIssues,
      similarityRisks: args.similarityRisks,
      productionIssues: args.productionIssues,
      corrections: args.corrections,
      reviewConfidence: args.reviewConfidence,
      deterministicIssues: args.deterministicIssues,
      deterministicWarnings: args.deterministicWarnings,
      sourceSimilarity: args.sourceSimilarity,
      model: args.model,
      promptVersion: args.promptVersion,
      reviewModel: args.reviewModel,
      reviewPromptVersion: args.reviewPromptVersion,
      createdBy: args.createdBy,
      createdAt: now,
    });
    await createAssetRequests(ctx, project, documentId, args.slides, now);
    await ctx.db.patch(project._id, {
      activeDocumentId: documentId,
      latestVersion: version,
      title: args.title,
      status: projectStatus,
      lastError: ready
        ? undefined
        : [args.reviewSummary, ...args.deterministicIssues].filter(Boolean).join(" · "),
      updatedAt: now,
    });
    if (project.opportunityId)
      await ctx.db.patch(project.opportunityId, {
        status: "ready_for_production",
        lastError: ready ? undefined : "Documento de produção requer revisão.",
        updatedAt: now,
      });
    return documentId;
  },
});

export const failPlanning = internalMutation({
  args: { projectId: v.id("contentProjects"), error: v.string() },
  handler: async (ctx, { projectId, error }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return;
    const now = Date.now();
    await ctx.db.patch(projectId, { status: "failed", lastError: error, updatedAt: now });
    if (project.opportunityId)
      await ctx.db.patch(project.opportunityId, {
        status: "ready_for_production",
        lastError: error,
        updatedAt: now,
      });
  },
});

export const saveOwnerDraft = mutation({
  args: {
    projectId: v.id("contentProjects"),
    parentDocumentId: v.id("carouselDocuments"),
    ...documentArg,
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    const parent = await ctx.db.get(args.parentDocumentId);
    if (!project || !parent || parent.projectId !== project._id)
      throw new Error("content project mismatch");
    await requireOwnedAccount(ctx, project.accountId);
    const now = Date.now();
    const version = project.latestVersion + 1;
    const documentId = await ctx.db.insert("carouselDocuments", {
      accountId: project.accountId,
      projectId: project._id,
      ...(project.creativeBriefId !== undefined
        ? { creativeBriefId: project.creativeBriefId }
        : {}),
      version,
      parentDocumentId: parent._id,
      changeKind: "manual_edit",
      status: "draft",
      reviewStatus: "pending",
      title: args.title,
      caption: args.caption,
      accessibilityDescription: args.accessibilityDescription,
      canvas: args.canvas,
      style: args.style,
      brandFactIds: args.brandFactIds,
      slides: args.slides,
      reviewSummary: "Aguardando nova revisão editorial.",
      unsupportedClaims: [],
      brandIssues: [],
      similarityRisks: [],
      productionIssues: [],
      corrections: [],
      reviewConfidence: 0,
      deterministicIssues: [],
      deterministicWarnings: [],
      sourceSimilarity: 0,
      model: parent.model,
      promptVersion: parent.promptVersion,
      reviewModel: parent.reviewModel,
      reviewPromptVersion: parent.reviewPromptVersion,
      createdBy: "owner",
      createdAt: now,
    });
    await createAssetRequests(ctx, project, documentId, args.slides, now);
    await ctx.db.patch(project._id, {
      activeDocumentId: documentId,
      latestVersion: version,
      title: args.title,
      status: "draft",
      lastError: undefined,
      updatedAt: now,
    });
    return documentId;
  },
});

export const setActiveReviewedDocument = internalMutation({
  args: {
    projectId: v.id("contentProjects"),
    documentId: v.id("carouselDocuments"),
    status: v.union(...carouselDocumentStatuses.map((status) => v.literal(status))),
    reviewStatus: v.union(...documentReviewStatuses.map((status) => v.literal(status))),
    ...reviewArg,
    deterministicIssues: v.array(v.string()),
    deterministicWarnings: v.array(v.string()),
    sourceSimilarity: v.number(),
    reviewModel: v.string(),
    reviewPromptVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    const document = await ctx.db.get(args.documentId);
    if (!project || !document || document.projectId !== project._id)
      throw new Error("content project mismatch");
    const now = Date.now();
    await ctx.db.patch(document._id, {
      status: args.status,
      reviewStatus: args.reviewStatus,
      reviewSummary: args.reviewSummary,
      unsupportedClaims: args.unsupportedClaims,
      brandIssues: args.brandIssues,
      similarityRisks: args.similarityRisks,
      productionIssues: args.productionIssues,
      corrections: args.corrections,
      reviewConfidence: args.reviewConfidence,
      deterministicIssues: args.deterministicIssues,
      deterministicWarnings: args.deterministicWarnings,
      sourceSimilarity: args.sourceSimilarity,
      reviewModel: args.reviewModel,
      reviewPromptVersion: args.reviewPromptVersion,
    });
    await ctx.db.patch(project._id, {
      status: args.status === "ready_for_render" ? "ready_for_render" : args.status,
      lastError:
        args.status === "ready_for_render"
          ? undefined
          : [args.reviewSummary, ...args.deterministicIssues].filter(Boolean).join(" · "),
      updatedAt: now,
    });
  },
});

export const requestRender = mutation({
  args: { projectId: v.id("contentProjects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project?.activeDocumentId) throw new Error("renderable project not found");
    await requireOwnedAccount(ctx, project.accountId);
    const document = await ctx.db.get(project.activeDocumentId);
    if (!document || document.status !== "ready_for_render" || document.reviewStatus !== "approved")
      throw new Error("active carousel document is not approved for rendering");
    const existing = await ctx.db
      .query("carouselRenderJobs")
      .withIndex("by_project_created", (q) => q.eq("projectId", projectId))
      .order("desc")
      .first();
    if (existing && ["queued", "rendering"].includes(existing.status)) return existing._id;
    const attempt = (existing?.attempt ?? 0) + 1;
    const now = Date.now();
    const jobId = await ctx.db.insert("carouselRenderJobs", {
      accountId: project.accountId,
      projectId,
      documentId: document._id,
      status: "queued",
      rendererVersion: "carousel-renderer-v1",
      attempt,
      outputImageIds: [],
      createdAt: now,
    });
    await ctx.db.patch(projectId, { status: "rendering", lastError: undefined, updatedAt: now });
    return jobId;
  },
});

export const startRender = internalMutation({
  args: { renderJobId: v.id("carouselRenderJobs") },
  handler: async (ctx, { renderJobId }) => {
    const job = await ctx.db.get(renderJobId);
    if (!job || job.status !== "queued") return false;
    await ctx.db.patch(renderJobId, { status: "rendering", startedAt: Date.now() });
    return true;
  },
});

const renderOutputArg = v.object({
  slideId: v.string(),
  width: v.number(),
  height: v.number(),
  storageId: v.optional(v.id("_storage")),
  externalUrl: v.optional(v.string()),
  mimeType: v.string(),
  description: v.string(),
  altText: v.string(),
});

export const completeRender = internalMutation({
  args: { renderJobId: v.id("carouselRenderJobs"), outputs: v.array(renderOutputArg) },
  handler: async (ctx, { renderJobId, outputs }) => {
    const job = await ctx.db.get(renderJobId);
    if (!job || job.status !== "rendering") throw new Error("render job is not running");
    const project = await ctx.db.get(job.projectId);
    const document = await ctx.db.get(job.documentId);
    if (!project || !document || outputs.length !== document.slides.length)
      throw new Error("render output does not match carousel document");
    const bySlide = new Map(outputs.map((output) => [output.slideId, output]));
    const now = Date.now();
    const imageIds: Array<Id<"images">> = [];
    for (const slide of document.slides) {
      const output = bySlide.get(slide.slideId);
      if (!output || (output.storageId === undefined && output.externalUrl === undefined))
        throw new Error(`missing render output for ${slide.slideId}`);
      imageIds.push(
        await ctx.db.insert("images", {
          accountId: project.accountId,
          origin: "generated",
          purpose: "post",
          contentProjectId: project._id,
          carouselDocumentId: document._id,
          slideId: slide.slideId,
          width: output.width,
          height: output.height,
          ...(output.storageId !== undefined ? { storageId: output.storageId } : {}),
          ...(output.externalUrl !== undefined ? { externalUrl: output.externalUrl } : {}),
          mimeType: output.mimeType,
          description: output.description,
          altText: output.altText,
          createdAt: now,
        }),
      );
    }
    const postId = await ctx.db.insert("posts", {
      accountId: project.accountId,
      type: "feed",
      imageIds,
      caption: document.caption,
      platform: "instagram",
      status: "ready",
      ...(project.opportunityId !== undefined ? { opportunityId: project.opportunityId } : {}),
      contentProjectId: project._id,
      carouselDocumentId: document._id,
      createdAt: now,
    });
    await ctx.db.patch(renderJobId, {
      status: "succeeded",
      outputImageIds: imageIds,
      postId,
      completedAt: now,
    });
    await ctx.db.patch(project._id, {
      status: "ready",
      coverImageId: imageIds[0],
      postId,
      lastError: undefined,
      updatedAt: now,
    });
    if (project.opportunityId)
      await ctx.db.patch(project.opportunityId, {
        status: "awaiting_approval",
        postId,
        updatedAt: now,
      });
    return postId;
  },
});

export const failRender = internalMutation({
  args: { renderJobId: v.id("carouselRenderJobs"), error: v.string() },
  handler: async (ctx, { renderJobId, error }) => {
    const job = await ctx.db.get(renderJobId);
    if (!job) return;
    const now = Date.now();
    await ctx.db.patch(renderJobId, { status: "failed", lastError: error, completedAt: now });
    await ctx.db.patch(job.projectId, { status: "failed", lastError: error, updatedAt: now });
  },
});

export const project = query({
  args: { projectId: v.id("contentProjects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    await requireOwnedAccount(ctx, project.accountId);
    const document = project.activeDocumentId ? await ctx.db.get(project.activeDocumentId) : null;
    const assets = document
      ? await ctx.db
          .query("contentAssetRequests")
          .withIndex("by_document", (q) => q.eq("documentId", document._id))
          .collect()
      : [];
    const renders = await ctx.db
      .query("carouselRenderJobs")
      .withIndex("by_project_created", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(10);
    const coverUrl = project.coverImageId
      ? await (async () => {
          const image = await ctx.db.get(project.coverImageId!);
          return (
            image?.externalUrl ??
            (image?.storageId ? await ctx.storage.getUrl(image.storageId) : null)
          );
        })()
      : null;
    return { project, document, assets, renders, coverUrl };
  },
});

export const documentHistory = query({
  args: { projectId: v.id("contentProjects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return [];
    await requireOwnedAccount(ctx, project.accountId);
    return ctx.db
      .query("carouselDocuments")
      .withIndex("by_project_version", (q) => q.eq("projectId", projectId))
      .order("desc")
      .collect();
  },
});

export const archiveProject = mutation({
  args: { projectId: v.id("contentProjects") },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) throw new Error("content project not found");
    await requireOwnedAccount(ctx, project.accountId);
    await ctx.db.patch(projectId, { status: "archived", updatedAt: Date.now() });
  },
});

export const gallery = query({
  args: {
    accountId: v.id("accounts"),
    kind: v.optional(
      v.union(
        v.literal("post"),
        v.literal("image"),
        v.literal("reel"),
        v.literal("story"),
        v.literal("tweet"),
      ),
    ),
    status: v.optional(v.union(...contentProjectStatuses.map((status) => v.literal(status)))),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, kind, status, search }) => {
    await requireOwnedAccount(ctx, accountId);
    const needle = search?.trim().toLocaleLowerCase() ?? "";
    const projects = await ctx.db
      .query("contentProjects")
      .withIndex("by_account_updated", (q) => q.eq("accountId", accountId))
      .order("desc")
      .take(200);
    const projectItems = await Promise.all(
      projects
        .filter((item) => item.status !== "archived")
        .filter((item) => status === undefined || item.status === status)
        .filter((item) => kind === undefined || kind === "post")
        .filter((item) => needle.length === 0 || item.title.toLocaleLowerCase().includes(needle))
        .map(async (item) => {
          const cover = item.coverImageId ? await ctx.db.get(item.coverImageId) : null;
          const previewUrl =
            cover?.externalUrl ??
            (cover?.storageId ? await ctx.storage.getUrl(cover.storageId) : null);
          const document = item.activeDocumentId ? await ctx.db.get(item.activeDocumentId) : null;
          return {
            id: String(item._id),
            entityId: item._id,
            entity: "content_project" as const,
            kind: "post" as const,
            title: item.title,
            status: item.status,
            itemCount: document?.slides.length ?? 0,
            previewUrl,
            updatedAt: item.updatedAt,
          };
        }),
    );
    const linkedPostIds = new Set(
      projects.flatMap((project) => (project.postId ? [String(project.postId)] : [])),
    );
    const legacyPosts = (
      await ctx.db
        .query("posts")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    ).filter((post) => !linkedPostIds.has(String(post._id)));
    const postItems = await Promise.all(
      legacyPosts
        .filter(
          (post) => kind === undefined || kind === (post.type === "feed" ? "post" : post.type),
        )
        .filter((post) => needle.length === 0 || post.caption.toLocaleLowerCase().includes(needle))
        .map(async (post) => {
          const cover = post.imageIds[0] ? await ctx.db.get(post.imageIds[0]) : null;
          const previewUrl =
            cover?.externalUrl ??
            (cover?.storageId ? await ctx.storage.getUrl(cover.storageId) : null);
          return {
            id: String(post._id),
            entityId: post._id,
            entity: "post" as const,
            kind: post.type === "feed" ? ("post" as const) : post.type,
            title: post.caption.slice(0, 80) || "Sem título",
            status: post.status,
            itemCount: post.imageIds.length,
            previewUrl,
            updatedAt: post.createdAt,
          };
        }),
    );
    return [...projectItems, ...postItems].sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const projectStatuses = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    const projects = await ctx.db
      .query("contentProjects")
      .withIndex("by_account_updated", (q) => q.eq("accountId", accountId))
      .collect();
    return Object.fromEntries(
      contentProjectStatuses.map((status) => [
        status,
        projects.filter((project) => project.status === status).length,
      ]),
    );
  },
});
