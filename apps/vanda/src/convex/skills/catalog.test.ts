import { describe, expect, it } from "vitest";
import { formatSkillsForSystemPrompt, installedSkills, installedSkillSummaries } from "./catalog";
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
  it("installs the bundled skills with the expected activation mode", () => {
    expect(installedSkillSummaries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "instagram-market-research",
          alwaysApply: false,
        }),
        expect.objectContaining({
          name: "creating-carousel-images",
          alwaysApply: false,
          location: "/skills/creating-carousel-images/SKILL.md",
        }),
        expect.objectContaining({
          name: "unslop",
          alwaysApply: true,
          location: "/skills/unslop/SKILL.md",
        }),
      ]),
    );
  });

  it("replaces rendering packages with an image-only skill and no executable assets", () => {
    const skills = installedSkills();
    expect(skills.map((entry) => entry.name)).not.toContain("post-instagram-template");
    expect(skills.map((entry) => entry.name)).not.toContain("prompt-foto-fiel");
    const carousel = skills.find((entry) => entry.name === "creating-carousel-images");
    expect(carousel?.allowedTools).toBe("list read paint create_post present");
    expect(Object.keys(carousel?.files ?? {})).toEqual(["SKILL.md"]);

    for (const entry of skills) {
      expect(entry.allowedTools ?? "").not.toContain("run_code");
      expect(Object.keys(entry.files).some((path) => path.endsWith(".py"))).toBe(false);
    }
  });

  it("discloses every on-demand skill through metadata without loading its body", () => {
    const prompt = formatSkillsForSystemPrompt();

    const onDemand = installedSkills().filter(
      (entry) => !entry.alwaysApply && !entry.disableModelInvocation,
    );

    for (const entry of onDemand) {
      expect(prompt).toContain(`<name>${entry.name}</name>`);
      expect(prompt).toContain(`<description>${entry.description}</description>`);
      expect(prompt).toContain(`<location>${entry.location}</location>`);
      expect(prompt).not.toContain(entry.body.slice(0, 100));
    }
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
