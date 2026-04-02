export const STUDIO_CREDIT_FEATURE_ID = "studio_credits" as const;

export const PLAN_CREDITS = {
    basico: 100,
    mediano: 200,
    profissional: 400,
} as const;

export const AI_CREDIT_FEATURE_COSTS = {
    caption_flash: 0.1,
    caption_premium: 0.25,
    image_standard: 1,
    image_plus: 1.5,
    image_pro: 3,
    image_premium: 4,
} as const;

export type AiCreditFeatureId = keyof typeof AI_CREDIT_FEATURE_COSTS;

export type UsageLineItem = {
    featureId: AiCreditFeatureId;
    quantity: number;
    credits: number;
    label: string;
};

export type ModelCreditInfo = {
    featureId: AiCreditFeatureId;
    credits: number;
    label: string;
    shortLabel: string;
};

export const IMAGE_MODEL_CREDIT_INFO: Record<string, ModelCreditInfo> = {
    "google/gemini-2.5-flash-image": {
        featureId: "image_standard",
        credits: AI_CREDIT_FEATURE_COSTS.image_standard,
        label: "1 credito",
        shortLabel: "1c",
    },
    "google/gemini-3.1-flash-image-preview": {
        featureId: "image_standard",
        credits: AI_CREDIT_FEATURE_COSTS.image_standard,
        label: "1 credito",
        shortLabel: "1c",
    },
    "google/gemini-3-pro-image-preview": {
        featureId: "image_pro",
        credits: AI_CREDIT_FEATURE_COSTS.image_pro,
        label: "3 creditos",
        shortLabel: "3c",
    },
    "bytedance-seed/seedream-4.5": {
        featureId: "image_standard",
        credits: AI_CREDIT_FEATURE_COSTS.image_standard,
        label: "1 credito",
        shortLabel: "1c",
    },
    "black-forest-labs/flux.2-flex": {
        featureId: "image_plus",
        credits: AI_CREDIT_FEATURE_COSTS.image_plus,
        label: "1,5 credito",
        shortLabel: "1,5c",
    },
    "openai/gpt-5-image": {
        featureId: "image_premium",
        credits: AI_CREDIT_FEATURE_COSTS.image_premium,
        label: "4 creditos",
        shortLabel: "4c",
    },
};

export const CAPTION_MODEL_CREDIT_INFO: Record<string, ModelCreditInfo> = {
    "moonshotai/kimi-k2-0905": {
        featureId: "caption_premium",
        credits: AI_CREDIT_FEATURE_COSTS.caption_premium,
        label: "0,25 credito",
        shortLabel: "0,25c",
    },
    "openai/gpt-4.1": {
        featureId: "caption_premium",
        credits: AI_CREDIT_FEATURE_COSTS.caption_premium,
        label: "0,25 credito",
        shortLabel: "0,25c",
    },
    "google/gemini-2.5-flash": {
        featureId: "caption_flash",
        credits: AI_CREDIT_FEATURE_COSTS.caption_flash,
        label: "0,1 credito",
        shortLabel: "0,1c",
    },
};

const FALLBACK_IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";
const FALLBACK_CAPTION_MODEL = "moonshotai/kimi-k2-0905";

function roundCredits(value: number): number {
    return Math.round(value * 100) / 100;
}

export function formatCredits(
    value: number,
    maximumFractionDigits = 1
): string {
    return new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: value % 1 === 0 ? 0 : 1,
        maximumFractionDigits,
    }).format(value);
}

export function getImageModelCreditInfo(model: string): ModelCreditInfo {
    const info = IMAGE_MODEL_CREDIT_INFO[model] ?? IMAGE_MODEL_CREDIT_INFO[FALLBACK_IMAGE_MODEL];
    if (!info) {
        throw new Error(`Missing image credit info for model: ${model}`);
    }
    return info;
}

export function getCaptionModelCreditInfo(model: string): ModelCreditInfo {
    const info =
        CAPTION_MODEL_CREDIT_INFO[model] ?? CAPTION_MODEL_CREDIT_INFO[FALLBACK_CAPTION_MODEL];
    if (!info) {
        throw new Error(`Missing caption credit info for model: ${model}`);
    }
    return info;
}

export function estimateImageLineItem(model: string, label?: string): UsageLineItem {
    const info = getImageModelCreditInfo(model);
    return {
        featureId: info.featureId,
        quantity: 1,
        credits: info.credits,
        label: label ?? model,
    };
}

export function estimateCaptionLineItem(model: string, label = "caption"): UsageLineItem {
    const info = getCaptionModelCreditInfo(model);
    return {
        featureId: info.featureId,
        quantity: 1,
        credits: info.credits,
        label,
    };
}

export function sumUsageLineItemCredits(items: UsageLineItem[]): number {
    return roundCredits(items.reduce((total, item) => total + item.credits, 0));
}

export function groupUsageLineItems(items: UsageLineItem[]): UsageLineItem[] {
    const grouped = new Map<
        AiCreditFeatureId,
        { quantity: number; credits: number; labels: string[] }
    >();

    for (const item of items) {
        const current = grouped.get(item.featureId);
        if (current) {
            current.quantity += item.quantity;
            current.credits = roundCredits(current.credits + item.credits);
            current.labels.push(item.label);
            continue;
        }

        grouped.set(item.featureId, {
            quantity: item.quantity,
            credits: item.credits,
            labels: [item.label],
        });
    }

    return Array.from(grouped.entries()).map(([featureId, value]) => ({
        featureId,
        quantity: value.quantity,
        credits: value.credits,
        label: value.labels.join(", "),
    }));
}

export function estimateImageBatchUsage(models: string[]): UsageLineItem[] {
    return models.map((model) => estimateImageLineItem(model));
}

export function estimateCaptionUsage(model: string): UsageLineItem[] {
    return [estimateCaptionLineItem(model)];
}

export function estimateImageEditUsage(models: string[]): UsageLineItem[] {
    return models.map((model) => estimateImageLineItem(model, `edit:${model}`));
}
