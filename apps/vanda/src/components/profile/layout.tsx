import type { MouseEvent, ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@vanda-studio/ui/components/dropdown-menu";
import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * Perfil's building blocks, Linear-style: every page is a title, a one-line
 * lede and cards. A card is a filled tile with a faint line; rows inside it
 * are split by hairlines. Every action has a surface (a secondary button) or a
 * sign: ⌄ opens a menu, ↗ leaves the app, › goes to another page.
 */
export function SettingsPage({
  title,
  lede,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {lede ? <p className="mt-1.5 text-sm text-text-3">{lede}</p> : null}
      <div className="mt-8">{children}</div>
    </div>
  );
}

/** A heading between groups of cards on one page. */
export function SettingsHeading({
  title,
  caption,
  action,
  first = false,
}: {
  title: ReactNode;
  caption?: ReactNode;
  action?: ReactNode;
  /** The page's first heading sits right under the lede. */
  first?: boolean;
}) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-4", first ? "mt-0" : "mt-9")}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {caption ? <p className="mt-0.5 text-body text-text-3">{caption}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** One filled card. Its direct children are rows, split by hairlines. */
export function SettingsCard({
  label,
  children,
}: {
  /** The accessible name of the group, when the card is one. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      role={label ? "group" : undefined}
      className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-tile"
    >
      {children}
    </section>
  );
}

/** Cards stacked with a small gap, one per service or group. */
export function SettingsStack({ children }: { children: ReactNode }) {
  return <div className="space-y-2.5">{children}</div>;
}

/**
 * A row in a card: an optional tile, a title over its detail, and what the row
 * does on the right. `inset` lines a row up under its card's header text, for
 * the accounts listed under one service.
 */
export function SettingsRow({
  icon,
  title,
  detail,
  children,
  footer,
  inset = false,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  inset?: boolean;
}) {
  return (
    <div className={cn("py-3.5 pr-4", inset ? "pl-15.5" : "pl-4")}>
      <div className="flex min-h-9 items-center gap-3.5">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium">{title}</div>
          {detail ? <div className="mt-0.5 text-body text-text-3">{detail}</div> : null}
        </div>
        {children ? <div className="flex shrink-0 items-center gap-1.5">{children}</div> : null}
      </div>
      {footer}
    </div>
  );
}

/** A whole row that goes somewhere: the chevron says so. */
export function SettingsLinkRow({
  href,
  onNavigate,
  icon,
  title,
  detail,
  value,
}: {
  href: string;
  onNavigate: () => void;
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        onNavigate();
      }}
      className="group/link flex min-h-16 items-center gap-3.5 px-4 py-3.5 outline-none transition-colors duration-150 ease-out hover:bg-tile-hover focus-visible:bg-tile-hover"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{title}</span>
        {detail ? <span className="mt-0.5 block text-body text-text-3">{detail}</span> : null}
      </span>
      {value ? <span className="shrink-0 text-body-sm text-text-4">{value}</span> : null}
      <ChevronRight className="size-4 shrink-0 text-text-4 transition-colors duration-150 ease-out group-hover/link:text-text-2" />
    </a>
  );
}

/** The square a service's mark sits on: a small raised surface. */
export function ServiceTile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-md border border-line-strong bg-raised shadow-raised"
    >
      {children}
    </span>
  );
}

const MONOGRAM_TONES = [
  "bg-brand-accent/20 text-brand-soft",
  "bg-green/15 text-green",
  "bg-peri/15 text-peri",
  "bg-amber/15 text-amber",
] as const;

/** A business's initial on a tinted square; the tint follows its place in the list. */
export function Monogram({
  name,
  index,
  size = "sm",
}: {
  name: string;
  index: number;
  size?: "sm" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center font-semibold",
        size === "sm" ? "size-4 rounded-sm text-micro" : "size-8 rounded-md text-body",
        MONOGRAM_TONES[index % MONOGRAM_TONES.length],
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

const DOT_TONE = {
  on: "bg-green ring-3 ring-green/15",
  pending: "bg-amber ring-3 ring-amber/15",
  off: "bg-text-5",
} as const;

export type StatusTone = keyof typeof DOT_TONE;

export function StatusDot({ tone }: { tone: StatusTone }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", DOT_TONE[tone])} />;
}

/**
 * A connection's state that opens its actions, like Linear's "● Connected ⌄".
 * Reconectar and Desconectar live in the menu: nothing hides until hover, so
 * the same controls work on a phone.
 */
export function StatusMenu({
  tone,
  label,
  meta,
  children,
}: {
  tone: StatusTone;
  label: string;
  /** A header inside the menu: the number, handle or plan behind the status. */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
        <StatusDot tone={tone} />
        <span className="ml-0.5">{label}</span>
        <ChevronDown className="text-text-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {meta ? (
          <div className="mb-1 border-b border-line px-2 pt-1.5 pb-2 text-body-sm text-text-4">
            {meta}
          </div>
        ) : null}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A small set of choices on a sunken track; the chosen one is raised. */
export function Segmented<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string; icon?: ReactNode }[];
  onChange: (value: Value) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-fit gap-0.5 rounded-lg border border-line-strong bg-app p-0.5 shadow-sunken"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-body font-medium outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/40",
            value === option.value
              ? "bg-raised text-text shadow-raised"
              : "text-text-3 hover:text-text",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A small rounded label next to a title. */
export function Pill({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "amber";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 align-middle text-note font-medium",
        tone === "amber" ? "bg-amber/12 text-amber" : "bg-line-strong text-text-3",
      )}
    >
      {children}
    </span>
  );
}
