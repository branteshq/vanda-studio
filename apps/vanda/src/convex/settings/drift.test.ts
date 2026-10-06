import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRODUCT_DOC_SOURCES } from "../productDocs/generated";
import { NON_SETTING_UI_FUNCTIONS, SETTINGS } from "./catalog";

// The settings UIs: the Perfil page, the cards it renders from other files, and
// the Posts automáticos view with its shared components.
const PERFIL_SOURCES = [
  "../../routes/_dashboard.perfil.tsx",
  "../../components/profile/runtime.tsx",
  "../../components/whatsapp-settings.tsx",
  "../../routes/_dashboard.calendario.tsx",
  "../../components/autopilot/panel.tsx",
  "../../components/autopilot/post-dialog.tsx",
];

const perfilCalls = (): Set<string> => {
  const calls = new Set<string>();

  for (const source of PERFIL_SOURCES) {
    const text = readFileSync(fileURLToPath(new URL(source, import.meta.url)), "utf8");

    for (const [, path] of text.matchAll(/\bapi\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)/g))
      if (path) calls.add(path);
  }

  return calls;
};

const claimed = new Set<string>([
  ...SETTINGS.flatMap((setting) => setting.uiFunctions),
  ...NON_SETTING_UI_FUNCTIONS,
]);

describe("settings registry drift", () => {
  it("claims every backend function the Perfil UI calls", () => {
    expect(perfilCalls().size).toBeGreaterThan(10);
    // A new Perfil control needs a registry entry (or a NON_SETTING_UI_FUNCTIONS reason),
    // so the agents learn about it in the same change.
    expect([...perfilCalls()].filter((call) => !claimed.has(call))).toEqual([]);
  });

  it("does not claim functions the Perfil UI no longer calls", () => {
    const calls = perfilCalls();

    expect([...claimed].filter((call) => !calls.has(call))).toEqual([]);
  });

  it.each(SETTINGS.map((setting) => [setting.id, setting] as const))(
    "documents %s on its docs page, at the place the UI shows it",
    (_id, setting) => {
      const page = PRODUCT_DOC_SOURCES.find((doc) => doc.slug === setting.doc);

      expect(page, `product-docs/${setting.doc}.md`).toBeDefined();
      expect(page?.markdown).toContain(setting.where);
    },
  );
});
