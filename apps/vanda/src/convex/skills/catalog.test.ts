import { describe, expect, it } from "vitest";
import { formatSkillsForSystemPrompt, installedSkillSummaries } from "./catalog";
import type { InstalledSkill } from "./types";

const skill = (patch: Partial<InstalledSkill> = {}): InstalledSkill => ({
  name: "example",
  description: "Use for examples.",
  body: "Follow the example instructions.",
  location: "/skills/example/SKILL.md",
  basePath: "/skills/example",
  files: { "SKILL.md": "example" },
  metadata: {},
  disableModelInvocation: false,
  alwaysApply: false,
  ...patch,
});

describe("skill catalog", () => {
  it("installs unslop as an always-on skill", () => {
    expect(installedSkillSummaries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "instagram-market-research",
          alwaysApply: false,
        }),
        expect.objectContaining({
          name: "unslop",
          alwaysApply: true,
          location: "/skills/unslop/SKILL.md",
        }),
      ]),
    );
  });

  it("injects always-on instructions in full", () => {
    const prompt = formatSkillsForSystemPrompt([
      skill({ name: "always", body: "Apply this to every answer.", alwaysApply: true }),
    ]);
    expect(prompt).toContain('<skill name="always"');
    expect(prompt).toContain("Apply this to every answer.");
    expect(prompt).not.toContain("<available_skills>");
  });

  it("discloses on-demand skills without loading their body", () => {
    const prompt = formatSkillsForSystemPrompt([
      skill({ description: 'Use for <examples> & "tests".', body: "SECRET BODY" }),
    ]);
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("Use for &lt;examples&gt; &amp; &quot;tests&quot;.");
    expect(prompt).toContain("/skills/example/SKILL.md");
    expect(prompt).not.toContain("SECRET BODY");
  });

  it("hides skills that forbid model invocation", () => {
    expect(formatSkillsForSystemPrompt([skill({ disableModelInvocation: true })])).toBe("");
  });
});
