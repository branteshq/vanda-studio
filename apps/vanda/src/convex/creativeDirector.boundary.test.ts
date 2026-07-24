// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const analysis = {
  sourceSummary: "Uma lista curta de erros",
  hook: { type: "lista", mechanism: "número concreto", evidence: "texto inicial" },
  tension: "evitar uma decisão ruim",
  audiencePromise: "decidir com critérios",
  narrativeBeats: [{ role: "hook", description: "apresenta três erros" }],
  proof: "exemplos observáveis",
  payoff: "checklist prático",
  callToAction: "salvar",
  pacing: { tempo: "rápido", progression: "linear", patternInterrupts: ["título"] },
  visualGrammar: {
    composition: "texto e ícones",
    motion: "cortes",
    textTreatment: "títulos curtos",
    recurringDevices: ["números"],
  },
  reusableMechanisms: ["lista numerada"],
  creatorSpecificElements: ["história pessoal"],
  performanceHypotheses: [{ hypothesis: "clareza inicial", evidence: ["título"], confidence: 0.7 }],
  uncertainties: ["retenção indisponível"],
  adaptable: true,
  rejectionReason: "",
  confidence: 0.8,
};

const direction = (title: string) => ({
  title,
  concept: `Conceito ${title}`,
  objective: "Educar",
  targetAudience: "Proprietários",
  angle: title,
  hook: `Hook ${title}`,
  narrativeArc: ["abertura", "corpo", "fecho"],
  visualDirection: "Editorial",
  callToAction: "Salvar",
  brandFactIds: ["fact-1"],
  requiredAssets: [
    {
      kind: "illustration",
      description: "Ícone",
      strategy: "generate" as const,
      assetIds: [],
    },
  ],
  retainedMechanisms: ["lista"],
  avoidedSourceElements: ["história"],
  brandFitScore: 0.9,
  evidenceFitScore: 0.8,
  noveltyScore: 0.8,
  feasibilityScore: 0.9,
  riskScore: 0.1,
  totalScore: 80,
});

const brief = {
  title: "Mapa de decisão",
  objective: "Educar",
  targetAudience: "Proprietários",
  format: "carousel" as const,
  coreMessage: "Critérios claros ajudam a decidir.",
  audiencePromise: "Entender o próximo passo.",
  angle: "Mapa prático",
  hook: "Três critérios antes de decidir",
  narrativeBeats: [1, 2, 3].map((position) => ({
    position,
    role: position === 1 ? "hook" : position === 3 ? "cta" : "body",
    intent: "orientar",
    keyMessage: `Mensagem ${position}`,
    visualInstruction: `Visual ${position}`,
  })),
  visualSystem: "Editorial",
  tone: ["claro"],
  callToAction: "Salvar",
  brandFactIds: ["fact-1"],
  sourceMechanisms: ["lista"],
  excludedSourceElements: ["história"],
  assetRequirements: [
    {
      kind: "illustration",
      description: "Ícone",
      strategy: "generate" as const,
      assetIds: [],
    },
  ],
  restrictionsApplied: ["sem garantias"],
  productionNotes: ["usar fatos confirmados"],
  confidence: 0.85,
};

const seedQualifiedOpportunity = async (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const now = Date.now();
    const accountId = await ctx.db.insert("accounts", {
      mode: "needs_approval",
      createdAt: now,
      updatedAt: now,
    });
    const creatorId = await ctx.db.insert("marketCreators", {
      accountId,
      handle: "criador",
      profileUrl: "https://instagram.com/criador",
      private: false,
      verified: false,
      relevanceScore: 0.9,
      relevanceReason: "mesmo mercado",
      status: "active",
      discoveredAt: now,
      updatedAt: now,
    });
    const postId = await ctx.db.insert("marketPosts", {
      accountId,
      creatorId,
      externalPostId: "source-1",
      permalink: "https://instagram.com/reel/source-1",
      mediaType: "Video",
      publishedAt: now,
      firstObservedAt: now,
      lastObservedAt: now,
    });
    const dossierId = await ctx.db.insert("sourceDossiers", {
      accountId,
      marketPostId: postId,
      status: "ready",
      frameStorageIds: [],
      hasUsableVideo: true,
      hasUsableTranscript: true,
      hasUsableCaption: true,
      hasUsableVisualEvidence: true,
      qualityScore: 90,
      rejectionCodes: [],
      createdAt: now,
      updatedAt: now,
    });
    const opportunityId = await ctx.db.insert("opportunities", {
      accountId,
      marketPostId: postId,
      dossierId,
      status: "ready_for_analysis",
      score: 90,
      triggerType: "audience_ratio",
      triggerReason: "4× audiência",
      triggeredAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, opportunityId };
  });

describe("creative director persistence", () => {
  it("persists the complete reviewed decision chain", async () => {
    const t = convexTest(schema, modules);
    const { opportunityId } = await seedQualifiedOpportunity(t);
    const analysisId = await t.mutation(internal.market.saveCreativeAnalysis, {
      opportunityId,
      model: "test",
      promptVersion: "test-v1",
      ...analysis,
    });
    const directionIds = await t.mutation(internal.market.saveCreativeDirections, {
      opportunityId,
      analysisId,
      model: "test",
      promptVersion: "test-v1",
      directions: [direction("Prático"), direction("Narrativo"), direction("Contraste")],
    });
    const briefId = await t.mutation(internal.market.saveCreativeBrief, {
      opportunityId,
      analysisId,
      selectedDirectionId: directionIds[0]!,
      selectionReason: "Maior adequação",
      tradeoffs: ["menos emocional"],
      rejectedDirectionReasons: ["menos viável", "mais arriscada"],
      model: "test",
      promptVersion: "test-v1",
      reviewModel: "review-test",
      reviewPromptVersion: "review-v1",
      deterministicIssues: [],
      sourceSimilarity: 0.1,
      ...brief,
      reviewDecision: "approved",
      reviewSummary: "Original e fundamentado",
      brandGrounding: [{ factId: "fact-1", usage: "tom" }],
      unsupportedClaims: [],
      similarityRisks: [],
      missingAssets: [],
      reviewIssues: [],
      reviewConfidence: 0.9,
    });
    const state = await t.run(async (ctx) => ({
      opportunity: await ctx.db.get(opportunityId),
      analysis: await ctx.db.get(analysisId),
      directions: await Promise.all(directionIds.map((id) => ctx.db.get(id))),
      brief: await ctx.db.get(briefId),
    }));
    expect(state.opportunity?.status).toBe("ready_for_production");
    expect(state.opportunity?.creativeBriefId).toBe(briefId);
    expect(state.analysis?.status).toBe("accepted");
    expect(state.directions).toHaveLength(3);
    expect(state.brief?.status).toBe("ready");
  });

  it("stops an opportunity when the mechanism cannot be honestly adapted", async () => {
    const t = convexTest(schema, modules);
    const { opportunityId } = await seedQualifiedOpportunity(t);
    await t.mutation(internal.market.saveCreativeAnalysis, {
      opportunityId,
      model: "test",
      promptVersion: "test-v1",
      ...analysis,
      adaptable: false,
      rejectionReason: "Depende integralmente da história pessoal do criador.",
    });
    const opportunity = await t.run((ctx) => ctx.db.get(opportunityId));
    expect(opportunity?.status).toBe("rejected");
    expect(opportunity?.creativeRejectionReason).toContain("história pessoal");
  });
});
