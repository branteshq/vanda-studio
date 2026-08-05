/**
 * The brand kit — /brand/kit.json. The account's visual identity as data:
 * exact colors, fonts, tagline. Stored as a workspace document; this module is
 * its per-target parser (the first projection-style write handler): writes are
 * validated and normalized so the file is always clean JSON both the owner's
 * kit card and the agent's code (exact hexes into run_code) can trust.
 * Shared by the brand mount (validation) and the perfil page (rendering).
 */

export interface BrandKitColor {
  hex: string;
  name?: string;
  role?: string;
}

export interface BrandKitFont {
  family: string;
  role?: string;
}

export interface BrandKit {
  colors: BrandKitColor[];
  fonts: BrandKitFont[];
  tagline?: string;
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const MAX_COLORS = 8;
const MAX_FONTS = 4;
const MAX_LABEL = 40;
const MAX_TAGLINE = 120;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const label = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LABEL) {
    throw new Error(`${field} deve ser um texto de até ${MAX_LABEL} caracteres`);
  }
  return value;
};

const parseColors = (value: unknown): BrandKitColor[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_COLORS) {
    throw new Error(`colors deve ser uma lista de até ${MAX_COLORS} cores`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.hex !== "string" || !HEX_PATTERN.test(entry.hex)) {
      throw new Error(`colors[${index}].hex deve ser um hex como "#d81b60"`);
    }
    const color: BrandKitColor = { hex: entry.hex.toLowerCase() };
    const name = label(entry.name, `colors[${index}].name`);
    const role = label(entry.role, `colors[${index}].role`);
    if (name !== undefined) color.name = name;
    if (role !== undefined) color.role = role;
    return color;
  });
};

const parseFonts = (value: unknown): BrandKitFont[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_FONTS) {
    throw new Error(`fonts deve ser uma lista de até ${MAX_FONTS} fontes`);
  }
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      typeof entry.family !== "string" ||
      entry.family.length === 0 ||
      entry.family.length > 60
    ) {
      throw new Error(`fonts[${index}].family deve ser o nome da fonte (ex.: "Poppins")`);
    }
    const font: BrandKitFont = { family: entry.family };
    const role = label(entry.role, `fonts[${index}].role`);
    if (role !== undefined) font.role = role;
    return font;
  });
};

const SHAPE_HELP =
  'formato: {"colors":[{"hex":"#d81b60","name":"rosa","role":"primária"}],"fonts":[{"family":"Poppins","role":"títulos"}],"tagline":"..."}';

/**
 * Validate a kit write. Returns the normalized JSON to store (stable key
 * order, lowercase hexes) or a shape error that teaches the correct format.
 */
export const validateBrandKit = (
  content: string,
): { ok: true; normalized: string } | { ok: false; error: string } => {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { ok: false, error: `kit.json precisa ser JSON válido — ${SHAPE_HELP}` };
  }
  if (!isRecord(raw)) return { ok: false, error: `kit.json precisa ser um objeto — ${SHAPE_HELP}` };
  const unknown = Object.keys(raw).filter(
    (key) => !["colors", "fonts", "tagline"].includes(key),
  );
  if (unknown.length > 0) {
    return { ok: false, error: `campo desconhecido: ${unknown[0]} — ${SHAPE_HELP}` };
  }
  try {
    const kit: BrandKit = { colors: parseColors(raw.colors), fonts: parseFonts(raw.fonts) };
    if (raw.tagline !== undefined) {
      if (typeof raw.tagline !== "string" || raw.tagline.length > MAX_TAGLINE) {
        return { ok: false, error: `tagline deve ser um texto de até ${MAX_TAGLINE} caracteres` };
      }
      kit.tagline = raw.tagline;
    }
    return { ok: true, normalized: JSON.stringify(kit, null, 2) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** Lenient read-side parse for rendering; null when the text isn't a kit. */
export const parseBrandKit = (text: string): BrandKit | null => {
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw)) return null;
    return {
      colors: Array.isArray(raw.colors)
        ? raw.colors.filter(
            (color): color is BrandKitColor =>
              isRecord(color) && typeof color.hex === "string" && HEX_PATTERN.test(color.hex),
          )
        : [],
      fonts: Array.isArray(raw.fonts)
        ? raw.fonts.filter(
            (font): font is BrandKitFont => isRecord(font) && typeof font.family === "string",
          )
        : [],
      ...(typeof raw.tagline === "string" && raw.tagline.length > 0
        ? { tagline: raw.tagline }
        : {}),
    };
  } catch {
    return null;
  }
};
