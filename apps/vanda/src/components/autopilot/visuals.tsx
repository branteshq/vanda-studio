import type { CSSProperties, ReactNode } from "react";
import {
  BadgeCheck,
  Building2,
  Clapperboard,
  GalleryHorizontalEnd,
  GraduationCap,
  ImageIcon,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { AutopilotSlotView } from "../../convex/autopilotData";
import { purposeLabels } from "../../convex/pipeline/autopilot";
import type { PostPurpose } from "../../convex/postPurposes";
import { SLOT_STATUS, slidesLabel } from "./week-strip";

/**
 * The autopilot's figures, built to the dataviz specs: stat tiles with
 * same-ramp meters, a thin part-to-whole status bar with a legend, and purpose groups carried by icon + label (never by color —
 * status hues stay reserved for state).
 */

// ------------------------------------------------------------------ stat tile

export type MeterTone = "accent" | "good" | "warning" | "danger";

const METER_FILL: Record<MeterTone, string> = {
  accent: "bg-brand-accent",
  good: "bg-green",
  warning: "bg-amber",
  danger: "bg-destructive",
};

const METER_TRACK: Record<MeterTone, string> = {
  accent: "bg-brand-accent/15",
  good: "bg-green/15",
  warning: "bg-amber/15",
  danger: "bg-destructive/15",
};

export function Meter({ ratio, tone, label }: { ratio: number; tone: MeterTone; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100);

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-1.5 w-full overflow-hidden rounded-full", METER_TRACK[tone])}
    >
      <div
        className={cn("h-full w-(--fill) rounded-full transition-all", METER_FILL[tone])}
        // SAFETY: React accepts custom properties at runtime; CSSProperties omits their open-ended names.
        style={{ "--fill": `${percent}%` } as CSSProperties}
      />
    </div>
  );
}

export function StatTile({
  label,
  value,
  suffix,
  hint,
  meter,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  suffix?: string | undefined;
  hint?: string | undefined;
  meter?: { ratio: number; tone: MeterTone } | undefined;
  tone?: "needs" | undefined;
  onClick?: (() => void) | undefined;
}) {
  const body = (
    <>
      <span className="text-caption text-text-4">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="text-2xl leading-none font-semibold text-text">{value}</span>
        {suffix ? <span className="text-note text-text-4">{suffix}</span> : null}
      </span>
      {meter ? <Meter ratio={meter.ratio} tone={meter.tone} label={label} /> : null}
      {hint ? <span className="truncate text-micro text-text-5">{hint}</span> : null}
    </>
  );

  const className = cn(
    "grid min-w-0 content-start gap-1.5 rounded-lg border p-3 text-left",
    tone === "needs" ? "border-needs-border bg-needs-bg" : "border-border bg-surface",
    onClick && "transition-colors hover:border-border-strong",
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Profile score severity: the meter says how urgent the profile work is. */
export const scoreTone = (score: number): MeterTone => {
  if (score >= 60) return "accent";

  if (score >= 40) return "warning";

  return "danger";
};

// ----------------------------------------------------------------- status bar

const STATUS_ORDER = [
  "published",
  "scheduled",
  "awaiting_approval",
  "generating",
  "planned",
  "failed",
  "skipped",
] as const satisfies readonly AutopilotSlotView["status"][];

export const STATUS_FILL: Record<AutopilotSlotView["status"], string> = {
  published: "bg-green",
  scheduled: "bg-green/45",
  awaiting_approval: "bg-amber",
  generating: "bg-brand-accent",
  planned: "bg-peri/60",
  failed: "bg-destructive",
  skipped: "bg-border-strong",
};

/** Part-to-whole of the week's posts by state: thin bar, 2px gaps, legend with counts. */
export function StatusBar({ slots }: { slots: readonly AutopilotSlotView[] }) {
  const counts = STATUS_ORDER.flatMap((status) => {
    const n = slots.filter((slot) => slot.status === status).length;

    return n > 0 ? [{ status, n }] : [];
  });

  if (counts.length === 0) return null;

  const summary = counts.map(({ status, n }) => `${n} ${SLOT_STATUS[status].label.toLowerCase()}`);

  return (
    <figure className="grid gap-2" aria-label={`Posts da semana: ${summary.join(", ")}`}>
      <div className="flex h-2 gap-0.5">
        {counts.map(({ status, n }) => (
          <ActionTooltip key={status} label={`${SLOT_STATUS[status].label}: ${n}`} side="top">
            <span
              className={cn("min-w-1.5 grow-(--n) basis-0 rounded-sm", STATUS_FILL[status])}
              // SAFETY: React accepts custom properties at runtime; CSSProperties omits their open-ended names.
              style={{ "--n": n } as CSSProperties}
            />
          </ActionTooltip>
        ))}
      </div>
      <figcaption className="flex flex-wrap gap-x-3 gap-y-1">
        {counts.map(({ status, n }) => (
          <span key={status} className="inline-flex items-center gap-1.5 text-micro text-text-3">
            <span className={cn("size-2 rounded-full", STATUS_FILL[status])} aria-hidden="true" />
            {SLOT_STATUS[status].label}
            <span className="font-medium text-text-2">{n}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ slide pips

/** One dot per slide: how big the post is, at a glance. */
export function SlidePips({ count, type }: { count: number; type: "image" | "carousel" }) {
  const Icon = type === "carousel" ? GalleryHorizontalEnd : ImageIcon;

  return (
    <span className="inline-flex items-center gap-1" aria-label={slidesLabel(count)}>
      <Icon className="size-3 text-text-4" aria-hidden="true" />
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {Array.from({ length: Math.min(count, 10) }, (_, index) => (
          <span key={index} className="size-1 rounded-full bg-text-4" />
        ))}
      </span>
    </span>
  );
}

// -------------------------------------------------------------- purpose groups

export interface PurposeGroup {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly purposes: readonly PostPurpose[];
}

/** The 14 purposes folded into five jobs a post can do for the account. */
export const PURPOSE_GROUPS: readonly PurposeGroup[] = [
  {
    key: "teach",
    label: "Ensinar",
    icon: GraduationCap,
    purposes: ["educacional", "informativo", "dados"],
  },
  { key: "prove", label: "Provar", icon: BadgeCheck, purposes: ["prova_social"] },
  {
    key: "story",
    label: "Bastidores",
    icon: Clapperboard,
    purposes: ["bastidores", "storytelling", "employer_branding", "expressao_cultural"],
  },
  {
    key: "sell",
    label: "Vender",
    icon: ShoppingBag,
    purposes: ["produto", "promocional", "anuncio"],
  },
  {
    key: "brand",
    label: "Marca",
    icon: Building2,
    purposes: ["institucional", "editorial", "comunidade"],
  },
];

export const purposeGroupOf = (purpose: PostPurpose): PurposeGroup =>
  PURPOSE_GROUPS.find((group) => group.purposes.includes(purpose)) ?? PURPOSE_GROUPS[4]!;

/** The week's content mix: one tile per job, icon + count; empty jobs fade out. */
export function PurposeMix({ slots }: { slots: readonly AutopilotSlotView[] }) {
  const active = slots.filter((slot) => slot.status !== "skipped");

  return (
    <ul className="grid grid-cols-5 gap-1.5" aria-label="Mistura de conteúdo da semana">
      {PURPOSE_GROUPS.map((group) => {
        const n = active.filter((slot) => group.purposes.includes(slot.purpose)).length;
        const Icon = group.icon;

        return (
          <li key={group.key}>
            <ActionTooltip
              label={`${group.label}: ${group.purposes.map((purpose) => purposeLabels[purpose]).join(", ")}`}
              side="top"
            >
              <span
                className={cn(
                  "grid justify-items-center gap-1 rounded-md border border-border px-1 py-2",
                  n > 0 ? "bg-surface" : "bg-inset/40 opacity-50",
                )}
              >
                <Icon className="size-4 text-text-3" aria-hidden="true" />
                <span className="text-base leading-none font-semibold text-text">{n}</span>
                <span className="text-micro text-text-4">{group.label}</span>
              </span>
            </ActionTooltip>
          </li>
        );
      })}
    </ul>
  );
}

/** A labelled panel section: one short title, the figure carries the rest. */
export function PanelSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-caption font-semibold tracking-wide text-text-4 uppercase">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
