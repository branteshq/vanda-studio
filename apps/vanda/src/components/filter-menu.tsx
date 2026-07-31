import { Fragment, type ReactNode } from "react";
import { ListFilter } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@vanda-studio/ui/components/dropdown-menu";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";

export interface FilterOption<T extends string = string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** One single-select dimension inside a FilterMenu (origin, sort, model, …). */
export interface FilterGroup<T extends string = string> {
  key: string;
  label: string;
  value: T;
  /** The group's rest state — the button only lights up away from it. */
  defaultValue: T;
  options: ReadonlyArray<FilterOption<T>>;
  onChange: (value: T) => void;
}

/**
 * FilterMenu — view options folded behind one quiet icon button, for toolbars
 * where segmented controls would be noise. Each group is an independent
 * single-select dimension; the menu stacks them with separators.
 *
 * The button telegraphs state without spending space: while any group sits
 * away from its default the icon warms up and a brand dot pops onto its corner
 * (scale+fade, 200ms), and the tooltip names the active choices. The menu
 * rides the design system's popup choreography; check marks zoom in with it.
 */
export function FilterMenu({
  label,
  groups,
}: {
  /** Action name for the tooltip and accessibility ("Filtrar imagens"). */
  label: string;
  groups: ReadonlyArray<FilterGroup>;
}) {
  const activeLabels = groups
    .filter((group) => group.value !== group.defaultValue)
    .map((group) => group.options.find((option) => option.value === group.value)?.label)
    .filter(Boolean);
  const active = activeLabels.length > 0;

  return (
    <DropdownMenu>
      <ActionTooltip
        label={active ? `${label} · ${activeLabels.join(" · ")}` : label}
        side="bottom"
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              className={cn(
                "relative data-popup-open:bg-accent data-popup-open:text-text",
                active ? "text-text" : "text-text-4 hover:text-text",
              )}
            />
          }
        >
          <ListFilter className="size-4" />
          {active && (
            <span
              aria-hidden
              className="animate-in fade-in zoom-in-50 absolute top-1 right-1 size-1.5 rounded-full bg-brand-accent duration-200"
            />
          )}
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-48">
        {groups.map((group, index) => (
          <Fragment key={group.key}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuRadioGroup value={group.value} onValueChange={group.onChange}>
              {/* GroupLabel must sit inside a group context (Base UI). */}
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {group.options.map((option) => (
                <DropdownMenuRadioItem
                  key={option.value}
                  value={option.value}
                  // Only the check indicator animates — option icons stay put.
                  className="[&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:animate-in [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:zoom-in-50 [&_[data-slot=dropdown-menu-radio-item-indicator]_svg]:duration-200"
                >
                  {option.icon}
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
