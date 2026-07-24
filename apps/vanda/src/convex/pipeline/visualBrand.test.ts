import { describe, expect, it } from "vitest";
import { contrastRatio, validateVisualBrand, type VisualBrandPlan } from "./visualBrand";

const plan: VisualBrandPlan = {
  name: "Editorial humano",
  rationale: "Sistema de produção claro e acolhedor.",
  palette: {
    background: "#F5F0E8",
    surface: "#FFFFFF",
    text: "#191717",
    muted: "#746F69",
    accent: "#7A244E",
    accentContrast: "#FFFFFF",
  },
  typography: { headline: "editorial_serif", body: "humanist_sans", weight: "bold" },
  artDirection: "Editorial com bastante respiro.",
  motifs: ["linhas finas", "formas orgânicas"],
  photoTreatment: "warm",
  avoid: ["gradientes decorativos"],
};

describe("visual brand validation", () => {
  it("accepts palettes with readable text and accent contrast", () => {
    const result = validateVisualBrand(plan);
    expect(result.valid).toBe(true);
    expect(result.textContrast).toBeGreaterThanOrEqual(4.5);
    expect(result.accentContrast).toBeGreaterThanOrEqual(4.5);
  });

  it("rejects malformed and unreadable palettes", () => {
    const result = validateVisualBrand({
      ...plan,
      palette: { ...plan.palette, text: "#FFFFFF", accentContrast: "pink" },
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "invalid_color:accentContrast",
        "insufficient_text_contrast",
        "insufficient_accent_contrast",
      ]),
    );
  });

  it("calculates WCAG contrast deterministically", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("bad", "#FFFFFF")).toBe(0);
  });
});
