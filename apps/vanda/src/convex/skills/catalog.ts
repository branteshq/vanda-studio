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

/** Skills a model may discover through tool_search; always-on ones are already in the prompt. */
export const discoverableSkills = (
  skills: readonly InstalledSkill[] = INSTALLED_SKILLS,
): InstalledSkill[] =>
  skills.filter((skill) => !skill.alwaysApply && !skill.disableModelInvocation);

/**
 * Skills use Agent Skills progressive disclosure. Always-on skills are placed
 * in the system prompt; all others are indexed by tool_search and load via the
 * workspace read tool when Vanda decides they match the task.
 */
export const formatSkillsForSystemPrompt = (
  skills: readonly InstalledSkill[] = INSTALLED_SKILLS,
): string => {
  const alwaysOn = skills.filter((skill) => skill.alwaysApply);

  if (alwaysOn.length === 0) return "";

  const lines = [
    "As habilidades abaixo estão sempre ativas. Siga as instruções delas em toda resposta.",
    "Referências relativas partem do diretório informado em location.",
    "",
    "<active_skills>",
  ];

  for (const skill of alwaysOn) {
    lines.push(`  <skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.location)}">`);
    lines.push(skill.body);
    lines.push("  </skill>");
  }

  lines.push("</active_skills>");

  return lines.join("\n");
};
