import { Switch } from "@base-ui/react/switch";

import { cn } from "@vanda-studio/ui/lib/utils";

/** On/off switch — brand track when on, light knob, snappy ease-out slide. */
function Toggle({ className, ...props }: Switch.Root.Props) {
  return (
    <Switch.Root
      data-slot="toggle"
      className={cn(
        "relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full bg-border px-0.5 outline-none transition-colors duration-150 ease-[var(--ease-out)] focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-[checked]:bg-brand-accent",
        className,
      )}
      {...props}
    >
      <Switch.Thumb className="size-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ease-[var(--ease-out)] data-[checked]:translate-x-3" />
    </Switch.Root>
  );
}

export { Toggle };
