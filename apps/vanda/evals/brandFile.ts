import { composeBrandFile } from "../src/convex/brandFile";
import type { EvalBrand } from "./fixtures";

/**
 * A fictional brand as the brand file an onboarded owner would have: confirmed
 * facts, its notes and preferences as (dono) items, and its Design section
 * (palette and typography) in the same file.
 */
export function brandFileFor(brand: EvalBrand): string {
  const palette = brand.design.colors.map((color) => `${color.hex} ${color.name}`).join("; ");

  const typography = brand.design.fonts
    .map((font) => (font.role ? `${font.family} (${font.role})` : font.family))
    .join("; ");

  return composeBrandFile({
    name: brand.name,
    handle: brand.handle.replace(/^@/, ""),
    facts: [
      { kind: "summary", text: brand.notes },
      ...brand.facts.map((text) => ({ kind: "offer" as const, text })),
      ...(brand.owner
        ? [{ kind: "character" as const, text: `${brand.owner.name}: ${brand.owner.appears}` }]
        : []),
    ],
    legacy: [],
  })
    .replace("## Preferências\n", `## Preferências\n\n- ${brand.preferences} (dono)\n`)
    .replace(
      "## Design\n",
      `## Design\n- Paleta: ${palette} (dono)\n- Tipografia: ${typography} (dono)\n`,
    );
}
