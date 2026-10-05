/**
 * Interface themes. Dark is the native mode; light is the derived token pair in
 * packages/ui globals.css. "system" follows the device. Shared by the settings
 * registry (server) and the theme boot script (client).
 */
export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

/** What an owner who never chose sees: the app as it always looked. */
export const DEFAULT_THEME: Theme = "dark";

export const isTheme = (value: string | null | undefined): value is Theme =>
  THEMES.some((theme) => theme === value);
