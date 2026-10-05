// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from "./theme";

const boot = (stored: string | null, prefersDark: boolean) => {
  if (stored === null) localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, stored);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: prefersDark, media: query }));
  document.documentElement.className = "";
  // oxlint-disable-next-line no-new-func -- runs the exact inline script the <head> ships.
  new Function(THEME_BOOT_SCRIPT)();

  return document.documentElement.classList.contains("dark");
};

afterEach(() => vi.unstubAllGlobals());

describe("theme boot script", () => {
  it("paints the stored theme before the app loads", () => {
    expect(boot(null, false)).toBe(true);
    expect(boot("light", true)).toBe(false);
    expect(boot("dark", false)).toBe(true);
    expect(boot("system", false)).toBe(false);
    expect(boot("system", true)).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
