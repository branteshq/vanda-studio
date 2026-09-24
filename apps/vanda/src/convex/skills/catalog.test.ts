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
          name: "post-instagram-template",
          alwaysApply: false,
          location: "/skills/post-instagram-template/SKILL.md",
        }),
        expect.objectContaining({
          name: "prompt-foto-fiel",
          alwaysApply: false,
          location: "/skills/prompt-foto-fiel/SKILL.md",
        }),
        expect.objectContaining({
          name: "unslop",
          alwaysApply: true,
          location: "/skills/unslop/SKILL.md",
        }),
      ]),
    );
  });

  it("indexes every bundled Python template without putting templates in the prompt", () => {
    const template = installedSkills().find((entry) => entry.name === "post-instagram-template");
    const catalog = template?.body ?? "";
    const modelLines = (template?.files["references/modelos.md"] ?? "").split("\n");

    const indexedAssets = [...catalog.matchAll(/`([A-Za-z0-9]+(?:-\{1\.\.\d+\})?\.py)`/g)]
      .flatMap(([, spec]) => {
        const range = spec?.match(/^(.+)-\{1\.\.(\d+)\}\.py$/);

        if (!range) return spec ? [spec] : [];

        return Array.from(
          { length: Number(range[2]) },
          (_, index) => `${range[1]}-${index + 1}.py`,
        );
      })
      .toSorted();

    const bundledAssets = Object.keys(template?.files ?? {})
      .filter((path) => path.startsWith("assets/py/") && path.endsWith(".py"))
      .map((path) => path.slice("assets/py/".length))
      .toSorted();

    expect(indexedAssets).toEqual(bundledAssets);

    const indexedSections = [
      ...catalog.matchAll(
        /^\| (Main|S\d{2}|C\d{2}|T\d{2}|TC\d{2}) \|.*\| offset (\d+), limit (\d+) \|$/gm,
      ),
    ];

    expect(indexedSections).toHaveLength(60);

    for (const [, id, offset, limit] of indexedSections) {
      const section = modelLines.slice(Number(offset) - 1, Number(offset) - 1 + Number(limit));

      expect(section[0]).toContain(id);
    }

    const prompt = formatSkillsForSystemPrompt();

    expect(prompt).toContain(template?.description);
    expect(prompt).not.toContain("S04.py");
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
