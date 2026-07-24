import { describe, expect, it } from "vitest";
import {
  type CarouselDocumentPlan,
  type CarouselDocumentReview,
  replaceCarouselSlide,
  validateCarouselDocument,
} from "./contentStudio";

const slide = (position: number, role: "cover" | "content" | "cta") => ({
  slideId: `slide-${position}`,
  position,
  role,
  layout:
    role === "cover"
      ? ("statement" as const)
      : role === "cta"
        ? ("cta" as const)
        : ("list" as const),
  kicker: position === 1 ? "GUIA RÁPIDO" : "",
  headline: `Mensagem ${position}`,
  body: position === 2 ? "Uma explicação curta e fundamentada." : "",
  bullets: position === 2 ? ["Critério um", "Critério dois"] : [],
  factIds: ["fact-1"],
  visual: {
    kind: "illustration" as const,
    strategy: "generate" as const,
    assetIds: [],
    prompt: `Ilustração abstrata para o slide ${position}`,
    altText: `Ilustração abstrata do slide ${position}`,
    treatment: "inset" as const,
  },
  productionNotes: [],
});

const document: CarouselDocumentPlan = {
  title: "Mapa de decisão",
  caption: "Três critérios para orientar sua próxima decisão.",
  accessibilityDescription: "Carrossel com três critérios apresentados em texto e ilustrações.",
  canvas: { preset: "instagram_portrait_4_5", width: 1080, height: 1350 },
  style: {
    theme: "brand",
    density: "balanced",
    headlineCase: "sentence",
    cornerStyle: "soft",
    imageTreatment: "none",
    motifs: ["linhas editoriais"],
    referenceAssetIds: ["asset-1"],
  },
  brandFactIds: ["fact-1"],
  slides: [slide(1, "cover"), slide(2, "content"), slide(3, "cta")],
};

const review: CarouselDocumentReview = {
  decision: "approved",
  summary: "Documento fundamentado e produzível.",
  unsupportedClaims: [],
  brandIssues: [],
  similarityRisks: [],
  productionIssues: [],
  corrections: [],
  confidence: 0.9,
};

const validate = (
  candidate: CarouselDocumentPlan = document,
  candidateReview: CarouselDocumentReview = review,
) =>
  validateCarouselDocument({
    document: candidate,
    review: candidateReview,
    allowedBrandFactIds: new Set(["fact-1"]),
    allowedAssetIds: new Set(["asset-1"]),
    source: {
      caption: "Uma lista sobre outro contexto",
      transcript: "Primeiro ponto, segundo ponto e terceiro ponto.",
      onScreenText: ["3 pontos"],
    },
  });

describe("carousel document validation", () => {
  it("accepts a grounded, concise, renderable document", () => {
    expect(validate()).toMatchObject({ valid: true, readyForRender: true, issues: [] });
  });

  it("rejects invalid order, unknown facts, and unavailable owner assets", () => {
    const result = validate({
      ...document,
      slides: [
        { ...slide(1, "content"), factIds: ["invented-fact"] },
        slide(3, "cta"),
        {
          ...slide(3, "cta"),
          slideId: "duplicate",
          visual: {
            ...slide(3, "cta").visual,
            strategy: "needs_owner",
            prompt: "",
          },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "first_slide_must_be_cover",
        "slide_position_mismatch:slide-3",
        "unknown_slide_fact:slide-1:invented-fact",
        "owner_asset_required:duplicate",
      ]),
    );
  });

  it("rejects editorial findings even when the shape is valid", () => {
    const result = validate(document, {
      ...review,
      decision: "rejected",
      unsupportedClaims: ["economia garantida"],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining(["editorial_review_rejected", "unsupported_claims"]),
    );
  });

  it("replaces one stable slide without changing the rest of the document", () => {
    const replacement = { ...slide(2, "content"), headline: "Novo título" };
    const result = replaceCarouselSlide(document, replacement);
    expect(result.slides.map((item) => item.headline)).toEqual([
      "Mensagem 1",
      "Novo título",
      "Mensagem 3",
    ]);
    expect(document.slides[1]?.headline).toBe("Mensagem 2");
  });
});
