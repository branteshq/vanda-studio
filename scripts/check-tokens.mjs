#!/usr/bin/env node
/*
 * Design-token guard.
 *
 * The design system has ONE source of truth: packages/ui/src/styles/globals.css.
 * Frontend markup must compose those tokens (bg-surface, text-text-3, text-amber,
 * the StatusPill/Tag/Card/… components) — never raw color.
 *
 * This fails the build on the three ways color sneaks back in:
 *   1. arbitrary Tailwind color classes  →  bg-[#…], text-[rgb(…)], border-[oklch(…)]
 *   2. raw CSS gradients                 →  linear/radial/conic-gradient(
 *   3. hex as an inline-style value      →  style={{ background: "#070509" }}
 *
 * SVG brand marks/logos (fill="#…", stopColor="#…") are NOT flagged — those are
 * attributes, not the patterns above. A line may opt out with `token-guard-ignore`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["apps/vanda/src/components", "apps/vanda/src/routes", "packages/ui/src/components"];

const RULES = [
  {
    re: /-\[(?:#|rgb|rgba|hsl|hsla|oklch|oklab)/,
    why: "arbitrary color class — use a token utility (bg-surface, text-text-3, …)",
  },
  {
    re: /(?:linear|radial|conic)-gradient\(/,
    why: "raw gradient — tokens only (the brand mark is the lone gradient)",
  },
  { re: /:\s*["']#[0-9a-fA-F]{3,8}\b/, why: "hex in an inline style — use a token" },
];

const offenders = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (name.endsWith(".tsx")) {
      const lines = readFileSync(full, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("token-guard-ignore")) continue;
        for (const { re, why } of RULES) {
          if (re.test(line)) {
            offenders.push({
              file: relative(process.cwd(), full),
              line: i + 1,
              why,
              text: line.trim(),
            });
            break;
          }
        }
      }
    }
  }
}

for (const root of ROOTS) walk(root);

if (offenders.length > 0) {
  console.error(
    "\n✗ Design-token guard — raw color in markup. Use tokens (docs/design-tokens.md).\n",
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.why}`);
    console.error(`    ${o.text.slice(0, 130)}`);
  }
  console.error(`\n${offenders.length} violation(s).\n`);
  process.exit(1);
}
console.log("✓ Design-token guard — markup composes tokens, no raw color.");
