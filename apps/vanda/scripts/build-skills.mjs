import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "oxfmt";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const skillsRoot = join(appRoot, "skills");

const outputPath = join(appRoot, "src/convex/skills/generated.ts");

const checkOnly = process.argv.includes("--check");

const fail = (message) => {
  throw new Error(`skills: ${message}`);
};

const toPosix = (path) => path.split(sep).join("/");

const FrontmatterSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.string()).default({}),
  "allowed-tools": z.string().optional(),
  "disable-model-invocation": z.boolean().optional(),
});

const RegistryEntrySchema = z.object({
  sourceUrl: z.string().optional(),
  alwaysApply: z.boolean().optional(),
});

const RegistrySchema = z.record(z.string(), RegistryEntrySchema);

const errorMessage = (error) => z.instanceof(Error).safeParse(error).data?.message ?? String(error);

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

  let rawFrontmatter;

  try {
    rawFrontmatter = parseYaml(match[1]);
  } catch (error) {
    fail(`${sourcePath} has invalid YAML: ${errorMessage(error)}`);
  }

  const parsedFrontmatter = FrontmatterSchema.safeParse(rawFrontmatter);

  if (!parsedFrontmatter.success) {
    fail(`${sourcePath} has invalid frontmatter: ${parsedFrontmatter.error.message}`);
  }

  const frontmatter = parsedFrontmatter.data;

  if (frontmatter.name !== directoryName)
    fail(`${sourcePath} name must match its parent directory (${directoryName})`);

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    body: normalized.slice(match[0].length).trim(),
    license: frontmatter.license,
    compatibility: frontmatter.compatibility,
    metadata: frontmatter.metadata,
    allowedTools: frontmatter["allowed-tools"],
    disableModelInvocation: frontmatter["disable-model-invocation"] === true,
  };
}

const registry = RegistrySchema.parse(
  JSON.parse(await readFile(join(skillsRoot, "registry.json"), "utf8")),
);

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

  if (config === undefined) {
    fail(`${parsed.name} is missing an entry in skills/registry.json`);
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

const generated = `// Generated by scripts/build-skills.mjs. Do not edit by hand.\nimport type { InstalledSkill } from "./types";\n\nexport const INSTALLED_SKILLS = ${JSON.stringify(skills, null, 2)} satisfies readonly InstalledSkill[];\n`;

const formatted = await format(outputPath, generated);

if (formatted.errors.length > 0) fail("could not format generated catalog");

const output = formatted.code;

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
