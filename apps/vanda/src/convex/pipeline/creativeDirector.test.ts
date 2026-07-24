import { describe, expect, it } from "vitest";
import type {
  BriefReview,
  BriefSelection,
  CreativeDirection,
  CreativeDirectorSource,
} from "./creativeDirector";
import {
  scoreCreativeDirection,
  validateCreativePackage,
  validateDirectionSet,
} from "./creativeDirector";

const direction = (title: string, angle: string, hook: string): CreativeDirection => ({
  title,
  concept: `Conceito independente para ${title}`,
  objective: "Educar",
  targetAudience: "Pessoas considerando o serviço",
  angle,
  hook,
  narrativeArc: ["Problema", "Explicação", "Próximo passo"],
  visualDirection: "Tipografia editorial e diagramas abstratos",
  callToAction: "Conheça o processo",
  brandFactIds: ["fact-1"],
  requiredAssets: [{ kind: "illustration", description: "Diagrama", strategy: "generate" }],
  retainedMechanisms: ["contraste inicial"],
  avoidedSourceElements: ["história pessoal do criador"],
  brandFitScore: 0.9,
  evidenceFitScore: 0.8,
  noveltyScore: 0.85,
  feasibilityScore: 0.95,
  riskScore: 0.1,
});

const directions = [
  direction("Mitos do processo", "Corrigir uma crença", "Nem tudo que parece complexo é arriscado"),
  direction("Mapa de decisão", "Orientar uma escolha", "Três sinais para decidir com segurança"),
  direction("Bastidores da técnica", "Mostrar o método", "O que acontece antes do primeiro passo"),
] as const;

const source: CreativeDirectorSource = {
  sourceCaption: "Minha história pessoal durante uma cirurgia específica.",
  transcript: "Eu vou contar exatamente como aconteceu comigo naquele dia.",
  visualDescription: "Pessoa falando para a câmera.",
  frameEvidence: [],
  triggerReason: "crescimento de visualizações",
};

const selection: BriefSelection = {
  selectedDirectionNumber: 2,
  selectionReason: "Melhor equilíbrio",
  tradeoffs: ["Menos emocional"],
  rejectedDirectionReasons: ["Risco maior", "Depende de bastidores"],
  brief: {
    title: "Mapa de decisão",
    objective: "Educar",
    targetAudience: "Pessoas considerando o serviço",
    format: "carousel",
    coreMessage: "Critérios claros reduzem incerteza.",
    audiencePromise: "Saber qual próximo passo considerar.",
    angle: "Orientação prática",
    hook: "Três sinais para decidir com segurança",
    narrativeBeats: [
      {
        position: 1,
        role: "hook",
        intent: "Abrir curiosidade",
        keyMessage: "A decisão começa pelos sinais certos.",
        visualInstruction: "Título e três marcadores abstratos.",
      },
      {
        position: 2,
        role: "body",
        intent: "Explicar",
        keyMessage: "Apresente os critérios confirmados pela marca.",
        visualInstruction: "Diagrama simples sem imagens da fonte.",
      },
      {
        position: 3,
        role: "cta",
        intent: "Orientar",
        keyMessage: "Conheça o processo.",
        visualInstruction: "CTA com identidade da marca.",
      },
    ],
    visualSystem: "Editorial",
    tone: ["claro", "responsável"],
    callToAction: "Conheça o processo",
    brandFactIds: ["fact-1"],
    sourceMechanisms: ["contraste inicial"],
    excludedSourceElements: ["história pessoal"],
    assetRequirements: [{ kind: "illustration", description: "Diagrama", strategy: "generate" }],
    restrictionsApplied: ["não prometer resultado"],
    productionNotes: ["usar somente fatos confirmados"],
    confidence: 0.85,
  },
};

const approvedReview: BriefReview = {
  decision: "approved",
  summary: "Brief original e fundamentado.",
  brandGrounding: [{ factId: "fact-1", usage: "Tom responsável" }],
  unsupportedClaims: [],
  similarityRisks: [],
  missingAssets: [],
  issues: [],
  confidence: 0.9,
};

describe("creative director validation", () => {
  it("scores a feasible, on-brand direction above a risky one", () => {
    const strong = scoreCreativeDirection(directions[0]);
    const risky = scoreCreativeDirection({
      ...directions[0],
      brandFitScore: 0.3,
      feasibilityScore: 0.2,
      riskScore: 1,
    });
    expect(strong).toBeGreaterThan(risky);
  });

  it("requires exactly three materially different directions", () => {
    expect(validateDirectionSet(directions)).toEqual([]);
    expect(validateDirectionSet(directions.slice(0, 2))).toContain("direction_count_must_be_three");
    expect(validateDirectionSet([directions[0], directions[0], directions[2]])).toContain(
      "directions_1_2_too_similar",
    );
  });

  it("accepts an original grounded package", () => {
    expect(
      validateCreativePackage({
        source,
        directions,
        selection,
        review: approvedReview,
        allowedBrandFactIds: new Set(["fact-1"]),
        referenceAssetCount: 0,
      }),
    ).toMatchObject({ valid: true });
  });

  it("rejects unknown brand facts and editorial risks", () => {
    const result = validateCreativePackage({
      source,
      directions,
      selection: {
        ...selection,
        brief: { ...selection.brief, brandFactIds: ["invented-fact"] },
      },
      review: {
        ...approvedReview,
        decision: "rejected",
        unsupportedClaims: ["resultado garantido"],
      },
      allowedBrandFactIds: new Set(["fact-1"]),
      referenceAssetCount: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "unknown_brand_fact:invented-fact",
        "editorial_review_rejected",
        "unsupported_claims",
      ]),
    );
  });
});
