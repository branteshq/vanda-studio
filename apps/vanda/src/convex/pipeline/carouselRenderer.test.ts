import { intToRGBA, Jimp } from "jimp";
import { describe, expect, it } from "vitest";
import type { CarouselDocumentPlan } from "./contentStudio";
import { renderCarouselSlideSvg } from "./carouselRenderer";
import type { VisualBrandPlan } from "./visualBrand";
import { rasterizeCarouselJpeg } from "../contentStudioRender";

const profile: VisualBrandPlan = {
  name: "Editorial",
  rationale: "Teste",
  palette: {
    background: "#F5F2EE",
    surface: "#FFFFFF",
    text: "#171417",
    muted: "#6F696D",
    accent: "#8A2859",
    accentContrast: "#FFFFFF",
  },
  typography: { headline: "modern_sans", body: "humanist_sans", weight: "bold" },
  artDirection: "Editorial",
  motifs: ["linhas", "círculos"],
  photoTreatment: "natural",
  avoid: [],
};

const document: CarouselDocumentPlan = {
  title: "Teste",
  caption: "Legenda",
  accessibilityDescription: "Descrição",
  canvas: { preset: "instagram_portrait_4_5", width: 1080, height: 1350 },
  style: {
    theme: "brand",
    density: "balanced",
    headlineCase: "sentence",
    cornerStyle: "soft",
    imageTreatment: "natural",
    motifs: [],
    referenceAssetIds: [],
  },
  brandFactIds: [],
  slides: [
    {
      slideId: "slide-1",
      position: 1,
      role: "cover",
      layout: "statement",
      kicker: "Guia",
      headline: "Uma abertura clara & útil",
      body: "",
      bullets: [],
      factIds: [],
      visual: {
        kind: "illustration",
        strategy: "generate",
        assetIds: [],
        prompt: "abstrato",
        altText: "abstrato",
        treatment: "full_bleed",
      },
      productionNotes: [],
    },
    {
      slideId: "slide-2",
      position: 2,
      role: "content",
      layout: "list",
      kicker: "Passo 1",
      headline: "Organize antes de decidir",
      body: "Uma explicação curta para orientar a leitura.",
      bullets: ["Primeiro critério", "Segundo critério"],
      factIds: [],
      visual: {
        kind: "diagram",
        strategy: "generate",
        assetIds: [],
        prompt: "diagrama",
        altText: "diagrama",
        treatment: "inset",
      },
      productionNotes: [],
    },
    {
      slideId: "slide-3",
      position: 3,
      role: "cta",
      layout: "cta",
      kicker: "",
      headline: "Salve para consultar depois",
      body: "",
      bullets: [],
      factIds: [],
      visual: {
        kind: "none",
        strategy: "not_needed",
        assetIds: [],
        prompt: "",
        altText: "",
        treatment: "none",
      },
      productionNotes: [],
    },
  ],
};

describe("carousel SVG renderer", () => {
  it("renders an Instagram-sized cover and escapes copy", () => {
    const result = renderCarouselSlideSvg({ document, slide: document.slides[0]!, profile });
    expect(result.svg).toContain('width="1080" height="1350"');
    expect(result.svg).toContain("Uma abertura clara &amp;");
    expect(result.svg).toContain(">útil</text>");
    expect(result.svg).not.toContain("placeholder");
  });

  it("rasterizes typography with the bundled production font", async () => {
    const result = renderCarouselSlideSvg({ document, slide: document.slides[0]!, profile });
    const jpeg = await rasterizeCarouselJpeg(result.svg);
    const image = await Jimp.read(Buffer.from(jpeg));
    let darkPixels = 0;
    for (let y = 760; y < 1080; y += 2)
      for (let x = 60; x < 850; x += 2) {
        const color = image.getPixelColor(x, y);
        const { r, g, b } = intToRGBA(color);
        if (r < 90 && g < 90 && b < 90) darkPixels += 1;
      }
    expect(image.bitmap).toMatchObject({ width: 1080, height: 1350 });
    expect(darkPixels).toBeGreaterThan(500);
  });

  it("renders content hierarchy and bullets inside the document", () => {
    const result = renderCarouselSlideSvg({ document, slide: document.slides[1]!, profile });
    expect(result.svg).toContain("Organize antes de decidir");
    expect(result.svg).toContain("Primeiro critério");
    expect(result.diagnostics).toEqual([]);
  });

  it("reports copy that cannot fit the safe area", () => {
    const overloaded = {
      ...document.slides[1]!,
      body: "texto ".repeat(100),
      bullets: Array.from({ length: 5 }, () => "detalhe ".repeat(20)),
    };
    const result = renderCarouselSlideSvg({ document, slide: overloaded, profile });
    expect(result.diagnostics).toContain("copy_exceeds_safe_zone");
  });
});
