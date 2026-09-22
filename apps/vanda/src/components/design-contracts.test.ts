import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { expect, it } from "vitest";

it("enforces every design rule while accepting layout and component variants", () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const directory = mkdtempSync(join(root, "apps/vanda/src/components/.lint-contract-"));
  const file = join(directory, "fixture.tsx");

  const lint = () =>
    spawnSync(
      process.execPath,
      [join(root, "node_modules/oxlint/bin/oxlint"), "--format", "unix", file],
      { cwd: root, encoding: "utf8" },
    );

  try {
    writeFileSync(
      file,
      `
      import { Button } from "@vanda-studio/ui/components/button";

      export function Example(tone: string) {
        return <>
          <Button className="p-4 bg-red-500" />
          <div className="p-[13px] rounded-nonsense" style={{ width: 12 }} />
          <Button className={\`bg-\${tone}\`} />
        </>;
      }
    `,
    );
    const invalid = lint();
    expect(invalid.status).toBe(1);

    for (const rule of [
      "no-restyle",
      "no-raw-colors",
      "no-arbitrary-values",
      "no-inline-styles",
      "require-static-classes",
      "no-unknown-classes",
    ]) {
      expect(invalid.stdout).toContain(`shadcn(${rule})`);
    }

    writeFileSync(
      file,
      `
      import { Button } from "@vanda-studio/ui/components/button";
      import { Skeleton } from "@vanda-studio/ui/components/skeleton";
      import { SidebarHeader } from "@vanda-studio/ui/components/sidebar";

      export function Example() {
        return <>
          <Button variant="soft" size="sm" className="mt-4 w-full" />
          <Skeleton className="h-8 rounded-full" />
          <SidebarHeader divider className="gap-2 px-3" />
          <div className="bg-surface p-3.25 text-body" />
        </>;
      }
    `,
    );
    const valid = lint();
    expect(valid.stderr).not.toContain("could not be built");
    expect(valid.status, valid.stdout + valid.stderr).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);
