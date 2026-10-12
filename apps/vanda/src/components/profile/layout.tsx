import type { ReactNode } from "react";
import { cn } from "@vanda-studio/ui/lib/utils";

/**
 * A Perfil section: a small title and caption over its content. No box: space
 * between sections and the title do the separating.
 */
export function ProfileSection({
  title,
  caption,
  action,
  children,
  label,
}: {
  title: ReactNode;
  caption?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  /** The accessible name when the title is not plain text. */
  label?: string;
}) {
  return (
    <section aria-label={label} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-body font-medium text-text-2">{title}</h2>
          {caption ? <p className="mt-0.5 text-body-sm text-text-4">{caption}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A label inside a list that groups the rows under it, like the Instagram accounts. */
export function ProfileGroupLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-3 pb-1 text-caption text-text-4">{children}</p>;
}

const DOT_TONE = {
  on: "bg-green",
  pending: "bg-amber",
  off: "bg-text-5",
} as const;

/**
 * One line of a Perfil list: a status dot, a title over its detail, and the
 * row's buttons. Rows have no dividers; they light up on hover. `quiet` holds
 * the actions nobody needs at a glance (Desconectar): they show on hover or
 * focus, and always on touch screens. Anything that asks for attention, like
 * Reconectar or Conectar, goes in `actions` so it is always visible.
 */
export function ProfileRow({
  tone,
  title,
  detail,
  actions,
  quiet,
  children,
}: {
  tone?: keyof typeof DOT_TONE | undefined;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  quiet?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="group/row rounded-lg px-3 py-2.5 transition-colors duration-150 ease-out hover:bg-accent">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {tone ? (
            <span
              aria-hidden
              className={cn("inline-block size-2 shrink-0 rounded-full", DOT_TONE[tone])}
            />
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-body font-medium">{title}</p>
            {detail ? <p className="text-body-sm text-text-3">{detail}</p> : null}
          </div>
        </div>
        {quiet || actions ? (
          <div className="flex shrink-0 items-center gap-1">
            {quiet ? (
              <div className="flex opacity-0 transition-opacity duration-150 ease-out group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100">
                {quiet}
              </div>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
