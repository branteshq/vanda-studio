export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "21:9";
export type Resolution = "standard" | "high" | "ultra";

export const IMAGE_MODEL_IDS = {
	NANO_BANANA: "google/gemini-2.5-flash-image",
	NANO_BANANA_2: "google/gemini-3.1-flash-image-preview",
	NANO_BANANA_PRO: "google/gemini-3-pro-image-preview",
	SEEDREAM_4_5: "bytedance-seed/seedream-4.5",
	FLUX_2_FLEX: "black-forest-labs/flux.2-flex",
	GPT_IMAGE_1_5: "openai/gpt-5-image",
} as const;

/** Default image model for studio UI and new generations (matches Convex `DEFAULT_IMAGE_MODEL`). */
export const DEFAULT_STUDIO_IMAGE_MODEL = IMAGE_MODEL_IDS.NANO_BANANA_2;

export const ASPECT_RATIO_LIST: AspectRatio[] = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"];
export const RESOLUTION_LIST: Resolution[] = ["standard", "high", "ultra"];

type ModelCapabilities = {
	aspectRatios: readonly AspectRatio[];
	resolutions: readonly Resolution[];
};

const ALL_ASPECT_RATIOS = [...ASPECT_RATIO_LIST] as const;
const ALL_RESOLUTIONS = [...RESOLUTION_LIST] as const;

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
	[IMAGE_MODEL_IDS.NANO_BANANA]: {
		aspectRatios: ALL_ASPECT_RATIOS,
		resolutions: ["standard"],
	},
	[IMAGE_MODEL_IDS.NANO_BANANA_2]: {
		aspectRatios: ALL_ASPECT_RATIOS,
		resolutions: ALL_RESOLUTIONS,
	},
	[IMAGE_MODEL_IDS.NANO_BANANA_PRO]: {
		aspectRatios: ALL_ASPECT_RATIOS,
		resolutions: ALL_RESOLUTIONS,
	},
	[IMAGE_MODEL_IDS.SEEDREAM_4_5]: {
		aspectRatios: ALL_ASPECT_RATIOS,
		resolutions: ALL_RESOLUTIONS,
	},
	[IMAGE_MODEL_IDS.FLUX_2_FLEX]: {
		aspectRatios: ALL_ASPECT_RATIOS,
		resolutions: ["standard", "high"],
	},
	[IMAGE_MODEL_IDS.GPT_IMAGE_1_5]: {
		aspectRatios: ["1:1", "16:9", "9:16"],
		resolutions: ["standard"],
	},
};

function getCapabilities(model: string): ModelCapabilities {
	return MODEL_CAPABILITIES[model] ?? {
		aspectRatios: ALL_ASPECT_RATIOS,
		resolutions: ALL_RESOLUTIONS,
	};
}

export function getSupportedAspectRatios(selectedModels: string[]): AspectRatio[] {
	if (selectedModels.length === 0) {
		return [...ASPECT_RATIO_LIST];
	}

	let supported = new Set<AspectRatio>(ASPECT_RATIO_LIST);
	for (const model of selectedModels) {
		const capabilities = getCapabilities(model);
		supported = new Set(capabilities.aspectRatios.filter((ratio) => supported.has(ratio)));
	}

	return ASPECT_RATIO_LIST.filter((ratio) => supported.has(ratio));
}

export function getSupportedResolutions(selectedModels: string[]): Resolution[] {
	if (selectedModels.length === 0) {
		return [...RESOLUTION_LIST];
	}

	let supported = new Set<Resolution>(RESOLUTION_LIST);
	for (const model of selectedModels) {
		const capabilities = getCapabilities(model);
		supported = new Set(capabilities.resolutions.filter((resolution) => supported.has(resolution)));
	}

	return RESOLUTION_LIST.filter((resolution) => supported.has(resolution));
}

export function coerceImageGenerationSettings(
	selectedModels: string[],
	aspectRatio: string | undefined,
	resolution: string | undefined
): {
	aspectRatio: AspectRatio;
	resolution: Resolution;
	supportedAspectRatios: AspectRatio[];
	supportedResolutions: Resolution[];
} {
	const supportedAspectRatios = getSupportedAspectRatios(selectedModels);
	const supportedResolutions = getSupportedResolutions(selectedModels);

	const nextAspectRatio =
		aspectRatio && supportedAspectRatios.includes(aspectRatio as AspectRatio)
			? (aspectRatio as AspectRatio)
			: (supportedAspectRatios[0] ?? "1:1");

	const nextResolution =
		resolution && supportedResolutions.includes(resolution as Resolution)
			? (resolution as Resolution)
			: (supportedResolutions.includes("standard")
				? "standard"
				: (supportedResolutions[0] ?? "standard"));

	return {
		aspectRatio: nextAspectRatio,
		resolution: nextResolution,
		supportedAspectRatios,
		supportedResolutions,
	};
}
