import { composeBrandFile } from "../src/convex/brandFile";
import type { EvalBrand } from "./fixtures";

/**
 * A fictional brand as the brand file an onboarded owner would have: confirmed
 * facts plus its notes and preferences as (dono) items in their sections.
 */
export function brandFileFor(brand: EvalBrand): string {
  return composeBrandFile({
    name: brand.name,
    handle: brand.handle.replace(/^@/, ""),
    facts: [
      { kind: "summary", text: brand.notes },
      ...brand.facts.map((text) => ({ kind: "offer" as const, text })),
    ],
    legacy: [],
  }).replace("## Preferências\n", `## Preferências\n\n- ${brand.preferences} (dono)\n`);
}
