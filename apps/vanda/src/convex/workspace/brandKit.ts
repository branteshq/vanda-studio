/**
 * The brand kit — /brand/kit.json. The account's visual identity as data:
 * exact colors, fonts, tagline. Stored as a workspace document; this module is
 * its per-target parser (the first projection-style write handler): writes are
 * validated and normalized so the file is always clean JSON both the owner's
 * kit card and the agent's image prompts can trust.
 * Shared by the brand mount (validation) and the perfil page (rendering).
 */
import { z } from "zod";

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

const recordSchema = z.record(z.string(), z.json());

const optionalStringSchema = z.string().optional();

type BrandKitField = z.infer<typeof recordSchema>[string] | undefined;

const label = (value: z.infer<typeof optionalStringSchema>, field: string): string | undefined => {
  if (value === undefined) return undefined;

  if (value.length === 0 || value.length > MAX_LABEL) {
    throw new Error(`${field} deve ser um texto de até ${MAX_LABEL} caracteres`);
  }

  return value;
};

const parseColors = (value: BrandKitField): BrandKitColor[] => {
  if (value === undefined) return [];

  const entries = z.array(recordSchema).safeParse(value);

  if (!entries.success || entries.data.length > MAX_COLORS) {
    throw new Error(`colors deve ser uma lista de até ${MAX_COLORS} cores`);
  }

  return entries.data.map((entry, index) => {
    const hex = z.string().safeParse(entry.hex);

    if (!hex.success || !HEX_PATTERN.test(hex.data)) {
      throw new Error(`colors[${index}].hex deve ser um hex como "#d81b60"`);
    }

    const color: BrandKitColor = { hex: hex.data.toLowerCase() };
    const name = label(optionalStringSchema.parse(entry.name), `colors[${index}].name`);
    const role = label(optionalStringSchema.parse(entry.role), `colors[${index}].role`);

    if (name !== undefined) color.name = name;

    if (role !== undefined) color.role = role;

    return color;
  });
};

const parseFonts = (value: BrandKitField): BrandKitFont[] => {
  if (value === undefined) return [];

  const entries = z.array(recordSchema).safeParse(value);

  if (!entries.success || entries.data.length > MAX_FONTS) {
    throw new Error(`fonts deve ser uma lista de até ${MAX_FONTS} fontes`);
  }

  return entries.data.map((entry, index) => {
    const family = z.string().safeParse(entry.family);

    if (!family.success || family.data.length === 0 || family.data.length > 60) {
      throw new Error(`fonts[${index}].family deve ser o nome da fonte (ex.: "Poppins")`);
    }

    const font: BrandKitFont = { family: family.data };
    const role = label(optionalStringSchema.parse(entry.role), `fonts[${index}].role`);

    if (role !== undefined) font.role = role;

    return font;
  });
};

const FORMAT_HELP =
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
    return { ok: false, error: `kit.json precisa ser JSON válido — ${FORMAT_HELP}` };
  }

  const parsedRecord = recordSchema.safeParse(raw);

  if (!parsedRecord.success)
    return { ok: false, error: `kit.json precisa ser um objeto — ${FORMAT_HELP}` };
  const record = parsedRecord.data;

  const unknown = Object.keys(record).filter(
    (key) => !["colors", "fonts", "tagline"].includes(key),
  );

  if (unknown.length > 0) {
    return { ok: false, error: `campo desconhecido: ${unknown[0]} — ${FORMAT_HELP}` };
  }

  try {
    const kit: BrandKit = { colors: parseColors(record.colors), fonts: parseFonts(record.fonts) };

    if (record.tagline !== undefined) {
      const tagline = z.string().safeParse(record.tagline);

      if (!tagline.success || tagline.data.length > MAX_TAGLINE) {
        return { ok: false, error: `tagline deve ser um texto de até ${MAX_TAGLINE} caracteres` };
      }

      kit.tagline = tagline.data;
    }

    return { ok: true, normalized: JSON.stringify(kit, null, 2) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** Lenient read-side parse for rendering; null when the text isn't a kit. */
export const parseBrandKit = (text: string): BrandKit | null => {
  try {
    const raw = recordSchema.parse(JSON.parse(text));

    const colors = z
      .array(
        z.object({ hex: z.string(), name: z.string().optional(), role: z.string().optional() }),
      )
      .safeParse(raw.colors);

    const fonts = z
      .array(z.object({ family: z.string(), role: z.string().optional() }))
      .safeParse(raw.fonts);

    const kitColors: BrandKitColor[] = [];

    for (const value of colors.success ? colors.data : []) {
      if (!HEX_PATTERN.test(value.hex)) continue;
      const color: BrandKitColor = { hex: value.hex };

      if (value.name !== undefined) color.name = value.name;

      if (value.role !== undefined) color.role = value.role;
      kitColors.push(color);
    }

    const kitFonts: BrandKitFont[] = [];

    for (const value of fonts.success ? fonts.data : []) {
      const font: BrandKitFont = { family: value.family };

      if (value.role !== undefined) font.role = value.role;
      kitFonts.push(font);
    }

    const kit: BrandKit = { colors: kitColors, fonts: kitFonts };

    const tagline = z.string().safeParse(raw.tagline);

    if (tagline.success && tagline.data.length > 0) kit.tagline = tagline.data;

    return kit;
  } catch {
    return null;
  }
};
