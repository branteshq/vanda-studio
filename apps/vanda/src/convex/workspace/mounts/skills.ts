import { findInstalledSkill, installedSkills } from "../../skills/catalog";
import type { InstalledSkill } from "../../skills/types";
import type { WorkspaceEntry, WorkspaceMount } from "../types";

const listSkillDirectory = (
  skill: InstalledSkill,
  segments: readonly string[],
): WorkspaceEntry[] | null => {
  const directory = segments.join("/");
  if (directory && skill.files[directory] !== undefined) return null;
  const prefix = directory ? `${directory}/` : "";
  const children = new Map<string, WorkspaceEntry>();

  for (const filePath of Object.keys(skill.files)) {
    if (!filePath.startsWith(prefix)) continue;
    const remainder = filePath.slice(prefix.length);
    if (!remainder) continue;
    const [name, ...rest] = remainder.split("/");
    if (!name) continue;
    if (rest.length > 0) {
      children.set(name, { name, kind: "dir" });
    } else if (!children.has(name)) {
      children.set(name, {
        name,
        kind: "file",
        summary: name === "SKILL.md" ? "instruções da habilidade" : "recurso da habilidade",
      });
    }
  }

  if (children.size === 0 && directory) return null;
  // ES2022 has no toSorted; sorting a fresh array cannot mutate the map.
  // oxlint-disable-next-line unicorn/no-array-sort
  return [...children.values()].sort(
    (left, right) =>
      Number(left.kind === "file") - Number(right.kind === "file") ||
      left.name.localeCompare(right.name),
  );
};

/** Read-only Agent Skills packages exposed through Vanda's existing list/read tools. */
export const skillsMount: WorkspaceMount = {
  root: "skills",
  summary: "habilidades instaladas e suas instruções (somente leitura)",
  writeHint: "habilidades são instaladas pela Vanda e não podem ser alteradas pela conversa",
  list: (_ctx, _accountId, segments) => {
    if (segments.length === 0) {
      return Promise.resolve(
        installedSkills().map((skill) => ({
          name: skill.name,
          kind: "dir" as const,
          summary: `${skill.alwaysApply ? "sempre ativa · " : ""}${skill.description}`,
        })),
      );
    }
    const [name, ...resourceSegments] = segments;
    const skill = name ? findInstalledSkill(name) : undefined;
    return Promise.resolve(skill ? listSkillDirectory(skill, resourceSegments) : null);
  },
  read: (_ctx, _accountId, segments) => {
    const [name, ...resourceSegments] = segments;
    const skill = name ? findInstalledSkill(name) : undefined;
    if (!skill || resourceSegments.length === 0) return Promise.resolve(null);
    const content = skill.files[resourceSegments.join("/")];
    return Promise.resolve(content === undefined ? null : { kind: "text" as const, text: content });
  },
};
