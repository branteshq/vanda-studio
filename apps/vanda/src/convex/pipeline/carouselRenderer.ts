import type { CarouselDocumentPlan, CarouselSlide } from "./contentStudio";
import type { VisualBrandPlan } from "./visualBrand";

const WIDTH = 1080;
const HEIGHT = 1350;
const SAFE_X = 84;
const SAFE_TOP = 76;
const SAFE_BOTTOM = 82;

export interface RenderVisual {
  readonly dataUrl: string;
  readonly mimeType: string;
}

export interface RenderedSlideSvg {
  readonly svg: string;
  readonly diagnostics: ReadonlyArray<string>;
}

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const fontFamily = (family: VisualBrandPlan["typography"]["headline"]): string =>
  family === "editorial_serif"
    ? "Georgia, serif"
    : family === "humanist_sans"
      ? "Trebuchet MS, Arial, sans-serif"
      : "Arial, Helvetica, sans-serif";

const fontWeight = (weight: VisualBrandPlan["typography"]["weight"]): number =>
  ({ regular: 400, medium: 500, bold: 700, black: 900 })[weight];

const wrapText = (text: string, maxCharacters: number): ReadonlyArray<string> => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line === "") {
      line = word;
      continue;
    }
    if ([...`${line} ${word}`].length <= maxCharacters) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
};

const textLines = (input: {
  readonly lines: ReadonlyArray<string>;
  readonly x: number;
  readonly y: number;
  readonly lineHeight: number;
  readonly fontSize: number;
  readonly fill: string;
  readonly family: string;
  readonly weight: number;
  readonly letterSpacing?: number;
}): string =>
  input.lines
    .map(
      (line, index) =>
        `<text x="${input.x}" y="${input.y + index * input.lineHeight}" ` +
        `font-family="${escapeXml(input.family)}" font-size="${input.fontSize}" ` +
        `font-weight="${input.weight}" fill="${input.fill}" ` +
        `letter-spacing="${input.letterSpacing ?? 0}">${escapeXml(line)}</text>`,
    )
    .join("");

const localizeLabel = (label: string): string => {
  const normalized = label.trim().toLocaleLowerCase();
  const labels: Record<string, string> = {
    context: "contexto",
    content: "conteúdo",
    proof: "sobre a marca",
    insight: "ponto-chave",
    problem: "contexto",
    solution: "abordagem",
    cover: "capa",
    cta: "próximo passo",
  };
  return labels[normalized] ?? label;
};

const decorativeMotif = (accent: string, muted: string): string =>
  `<circle cx="950" cy="150" r="170" fill="none" stroke="${accent}" stroke-width="2" opacity="0.35"/>` +
  `<circle cx="950" cy="150" r="118" fill="none" stroke="${muted}" stroke-width="1" opacity="0.28"/>` +
  `<path d="M70 1220 H1010" stroke="${muted}" stroke-width="1" opacity="0.25"/>`;

const visualPanel = (visual: RenderVisual | undefined, id: string): string =>
  visual
    ? `<defs><clipPath id="${id}"><rect x="610" y="214" width="386" height="760" rx="30"/></clipPath></defs>` +
      `<image href="${visual.dataUrl}" x="610" y="214" width="386" height="760" ` +
      `preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
    : `<rect x="610" y="214" width="386" height="760" rx="30" fill="currentColor" opacity="0.06"/>` +
      `<path d="M675 720 C760 560 840 850 950 590" fill="none" stroke="currentColor" stroke-width="3" opacity="0.18"/>`;

const renderCover = (
  slide: CarouselSlide,
  document: CarouselDocumentPlan,
  profile: VisualBrandPlan,
  visual: RenderVisual | undefined,
): RenderedSlideSvg => {
  const palette = profile.palette;
  const headline = wrapText(slide.headline, 22);
  const body = wrapText(slide.body, 42);
  const diagnostics: string[] = [];
  if (headline.length > 5) diagnostics.push("cover_headline_exceeds_five_lines");
  const background = slide.role === "cta" ? palette.accent : palette.background;
  const foreground = slide.role === "cta" ? palette.accentContrast : palette.text;
  const visualMarkup = visual
    ? `<image href="${visual.dataUrl}" x="0" y="0" width="1080" height="1350" preserveAspectRatio="xMidYMid slice"/>` +
      `<rect width="1080" height="1350" fill="url(#coverOverlay)"/>`
    : decorativeMotif(palette.accent, palette.muted);
  const overlay = visual
    ? `<defs><linearGradient id="coverOverlay" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${background}" stop-opacity="0.18"/>` +
      `<stop offset="0.52" stop-color="${background}" stop-opacity="0.52"/>` +
      `<stop offset="1" stop-color="${background}" stop-opacity="0.98"/>` +
      `</linearGradient></defs>`
    : "";
  const titleY = Math.max(630, 1030 - headline.length * 92);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `${overlay}<rect width="1080" height="1350" fill="${background}"/>${visualMarkup}` +
    `<rect x="${SAFE_X}" y="${SAFE_TOP}" width="54" height="8" rx="4" fill="${palette.accent}"/>` +
    (slide.kicker
      ? textLines({
          lines: [localizeLabel(slide.kicker).toLocaleUpperCase()],
          x: SAFE_X,
          y: 154,
          lineHeight: 28,
          fontSize: 24,
          fill: foreground,
          family: fontFamily(profile.typography.body),
          weight: 700,
          letterSpacing: 2.2,
        })
      : "") +
    textLines({
      lines: headline,
      x: SAFE_X,
      y: titleY,
      lineHeight: 92,
      fontSize: 78,
      fill: foreground,
      family: fontFamily(profile.typography.headline),
      weight: fontWeight(profile.typography.weight),
      letterSpacing: -2,
    }) +
    textLines({
      lines: body.slice(0, 4),
      x: SAFE_X,
      y: titleY + headline.length * 92 + 36,
      lineHeight: 42,
      fontSize: 30,
      fill: foreground,
      family: fontFamily(profile.typography.body),
      weight: 400,
    }) +
    `<text x="${SAFE_X}" y="1270" font-family="${fontFamily(profile.typography.body)}" font-size="22" fill="${foreground}" opacity="0.76">${slide.position.toString().padStart(2, "0")} / ${document.slides.length.toString().padStart(2, "0")}</text>` +
    `</svg>`;
  return { svg, diagnostics };
};

const renderContent = (
  slide: CarouselSlide,
  document: CarouselDocumentPlan,
  profile: VisualBrandPlan,
  visual: RenderVisual | undefined,
): RenderedSlideSvg => {
  const palette = profile.palette;
  const headline = wrapText(slide.headline, visual ? 20 : 27);
  const body = wrapText(slide.body, visual ? 35 : 48);
  const diagnostics: string[] = [];
  if (headline.length > 4) diagnostics.push("headline_exceeds_four_lines");
  const copyWidth = visual ? 455 : 820;
  const headlineY = 258;
  const headlineBottom = headlineY + headline.length * 72;
  let cursor = headlineBottom + 42;
  const bodyMarkup = textLines({
    lines: body.slice(0, 7),
    x: SAFE_X,
    y: cursor,
    lineHeight: 40,
    fontSize: 28,
    fill: palette.text,
    family: fontFamily(profile.typography.body),
    weight: 400,
  });
  cursor += Math.min(body.length, 7) * 40 + (body.length ? 30 : 0);
  const bulletMarkup = slide.bullets
    .slice(0, 5)
    .map((bullet) => {
      const lines = wrapText(bullet, visual ? 31 : 44).slice(0, 3);
      const markup =
        `<circle cx="${SAFE_X + 8}" cy="${cursor - 8}" r="5" fill="${palette.accent}"/>` +
        textLines({
          lines,
          x: SAFE_X + 28,
          y: cursor,
          lineHeight: 36,
          fontSize: 25,
          fill: palette.text,
          family: fontFamily(profile.typography.body),
          weight: 500,
        });
      cursor += lines.length * 36 + 24;
      return markup;
    })
    .join("");
  if (cursor > HEIGHT - SAFE_BOTTOM - 90) diagnostics.push("copy_exceeds_safe_zone");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect width="1080" height="1350" fill="${palette.background}"/>` +
    decorativeMotif(palette.accent, palette.muted) +
    `<rect x="${SAFE_X}" y="${SAFE_TOP}" width="54" height="8" rx="4" fill="${palette.accent}"/>` +
    `<text x="${SAFE_X}" y="158" font-family="${fontFamily(profile.typography.body)}" font-size="22" font-weight="700" letter-spacing="1.8" fill="${palette.muted}">${escapeXml(
      localizeLabel(slide.kicker || slide.role).toLocaleUpperCase(),
    )}</text>` +
    textLines({
      lines: headline,
      x: SAFE_X,
      y: headlineY,
      lineHeight: 72,
      fontSize: 58,
      fill: palette.text,
      family: fontFamily(profile.typography.headline),
      weight: fontWeight(profile.typography.weight),
      letterSpacing: -1.2,
    }) +
    bodyMarkup +
    bulletMarkup +
    (visual ? visualPanel(visual, `visual-${slide.position}`) : "") +
    `<rect x="${SAFE_X}" y="1245" width="${copyWidth}" height="1" fill="${palette.muted}" opacity="0.4"/>` +
    `<text x="${SAFE_X}" y="1290" font-family="${fontFamily(profile.typography.body)}" font-size="21" fill="${palette.muted}">${slide.position.toString().padStart(2, "0")} / ${document.slides.length.toString().padStart(2, "0")}</text>` +
    `</svg>`;
  return { svg, diagnostics };
};

export const renderCarouselSlideSvg = (input: {
  readonly document: CarouselDocumentPlan;
  readonly slide: CarouselSlide;
  readonly profile: VisualBrandPlan;
  readonly visual?: RenderVisual | undefined;
}): RenderedSlideSvg =>
  input.slide.role === "cover" || input.slide.role === "cta"
    ? renderCover(input.slide, input.document, input.profile, input.visual)
    : renderContent(input.slide, input.document, input.profile, input.visual);
