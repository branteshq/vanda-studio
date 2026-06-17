type ButtonTone = "primary" | "secondary";

export function buttonClasses(options: { tone?: ButtonTone } = {}) {
	const tone = options.tone ?? "primary";
	return `button button-${tone}`;
}
