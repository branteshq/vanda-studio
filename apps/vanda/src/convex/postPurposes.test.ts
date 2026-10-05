import { describe, expect, it } from "vitest";
import { postPurposes } from "./postPurposes";
import { discoverableSkills, findInstalledSkill, installedSkills } from "./skills/catalog";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

const skillFor = (purpose: string) => `post-purpose-${purpose.replaceAll("_", "-")}`;

const HEADINGS = [
  "Estrutura:",
  "Visual:",
  "Texto e CTA:",
  "Decisões de estilo:",
  "Evite:",
  "Fatos necessários:",
];

describe("post purposes", () => {
  it("has 14 unique ids", () => {
    expect(postPurposes).toHaveLength(14);
    expect(new Set(postPurposes).size).toBe(postPurposes.length);
  });

  it("keeps one discoverable, complete, small skill per purpose", () => {
    const discoverable = new Set(discoverableSkills().map((skill) => skill.name));

    for (const purpose of postPurposes) {
      const skill = findInstalledSkill(skillFor(purpose));
      expect(skill, purpose).toBeDefined();
      expect(discoverable.has(skillFor(purpose)), purpose).toBe(true);

      for (const heading of HEADINGS) expect(skill?.body, purpose).toContain(`- ${heading}`);
      expect(bytes(skill?.files["SKILL.md"] ?? "")).toBeLessThanOrEqual(1_500);
    }

    const installed = installedSkills()
      .map((skill) => skill.name)
      .filter((name) => name.startsWith("post-purpose-"));

    expect(installed.toSorted()).toEqual(postPurposes.map(skillFor).toSorted());
  });

  it("keeps type and production skills discoverable and within budget", () => {
    const production = findInstalledSkill("post-production");
    expect(production?.disableModelInvocation).toBe(false);

    for (const purpose of postPurposes) expect(production?.body).toContain(purpose);
    expect(bytes(production?.files["SKILL.md"] ?? "")).toBeLessThanOrEqual(8_000);

    for (const [name, type] of [
      ["post-type-image", "image"],
      ["post-type-carousel", "carousel"],
      ["post-type-story", "story"],
    ] as const) {
      const typeSkill = findInstalledSkill(name);
      expect(typeSkill?.disableModelInvocation, name).toBe(false);
      expect(typeSkill?.body).toContain(`type ${type}`);
      expect(bytes(typeSkill?.files["SKILL.md"] ?? "")).toBeLessThanOrEqual(1_800);
    }
  });
});
