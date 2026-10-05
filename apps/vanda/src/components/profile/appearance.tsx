import { useState } from "react";
import { cn } from "@vanda-studio/ui/lib/utils";
import { errorMessage } from "../../errors";
import { DEFAULT_THEME, THEMES, type Theme } from "../../themes";
import { applyTheme } from "../theme";
import { useProfileRuntime } from "./runtime";

const LABELS = { system: "Sistema", light: "Claro", dark: "Escuro" } satisfies Record<
  Theme,
  string
>;

/** Theme choice: applied on this device at once, saved to the account for every device. */
export function AppearanceControl() {
  const { theme, setTheme } = useProfileRuntime().useAppearance();
  const [pending, setPending] = useState<Theme | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = pending ?? theme?.theme ?? DEFAULT_THEME;

  const choose = async (next: Theme) => {
    setPending(next);
    setError(null);
    applyTheme(next);

    try {
      await setTheme(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Tema"
        className="flex w-fit gap-1 rounded-lg border border-border bg-app p-1"
      >
        {THEMES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={current === option}
            onClick={() => void choose(option)}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors duration-150 ease-out",
              current === option ? "bg-muted text-text" : "text-text-3 hover:text-text",
            )}
          >
            {LABELS[option]}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-body-sm text-destructive">{error}</p> : null}
    </div>
  );
}
