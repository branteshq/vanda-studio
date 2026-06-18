import { useId } from "react";

const PETAL = "M50 44 C 40 37 40.5 17 50 11 C 59.5 17 60 37 50 44 Z";
const ROTATIONS = [0, 72, 144, 216, 288];

/**
 * The Vanda orchid: five gradient petals radiating from center. Used for the
 * brand lockup, the profile avatar and the Assistente launcher.
 */
export function VandaMark({
	size = 26,
	from = "#ee7aaa",
	to = "#c4277f",
	className,
}: {
	size?: number;
	from?: string;
	to?: string;
	className?: string;
}) {
	const gradientId = useId();

	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 100 100"
			className={className}
			aria-hidden="true"
		>
			<defs>
				<linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stopColor={from} />
					<stop offset="100%" stopColor={to} />
				</linearGradient>
			</defs>
			<g fill={`url(#${gradientId})`}>
				{ROTATIONS.map((deg) => (
					<path key={deg} d={PETAL} transform={`rotate(${deg} 50 50)`} />
				))}
			</g>
		</svg>
	);
}
