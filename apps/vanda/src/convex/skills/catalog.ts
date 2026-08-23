import { INSTALLED_SKILLS } from "./generated";
import type { InstalledSkill, InstalledSkillSummary } from "./types";

export const installedSkills = (): readonly InstalledSkill[] => INSTALLED_SKILLS;

export const installedSkillSummaries = (): InstalledSkillSummary[] =>
  INSTALLED_SKILLS.map((skill) => ({
    name: skill.name,
    description: skill.description,
    location: skill.location,
    sourceUrl: skill.sourceUrl,
    alwaysApply: skill.alwaysApply,
  }));

export const findInstalledSkill = (name: string): InstalledSkill | undefined =>
  INSTALLED_SKILLS.find((skill) => skill.name === name);

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Skills use Agent Skills progressive disclosure. Always-on skills are placed
 * in the system prompt; all others disclose only their metadata and load via
 * the workspace read tool when Vanda decides they match the task.
 */
export const formatSkillsForSystemPrompt = (
  skills: readonly InstalledSkill[] = INSTALLED_SKILLS,
): string => {
  const alwaysOn = skills.filter((skill) => skill.alwaysApply);
  const available = skills.filter((skill) => !skill.alwaysApply && !skill.disableModelInvocation);
  if (alwaysOn.length === 0 && available.length === 0) return "";

  const sections: string[] = [];
  if (alwaysOn.length > 0) {
    const lines = [
      "As habilidades abaixo estão sempre ativas. Siga as instruções delas em toda resposta.",
      "Referências relativas partem do diretório informado em location.",
      "",
      "<active_skills>",
    ];
    for (const skill of alwaysOn) {
      lines.push(
        `  <skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.location)}">`,
      );
      lines.push(skill.body);
      lines.push("  </skill>");
    }
    lines.push("</active_skills>");
    sections.push(lines.join("\n"));
  }

  if (available.length > 0) {
    const lines = [
      "As habilidades abaixo trazem instruções especializadas para tarefas específicas.",
      "Quando uma tarefa combinar com a descrição, use read para carregar o SKILL.md completo antes de agir.",
      "Resolva referências relativas a partir do diretório pai do SKILL.md.",
      "",
      "<available_skills>",
    ];
    for (const skill of available) {
      lines.push("  <skill>");
      lines.push(`    <name>${escapeXml(skill.name)}</name>`);
      lines.push(`    <description>${escapeXml(skill.description)}</description>`);
      lines.push(`    <location>${escapeXml(skill.location)}</location>`);
      lines.push("  </skill>");
    }
    lines.push("</available_skills>");
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
};
