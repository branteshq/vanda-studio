import { useState, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { errorMessage } from "../../errors";
import { DEFAULT_THEME, type Theme } from "../../themes";
import { applyTheme } from "../theme";
import { Segmented } from "./layout";
import { useProfileRuntime } from "./runtime";

const OPTIONS = [
  { value: "system", label: "Sistema", icon: <Monitor className="size-3.5" /> },
  { value: "dark", label: "Escuro", icon: <Moon className="size-3.5" /> },
  { value: "light", label: "Claro", icon: <Sun className="size-3.5" /> },
] as const satisfies readonly { value: Theme; label: string; icon: ReactNode }[];

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
    <div className="flex flex-col items-end gap-1.5">
      <Segmented
        label="Tema"
        value={current}
        options={OPTIONS}
        onChange={(next) => void choose(next)}
      />
      {error ? <p className="text-body-sm text-destructive">{error}</p> : null}
    </div>
  );
}
