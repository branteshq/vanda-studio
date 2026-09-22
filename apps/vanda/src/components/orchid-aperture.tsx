import { useId } from "react";

const PETAL = "M50 44 C 40 37 40.5 17 50 11 C 59.5 17 60 37 50 44 Z";

const ROTATIONS = [0, 72, 144, 216, 288];

const CENTER = 300;

const RINGS: [number, number][] = [
  [265, 0.12],
  [212, 0.07],
  [150, 0.05],
];

const TICK_COUNT = 72;

const ACCENT_TICK = 9;

function polar(radius: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;

  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
}

/**
 * The orchid rendered as a camera diaphragm: lens rings, a focus dial with a
 * single accent tick ("the moment"), a ghost echo and the gradient bloom.
 */
export function OrchidAperture() {
  const gradientId = useId();

  const ticks = [];

  for (let i = 0; i < TICK_COUNT; i++) {
    if (i === ACCENT_TICK) continue;
    const deg = -90 + (i / TICK_COUNT) * 360;
    const major = i % 6 === 0;
    const [x1, y1] = polar(245, deg);
    const [x2, y2] = polar(major ? 232 : 238, deg);
    ticks.push({ x1, y1, x2, y2, major, i });
  }

  const accentDeg = -90 + (ACCENT_TICK / TICK_COUNT) * 360;
  const [ax1, ay1] = polar(248, accentDeg);
  const [ax2, ay2] = polar(226, accentDeg);
  const [adx, ady] = polar(258, accentDeg);

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 600 600"
      className="block overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-orchid-petal)" />
          <stop offset="100%" stopColor="var(--color-primary)" />
        </linearGradient>
      </defs>

      {RINGS.map(([r, opacity]) => (
        <circle
          key={r}
          cx={CENTER}
          cy={CENTER}
          r={r}
          fill="none"
          stroke="var(--color-orchid-petal)"
          strokeWidth={1}
          opacity={opacity}
        />
      ))}

      {ROTATIONS.map((deg) => {
        const [x, y] = polar(265, -90 + deg);

        return (
          <line
            key={deg}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            stroke="var(--color-orchid-petal)"
            strokeWidth={1}
            opacity={0.045}
          />
        );
      })}

      {ticks.map((t) => (
        <line
          key={t.i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke="var(--color-orchid-petal)"
          strokeWidth={1}
          opacity={t.major ? 0.16 : 0.09}
        />
      ))}

      <line
        x1={ax1}
        y1={ay1}
        x2={ax2}
        y2={ay2}
        stroke="var(--color-orchid-highlight)"
        strokeWidth={2}
        opacity={0.95}
        strokeLinecap="round"
      />
      <circle cx={adx} cy={ady} r={3.2} fill="var(--color-orchid-highlight)" />

      <g
        transform={`translate(${CENTER} ${CENTER}) rotate(36) scale(4.05) translate(-50 -50)`}
        opacity={0.14}
      >
        {ROTATIONS.map((deg) => (
          <path
            key={deg}
            d={PETAL}
            fill="none"
            stroke="var(--color-orchid-petal)"
            strokeWidth={0.4}
            transform={`rotate(${deg} 50 50)`}
          />
        ))}
      </g>

      <g transform={`translate(${CENTER} ${CENTER}) scale(3.5) translate(-50 -50)`}>
        {ROTATIONS.map((deg) => (
          <path
            key={deg}
            d={PETAL}
            fill={`url(#${gradientId})`}
            transform={`rotate(${deg} 50 50)`}
          />
        ))}
      </g>

      <circle
        cx={CENTER}
        cy={CENTER}
        r={11}
        fill="var(--color-orchid-core)"
        stroke="var(--color-orchid-highlight)"
        strokeOpacity={0.55}
        strokeWidth={1.4}
      />
      <circle cx={CENTER} cy={CENTER} r={3} fill="var(--color-orchid-highlight)" />
    </svg>
  );
}
