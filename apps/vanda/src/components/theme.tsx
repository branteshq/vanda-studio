import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { Toaster } from "sonner";
import { api } from "../convex/_generated/api";
import { DEFAULT_THEME, isTheme, type Theme } from "../themes";

/** Last chosen theme on this device, so the next load paints right before data arrives. */
export const THEME_STORAGE_KEY = "vanda-theme";

/**
 * Runs in <head> before first paint: applies the stored theme so the page never
 * flashes the wrong one. Kept dependency-free; it mirrors applyTheme below.
 */
export const THEME_BOOT_SCRIPT = `(function(){var r=document.documentElement;try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||${JSON.stringify(DEFAULT_THEME)};var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){r.classList.add("dark");r.style.colorScheme="dark";}})();`;

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

export const resolveTheme = (theme: Theme): "light" | "dark" =>
  theme === "system" ? (prefersDark() ? "dark" : "light") : theme;

/** Apply a theme to the document and remember it on this device. */
export function applyTheme(theme: Theme): "light" | "dark" {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still applies for this page.
  }

  return resolved;
}

// On the server there is no localStorage: the default renders, and the boot script corrects it.
const storedTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);

    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
};

/**
 * Keeps the document on the owner's theme: the account's choice once it loads
 * (so a change made by Vanda, Caetano or another device lands here too), the
 * device's last choice before that, and the OS setting when it is "system".
 * Renders the toaster so notifications follow the same theme.
 */
export function ThemeSync() {
  const appearance = useQuery(api.users.appearance);
  // Before the account answers (or when signed out), this device's last choice.
  const [stored] = useState(storedTheme);
  const [resolved, setResolved] = useState<"light" | "dark">("dark");
  const current = appearance?.theme ?? stored;

  useEffect(() => {
    setResolved(applyTheme(current));

    if (current !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => setResolved(applyTheme("system"));
    media.addEventListener("change", follow);

    return () => media.removeEventListener("change", follow);
  }, [current]);

  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      toastOptions={{ className: "border-border bg-surface text-text" }}
    />
  );
}
