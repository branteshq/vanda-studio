import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(appRoot, "skills");
const outputPath = join(appRoot, "src/convex/skills/generated.ts");
const checkOnly = process.argv.includes("--check");

const fail = (message) => {
  throw new Error(`skills: ${message}`);
};

const toPosix = (path) => path.split(sep).join("/");

async function findSkillDirectories(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) return [dir];
  const nested = [];
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules")
      continue;
    nested.push(...(await findSkillDirectories(join(dir, entry.name))));
  }
  return nested;
}

async function collectTextFiles(root, dir = root) {
  const files = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await collectTextFiles(root, path));
      continue;
    }
    if (!entry.isFile()) continue;
    const bytes = await readFile(path);
    if (bytes.includes(0))
      fail(`${toPosix(relative(skillsRoot, path))} is binary; only text resources are supported`);
    files[toPosix(relative(root, path))] = bytes.toString("utf8");
  }
  return files;
}

function parseSkill(raw, directoryName, sourcePath) {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) fail(`${sourcePath} must start with YAML frontmatter enclosed by --- lines`);

  let frontmatter;
  try {
    frontmatter = parseYaml(match[1]) ?? {};
  } catch (error) {
    fail(
      `${sourcePath} has invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    fail(`${sourcePath} frontmatter must be a mapping`);
  }

  const name = frontmatter.name;
  const description = frontmatter.description;
  if (typeof name !== "string" || name.length === 0) fail(`${sourcePath} is missing name`);
  if (name !== directoryName)
    fail(`${sourcePath} name must match its parent directory (${directoryName})`);
  if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    fail(`${sourcePath} name must be at most 64 lowercase letters, numbers, and single hyphens`);
  }
  if (typeof description !== "string" || description.trim().length === 0) {
    fail(`${sourcePath} is missing description`);
  }
  if (description.length > 1024) fail(`${sourcePath} description exceeds 1024 characters`);

  const compatibility = frontmatter.compatibility;
  if (
    compatibility !== undefined &&
    (typeof compatibility !== "string" || compatibility.length > 500)
  ) {
    fail(`${sourcePath} compatibility must be a string of at most 500 characters`);
  }
  const metadata = frontmatter.metadata ?? {};
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    fail(`${sourcePath} metadata must be a string-to-string mapping`);
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== "string") fail(`${sourcePath} metadata.${key} must be a string`);
  }
  const allowedTools = frontmatter["allowed-tools"];
  if (allowedTools !== undefined && typeof allowedTools !== "string") {
    fail(`${sourcePath} allowed-tools must be a space-separated string`);
  }

  return {
    name,
    description,
    body: normalized.slice(match[0].length).trim(),
    license: typeof frontmatter.license === "string" ? frontmatter.license : undefined,
    compatibility,
    metadata,
    allowedTools,
    disableModelInvocation: frontmatter["disable-model-invocation"] === true,
  };
}

const registry = JSON.parse(await readFile(join(skillsRoot, "registry.json"), "utf8"));
const skillDirectories = await findSkillDirectories(skillsRoot);
const skills = [];
const discoveredNames = new Set();

for (const skillDir of skillDirectories.toSorted()) {
  const directoryName = skillDir.split(sep).at(-1);
  const sourcePath = toPosix(relative(appRoot, join(skillDir, "SKILL.md")));
  const raw = await readFile(join(skillDir, "SKILL.md"), "utf8");
  const parsed = parseSkill(raw, directoryName, sourcePath);
  if (discoveredNames.has(parsed.name)) fail(`duplicate skill name: ${parsed.name}`);
  discoveredNames.add(parsed.name);

  const config = registry[parsed.name];
  if (config === undefined || typeof config !== "object" || Array.isArray(config)) {
    fail(`${parsed.name} is missing an entry in skills/registry.json`);
  }
  if (config.sourceUrl !== undefined && typeof config.sourceUrl !== "string") {
    fail(`${parsed.name}.sourceUrl must be a string`);
  }
  if (config.alwaysApply !== undefined && typeof config.alwaysApply !== "boolean") {
    fail(`${parsed.name}.alwaysApply must be a boolean`);
  }
  if (config.alwaysApply === true && parsed.disableModelInvocation) {
    fail(`${parsed.name} cannot be alwaysApply and disable-model-invocation at the same time`);
  }

  skills.push({
    ...parsed,
    location: `/skills/${parsed.name}/SKILL.md`,
    basePath: `/skills/${parsed.name}`,
    files: await collectTextFiles(skillDir),
    sourceUrl: config.sourceUrl,
    alwaysApply: config.alwaysApply === true,
  });
}

for (const name of Object.keys(registry)) {
  if (!discoveredNames.has(name)) fail(`registry entry ${name} has no SKILL.md`);
}

const serialized = JSON.stringify(skills);
const stringLiteral = `'${serialized
  .replace(/\\/g, "\\\\")
  .replace(/'/g, "\\'")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029")}'`;
const output = `// Generated by scripts/build-skills.mjs. Do not edit by hand.\nimport type { InstalledSkill } from "./types";\n\nexport const INSTALLED_SKILLS = JSON.parse(\n  ${stringLiteral},\n) as readonly InstalledSkill[];\n`;

if (checkOnly) {
  let current = "";
  try {
    current = await readFile(outputPath, "utf8");
  } catch {}
  if (current !== output) fail("generated catalog is stale; run pnpm skills:build");
} else {
  await writeFile(outputPath, output);
  console.log(`Generated ${skills.length} skill(s) in ${toPosix(relative(appRoot, outputPath))}`);
}
