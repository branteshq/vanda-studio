import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import {
  entityName,
  formatDate,
  jsonFile,
  resolveByName,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceMount,
} from "../types";

const LISTING_CAP = 20;

const loadOpportunities = async (ctx: QueryCtx, accountId: Id<"accounts">) => {
  const opportunities = await ctx.db
    .query("opportunities")
    .withIndex("by_account_status", (q) => q.eq("accountId", accountId))
    .collect();
  return [...opportunities].sort((a, b) => b.createdAt - a.createdAt).slice(0, LISTING_CAP);
};

const opportunityContext = async (ctx: QueryCtx, opportunity: Doc<"opportunities">) => {
  const marketPost = await ctx.db.get(opportunity.marketPostId);
  const creator = marketPost ? await ctx.db.get(marketPost.creatorId) : null;
  return { marketPost, creator };
};

const opportunityTitle = (
  opportunity: Doc<"opportunities">,
  creator: { handle?: string } | null,
): string => creator?.handle ?? opportunity.triggerReason.split(/\s+/).slice(0, 4).join(" ");

const opportunityMarkdown = (
  opportunity: Doc<"opportunities">,
  context: Awaited<ReturnType<typeof opportunityContext>>,
): string => {
  const lines = [
    `# Oportunidade — ${opportunityTitle(opportunity, context.creator)}`,
    "",
    `Status: ${opportunity.status} · score ${opportunity.score.toFixed(2)} · detectada ${formatDate(opportunity.triggeredAt)}`,
    `Gatilho (${opportunity.triggerType}): ${opportunity.triggerReason}`,
  ];
  if (context.creator?.handle) lines.push(`Criador: @${context.creator.handle}`);
  if (context.marketPost?.permalink) lines.push(`Post original: ${context.marketPost.permalink}`);
  if (context.marketPost?.caption) {
    lines.push("", "## Legenda original (trecho)", "", context.marketPost.caption.slice(0, 400));
  }
  if (opportunity.whyItWorks) lines.push("", "## Por que funciona", "", opportunity.whyItWorks);
  if (opportunity.adaptedHook) {
    lines.push("", "## Adaptação para a marca", "", `Hook: ${opportunity.adaptedHook}`);
    for (const slide of opportunity.adaptedSlides ?? []) lines.push(`- ${slide}`);
  }
  if (opportunity.creativeRejectionReason) {
    lines.push("", `Rejeitada: ${opportunity.creativeRejectionReason}`);
  }
  lines.push("", "## Ids");
  lines.push(`- opportunityId: ${opportunity._id}`);
  if (opportunity.creativeBriefId) lines.push(`- creativeBriefId: ${opportunity.creativeBriefId}`);
  if (opportunity.contentProjectId) {
    lines.push(`- contentProjectId: ${opportunity.contentProjectId}`);
  }
  return lines.join("\n");
};

export const marketMount: WorkspaceMount = {
  root: "market",
  summary: "varredura de mercado: oportunidades detectadas, criadores e última execução",
  list: async (ctx, accountId, segments): Promise<WorkspaceEntry[] | null> => {
    if (segments.length === 0) {
      return [
        { name: "opportunities", kind: "dir", summary: "posts fora da curva, com evidência" },
        { name: "creators.json", kind: "file", summary: "criadores monitorados" },
        { name: "last-scan.json", kind: "file", summary: "última varredura: estágio e resultado" },
      ];
    }
    if (segments.length === 1 && segments[0] === "opportunities") {
      const opportunities = await loadOpportunities(ctx, accountId);
      return Promise.all(
        opportunities.map(async (opportunity) => {
          const { creator } = await opportunityContext(ctx, opportunity);
          return {
            name: `${entityName(opportunityTitle(opportunity, creator), opportunity._id)}.md`,
            kind: "file" as const,
            summary: `${opportunity.status} · score ${opportunity.score.toFixed(2)} · ${formatDate(opportunity.triggeredAt)} · id ${opportunity._id}`,
          };
        }),
      );
    }
    return null;
  },
  read: async (ctx, accountId, segments): Promise<WorkspaceFile | null> => {
    if (segments.length === 1 && segments[0] === "creators.json") {
      const creators = await ctx.db
        .query("marketCreators")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect();
      return jsonFile(
        creators.map((creator) => ({
          handle: creator.handle,
          status: creator.status,
          feedback: creator.feedback ?? null,
        })),
      );
    }
    if (segments.length === 1 && segments[0] === "last-scan.json") {
      const run = await ctx.db
        .query("marketRuns")
        .withIndex("by_account_started", (q) => q.eq("accountId", accountId))
        .order("desc")
        .first();
      if (!run) return jsonFile({ status: "nunca executada" });
      return jsonFile({
        runId: run._id,
        kind: run.kind,
        status: run.status,
        stage: run.stage,
        startedAt: formatDate(run.startedAt),
        completedAt: run.completedAt ? formatDate(run.completedAt) : null,
        creatorsFound: run.creatorsFound,
        postsObserved: run.postsObserved,
        opportunitiesDetected: run.opportunitiesDetected,
        summary: run.summary ?? null,
        error: run.error ?? null,
      });
    }
    if (segments.length === 2 && segments[0] === "opportunities") {
      const opportunities = await loadOpportunities(ctx, accountId);
      const opportunity = resolveByName(segments[1]!, opportunities);
      if (!opportunity) return null;
      const context = await opportunityContext(ctx, opportunity);
      return { kind: "text", text: opportunityMarkdown(opportunity, context) };
    }
    return null;
  },
};
