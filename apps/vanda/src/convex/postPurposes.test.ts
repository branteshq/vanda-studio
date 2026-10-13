import { describe, expect, it } from "vitest";
import { postPurposes } from "./postPurposes";
import { discoverableSkills, findInstalledSkill } from "./skills/catalog";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

const HEADINGS = ["Estrutura:", "Visual:", "Texto e CTA:", "Evite:", "Fatos necessários:"];

const post = findInstalledSkill("post");

/** The entry of one purpose in purposes.md: from its "## <id>" to the next heading. */
const entry = (purpose: string) =>
  (post?.files["purposes.md"] ?? "").split(/^## /m).find((part) => part.startsWith(`${purpose}\n`));

describe("post purposes", () => {
  it("has 14 unique ids", () => {
    expect(postPurposes).toHaveLength(14);
    expect(new Set(postPurposes).size).toBe(postPurposes.length);
  });

  it("keeps one complete entry per purpose in the post skill", () => {
    for (const purpose of postPurposes) {
      const text = entry(purpose);
      expect(text, purpose).toBeDefined();

      for (const heading of HEADINGS) expect(text, purpose).toContain(`- ${heading}`);
    }

    const ids = [...(post?.files["purposes.md"] ?? "").matchAll(/^## (\S+)$/gm)].map((m) => m[1]);
    expect(ids.toSorted()).toEqual([...postPurposes].toSorted());
  });

  it("keeps the post skill discoverable, naming every purpose, within budget", () => {
    expect(discoverableSkills().map((skill) => skill.name)).toContain("post");
    expect(post?.disableModelInvocation).toBe(false);

    for (const purpose of postPurposes) expect(post?.body).toContain(purpose);

    for (const type of ["image", "carousel", "story"]) expect(post?.body).toContain(type);
    // SKILL.md is read on every post; the rest only when the post asks for it.
    expect(bytes(post?.files["purposes.md"] ?? "")).toBeLessThanOrEqual(9_000);
    expect(bytes(post?.files["formats.md"] ?? "")).toBeLessThanOrEqual(10_000);
  });

  it("splits production, art direction and copy into three skills read on every post", () => {
    const design = findInstalledSkill("design");
    const copy = findInstalledSkill("copy");

    // post produces and points at the other two; each one does one job.
    expect(post?.body).toContain("/skills/design/SKILL.md");
    expect(post?.body).toContain("/skills/copy/SKILL.md");
    // Identity stays, execution improves: the art direction owns it.
    expect(design?.body).toContain("Manter");
    expect(design?.body).toContain("Evoluir");
    expect(design?.body).toContain("melhor que o post típico do feed");
    expect(design?.body).toContain("Sinais de imagem genérica de IA");
    expect(copy?.body).toContain("Sinais de texto de IA");
    expect(copy?.body).toContain("Linha 1");
    // The upstream AI-tells list ships unchanged, with its license.
    expect(copy?.files["ai-tells.md"]).toContain("# AI Tells: The Copy Blacklist");
    expect(copy?.files["LICENSE"]).toContain("MIT License");
    expect(design?.files["LICENSE.txt"]).toContain("Apache License");
    // A new product the post shows is produto, not anuncio.
    expect(post?.body).toContain('mesmo dito "novo" ou "lançamento"');

    for (const skill of [post, design, copy])
      expect(bytes(skill?.files["SKILL.md"] ?? "")).toBeLessThanOrEqual(7_500);
  });
});
