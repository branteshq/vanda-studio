"use client";

import type { ReactElement, ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@vanda-studio/ui/lib/utils";

function TooltipProvider({
  delay = 350,
  closeDelay = 80,
  timeout = 500,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      closeDelay={closeDelay}
      timeout={timeout}
      {...props}
    />
  );
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md border border-border-strong bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md transition-[opacity,transform] duration-[180ms] ease-[var(--ease-out)] has-data-[slot=kbd]:pr-1.5 data-[instant=delay]:duration-100 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[0.96] data-starting-style:opacity-0 data-[side=bottom]:data-ending-style:-translate-y-1 data-[side=bottom]:data-starting-style:-translate-y-1.5 data-[side=inline-end]:data-ending-style:-translate-x-1 data-[side=inline-end]:data-starting-style:-translate-x-1.5 data-[side=inline-start]:data-ending-style:translate-x-1 data-[side=inline-start]:data-starting-style:translate-x-1.5 data-[side=left]:data-ending-style:translate-x-1 data-[side=left]:data-starting-style:translate-x-1.5 data-[side=right]:data-ending-style:-translate-x-1 data-[side=right]:data-starting-style:-translate-x-1.5 data-[side=top]:data-ending-style:translate-y-1 data-[side=top]:data-starting-style:translate-y-1.5 motion-reduce:transform-none motion-reduce:transition-opacity **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-popover fill-popover data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

interface ActionTooltipProps extends Pick<
  TooltipPrimitive.Positioner.Props,
  "align" | "alignOffset" | "side" | "sideOffset"
> {
  label: ReactNode;
  children: ReactElement;
  className?: string;
}

/**
 * Standard tooltip for compact/icon actions. It composes directly onto its
 * child, preserving the child's semantics, focus behavior, and event handlers.
 */
function ActionTooltip({ label, children, className, ...position }: ActionTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className={className} {...position}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export { ActionTooltip, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
