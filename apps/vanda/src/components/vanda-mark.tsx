import { useId } from "react";

// The canonical Vanda mark (matches @vanda-studio/ui/assets/vanda-mark.svg, the
// favicon): six gradient petals radiating from a light center. One petal path,
// rotated in 60° steps.
const PETAL = "M0,0 C -8,-14 -10,-31 0,-45 C 10,-31 8,-14 0,0 Z";
const ROTATIONS = [0, 60, 120, 180, 240, 300];

/**
 * The Vanda mark: six gradient petals radiating from center with a light core.
 * Used for the brand lockup, the profile avatar and the Assistente launcher.
 * Passing a single flat color to both `from` and `to` (e.g. `currentColor`)
 * renders a monochrome silhouette — the core is dropped so it reads as one tint.
 */
export function VandaMark({
  size = 26,
  from = "#B83280",
  to = "#F2719E",
  className,
}: {
  size?: number;
  from?: string;
  to?: string;
  className?: string;
}) {
  const gradientId = useId();
  const monochrome = from === to;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="14" y1="12" x2="86" y2="90">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <g fill={`url(#${gradientId})`}>
        {ROTATIONS.map((deg) => (
          <path key={deg} d={PETAL} transform={`translate(50,50) rotate(${deg})`} />
        ))}
      </g>
      {monochrome ? null : <circle cx="50" cy="50" r="6" fill="#FBEFF6" />}
    </svg>
  );
}
