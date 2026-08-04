import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import {
  entityName,
  formatDate,
  imageFileParts,
  imageUrl,
  jsonFile,
  resolveByName,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceMount,
} from "../types";

const LISTING_CAP = 25;

const loadProjects = async (ctx: QueryCtx, accountId: Id<"accounts">) =>
  ctx.db
    .query("contentProjects")
    .withIndex("by_account_updated", (q) => q.eq("accountId", accountId))
    .order("desc")
    .take(LISTING_CAP);

const activeDocument = (ctx: QueryCtx, project: Doc<"contentProjects">) =>
  project.activeDocumentId ? ctx.db.get(project.activeDocumentId) : Promise.resolve(null);

const renderImages = async (
  ctx: QueryCtx,
  project: Doc<"contentProjects">,
): Promise<Doc<"images">[]> => {
  const post = project.postId ? await ctx.db.get(project.postId) : null;
  if (!post) return [];
  const images = await Promise.all(post.imageIds.map((imageId) => ctx.db.get(imageId)));
  return images.filter((image): image is Doc<"images"> => image !== null);
};

const slidesMarkdown = (document: Doc<"carouselDocuments">): string => {
  const lines = [
    `# ${document.title}`,
    "",
    `Revisão: ${document.reviewStatus} — ${document.reviewSummary || "sem observações"}`,
  ];
  if (document.deterministicIssues.length > 0) {
    lines.push(`Problemas: ${document.deterministicIssues.join("; ")}`);
  }
  const slides = [...document.slides];
  slides.sort((a, b) => a.position - b.position);
  for (const slide of slides) {
    lines.push("", `## Slide ${slide.position} — ${slide.role} (slideId: ${slide.slideId})`, "");
    if (slide.kicker) lines.push(`*${slide.kicker}*`);
    lines.push(`**${slide.headline}**`);
    if (slide.body) lines.push("", slide.body);
    for (const bullet of slide.bullets) lines.push(`- ${bullet}`);
    if (slide.visual.kind !== "none") {
      lines.push("", `Visual: ${slide.visual.kind} (${slide.visual.strategy})`);
    }
  }
  return lines.join("\n");
};

const projectFiles = (
  project: Doc<"contentProjects">,
  document: Doc<"carouselDocuments"> | null,
  renders: number,
) => {
  const entries: WorkspaceEntry[] = [
    { name: "status.json", kind: "file", summary: "estágio, revisão e estado de publicação" },
  ];
  if (project.briefSnapshotJson) {
    entries.push({ name: "brief.json", kind: "file", summary: "brief criativo do projeto" });
  }
  if (document) {
    entries.push(
      { name: "slides.md", kind: "file", summary: `${document.slides.length} slides do documento ativo` },
      { name: "caption.md", kind: "file", summary: "legenda e descrição de acessibilidade" },
    );
  }
  if (renders > 0) {
    entries.push({ name: "renders", kind: "dir", summary: `${renders} slides renderizados` });
  }
  return entries;
};

export const projectsMount: WorkspaceMount = {
  root: "projects",
  summary: "projetos de carrossel: brief, slides, legenda, renders e status",
  list: async (ctx, accountId, segments): Promise<WorkspaceEntry[] | null> => {
    const projects = await loadProjects(ctx, accountId);
    if (segments.length === 0) {
      return projects.map((project) => ({
        name: entityName(project.title, project._id),
        kind: "dir",
        summary: `${project.status} · atualizado ${formatDate(project.updatedAt)} · id ${project._id}`,
      }));
    }
    const project = resolveByName(segments[0]!, projects);
    if (!project) return null;
    if (segments.length === 1) {
      const [document, renders] = await Promise.all([
        activeDocument(ctx, project),
        renderImages(ctx, project),
      ]);
      return projectFiles(project, document, renders.length);
    }
    if (segments.length === 2 && segments[1] === "renders") {
      const renders = await renderImages(ctx, project);
      return renders.map((image, index) => ({
        name: `${String(index + 1).padStart(2, "0")}.${imageFileParts(image.mimeType).extension}`,
        kind: "file",
        summary: `slide ${index + 1}${image.width && image.height ? ` · ${image.width}×${image.height}` : ""} · id ${image._id}`,
      }));
    }
    return null;
  },
  read: async (ctx, accountId, segments): Promise<WorkspaceFile | null> => {
    if (segments.length < 2) return null;
    const projects = await loadProjects(ctx, accountId);
    const project = resolveByName(segments[0]!, projects);
    if (!project) return null;

    if (segments.length === 2 && segments[1] === "status.json") {
      const document = await activeDocument(ctx, project);
      const scheduled = project.postId
        ? (
            await ctx.db
              .query("scheduledPosts")
              .withIndex("by_account_scheduledFor", (q) => q.eq("accountId", accountId))
              .collect()
          ).find((item) => item.postId === project.postId)
        : undefined;
      return jsonFile({
        projectId: project._id,
        title: project.title,
        status: project.status,
        origin: project.origin,
        lastError: project.lastError ?? null,
        reviewStatus: document?.reviewStatus ?? null,
        reviewSummary: document?.reviewSummary ?? null,
        publication: scheduled
          ? {
              scheduledPostId: scheduled._id,
              scheduledFor: formatDate(scheduled.scheduledFor),
              status: scheduled.status,
              lastError: scheduled.lastError ?? null,
            }
          : null,
      });
    }
    if (segments.length === 2 && segments[1] === "brief.json" && project.briefSnapshotJson) {
      try {
        return jsonFile(JSON.parse(project.briefSnapshotJson));
      } catch {
        return { kind: "text", text: project.briefSnapshotJson };
      }
    }
    if (segments.length === 2 && (segments[1] === "slides.md" || segments[1] === "caption.md")) {
      const document = await activeDocument(ctx, project);
      if (!document) return null;
      if (segments[1] === "slides.md") return { kind: "text", text: slidesMarkdown(document) };
      return {
        kind: "text",
        text: `# Legenda\n\n${document.caption}\n\n## Acessibilidade\n\n${document.accessibilityDescription}`,
      };
    }
    if (segments.length === 3 && segments[1] === "renders") {
      const renders = await renderImages(ctx, project);
      const index = Number.parseInt(segments[2]!, 10) - 1;
      const image = Number.isNaN(index) ? null : (renders[index] ?? null);
      if (!image) return null;
      const url = await imageUrl(ctx, image);
      if (!url) return null;
      return {
        kind: "image",
        header: `Slide renderizado ${index + 1}/${renders.length} de "${project.title}" · imageId ${image._id}`,
        url,
        mimeType: imageFileParts(image.mimeType).mimeType,
      };
    }
    return null;
  },
};
