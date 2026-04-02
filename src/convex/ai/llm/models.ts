/**
 * Available AI models via OpenRouter
 */
export const MODELS = {
    // Analysis - fast and cost-effective
    GEMINI_2_5_FLASH: "google/gemini-2.5-flash",
    /** Structured JSON / brand onboarding — newer flash on OpenRouter */
    GEMINI_3_FLASH_PREVIEW: "google/gemini-3-flash-preview",
    /** Structured JSON / brand onboarding — strong instruction-following MoE */
    KIMI_K2: "moonshotai/kimi-k2-0905",
    // Caption generation - high quality creative writing
    GPT_4_1: "openai/gpt-4.1",
    // Image generation (legacy - use IMAGE_MODELS instead)
    GEMINI_3_PRO_IMAGE: "google/gemini-3-pro-image-preview",
    // Web search - Perplexity Sonar has built-in web search
    PERPLEXITY_SONAR: "perplexity/sonar-pro",
    // Vision analysis - for analyzing images
    GEMINI_2_5_FLASH_VISION: "google/gemini-2.5-flash",
} as const;

export type ModelName = (typeof MODELS)[keyof typeof MODELS];

// Default model for analysis tasks
export const DEFAULT_MODEL = MODELS.GEMINI_2_5_FLASH;

// ============================================================================
// Image Generation Models
// ============================================================================

export const IMAGE_MODELS = {
    NANO_BANANA: "google/gemini-2.5-flash-image",
    NANO_BANANA_2: "google/gemini-3.1-flash-image-preview",
    NANO_BANANA_PRO: "google/gemini-3-pro-image-preview",
    SEEDREAM_4_5: "bytedance-seed/seedream-4.5",
    FLUX_2_FLEX: "black-forest-labs/flux.2-flex",
    GPT_IMAGE_1_5: "openai/gpt-5-image",
} as const;

export type ImageModelName = (typeof IMAGE_MODELS)[keyof typeof IMAGE_MODELS];

export const DEFAULT_IMAGE_MODEL = IMAGE_MODELS.NANO_BANANA_2;

/**
 * Model capabilities for image generation
 */
export const IMAGE_MODEL_CAPABILITIES: Record<
    ImageModelName,
    {
        supportsImageSize: boolean;
        type: "multimodal" | "dedicated";
        outputModalities: ["image"] | ["image", "text"];
    }
> = {
    [IMAGE_MODELS.NANO_BANANA]: {
        supportsImageSize: true,
        type: "multimodal",
        outputModalities: ["image", "text"],
    },
    [IMAGE_MODELS.NANO_BANANA_2]: {
        supportsImageSize: true,
        type: "multimodal",
        outputModalities: ["image", "text"],
    },
    [IMAGE_MODELS.NANO_BANANA_PRO]: {
        supportsImageSize: true,
        type: "multimodal",
        outputModalities: ["image", "text"],
    },
    [IMAGE_MODELS.SEEDREAM_4_5]: {
        supportsImageSize: false,
        type: "dedicated",
        outputModalities: ["image"], // Image only - no text output
    },
    [IMAGE_MODELS.FLUX_2_FLEX]: {
        supportsImageSize: false,
        type: "dedicated",
        outputModalities: ["image"], // Image only - no text output
    },
    [IMAGE_MODELS.GPT_IMAGE_1_5]: {
        supportsImageSize: false,
        type: "multimodal",
        outputModalities: ["image", "text"],
    },
};

/**
 * Model metadata for UI display
 */
export const IMAGE_MODEL_INFO: Record<
    ImageModelName,
    { name: string; provider: string; color: string }
> = {
    [IMAGE_MODELS.NANO_BANANA]: {
        name: "Nano Banana",
        provider: "Google",
        color: "#FACC15", // yellow
    },
    [IMAGE_MODELS.NANO_BANANA_2]: {
        name: "Nano Banana 2",
        provider: "Google",
        color: "#FACC15", // yellow
    },
    [IMAGE_MODELS.NANO_BANANA_PRO]: {
        name: "Nano Banana Pro",
        provider: "Google",
        color: "#FACC15", // yellow
    },
    [IMAGE_MODELS.SEEDREAM_4_5]: {
        name: "SeeDream v4.5",
        provider: "ByteDance",
        color: "#8B5CF6", // purple
    },
    [IMAGE_MODELS.FLUX_2_FLEX]: {
        name: "Flux 2 Flex",
        provider: "BFL",
        color: "#1F2937", // dark gray
    },
    [IMAGE_MODELS.GPT_IMAGE_1_5]: {
        name: "GPT Image 1.5",
        provider: "OpenAI",
        color: "#EC4899", // pink
    },
};

// ============================================================================
// Caption Generation Models
// ============================================================================

export const CAPTION_MODELS = {
    KIMI_K2: MODELS.KIMI_K2,
    GEMINI_2_5_FLASH: "google/gemini-2.5-flash",
    GPT_4_1: "openai/gpt-4.1",
} as const;

export type CaptionModelName = (typeof CAPTION_MODELS)[keyof typeof CAPTION_MODELS];

export const DEFAULT_CAPTION_MODEL = CAPTION_MODELS.KIMI_K2;

export const CAPTION_MODEL_INFO: Record<
    CaptionModelName,
    { name: string; provider: string; color: string }
> = {
    [CAPTION_MODELS.KIMI_K2]: {
        name: "Kimi K2",
        provider: "Moonshot",
        color: "#6366F1", // indigo
    },
    [CAPTION_MODELS.GPT_4_1]: {
        name: "GPT 4.1",
        provider: "OpenAI",
        color: "#EC4899", // pink
    },
    [CAPTION_MODELS.GEMINI_2_5_FLASH]: {
        name: "Flash 2.5",
        provider: "Google",
        color: "#FACC15", // yellow
    },
};
