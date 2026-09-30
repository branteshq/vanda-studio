import { describe, expect, it } from "vitest";
import {
  discoverableSkills,
  formatSkillsForSystemPrompt,
  installedSkills,
  installedSkillSummaries,
} from "./catalog";
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
          name: "post-production",
          alwaysApply: false,
          location: "/skills/post-production/SKILL.md",
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
    expect(skills.map((entry) => entry.name)).not.toContain("creating-carousel-images");
    expect(skills.map((entry) => entry.name)).not.toContain("post-purposes");
    expect(skills.map((entry) => entry.name)).not.toContain("post-router");
    const production = skills.find((entry) => entry.name === "post-production");
    expect(production?.allowedTools).toBe("list read paint create_post present");
    expect(Object.keys(production?.files ?? {})).toEqual(["SKILL.md"]);

    for (const entry of skills) {
      expect(entry.allowedTools ?? "").not.toContain("run_code");
      expect(Object.keys(entry.files).some((path) => path.endsWith(".py"))).toBe(false);
    }
  });

  it("keeps on-demand skills out of the prompt; tool_search indexes them instead", () => {
    const prompt = formatSkillsForSystemPrompt();
    expect(prompt).toContain("<active_skills>");
    expect(prompt).not.toContain("<available_skills>");

    const onDemand = discoverableSkills();
    expect(onDemand.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["instagram-market-research", "post-production", "post-type-story"]),
    );

    for (const entry of onDemand) {
      expect(entry.alwaysApply).toBe(false);
      expect(prompt).not.toContain(entry.body.slice(0, 100));
    }
  });

  it("injects always-on instructions in full", () => {
    const prompt = formatSkillsForSystemPrompt([
      skill({ name: "always", body: "Apply this to every answer.", alwaysApply: true }),
      skill({ name: "later", body: "SECRET BODY" }),
    ]);

    expect(prompt).toContain('<skill name="always"');
    expect(prompt).toContain("Apply this to every answer.");
    expect(prompt).not.toContain("SECRET BODY");
    expect(prompt).not.toContain("later");
  });

  it("never makes skills that forbid model invocation discoverable", () => {
    expect(discoverableSkills([skill({ disableModelInvocation: true })])).toEqual([]);
    expect(formatSkillsForSystemPrompt([skill()])).toBe("");
  });
});
