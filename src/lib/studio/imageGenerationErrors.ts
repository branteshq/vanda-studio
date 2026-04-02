import { toUserFacingError } from "$lib/errors/userFacingError";

export const IMAGE_GENERATION_ERROR_DOMAIN = "image_generation";

export const imageGenerationErrorCodes = [
	"AUTH_REQUIRED",
	"PLAN_REQUIRED",
	"CREDITS_EXHAUSTED",
	"PROJECT_NOT_FOUND",
	"UNSUPPORTED_SETTINGS",
	"GENERATION_FAILED",
	"UPLOAD_FAILED",
	"UNKNOWN",
] as const;

export type ImageGenerationErrorCode = (typeof imageGenerationErrorCodes)[number];
export type ImageGenerationErrorAction = "view_plans" | "sign_in";
export type ImageGenerationErrorSurface = "inline" | "modal";

export type ImageGenerationErrorPayload = {
	domain: typeof IMAGE_GENERATION_ERROR_DOMAIN;
	code: ImageGenerationErrorCode;
	title: string;
	message: string;
	action?: ImageGenerationErrorAction;
};

export type ImageGenerationUiError = ImageGenerationErrorPayload & {
	surface: ImageGenerationErrorSurface;
	summary: string;
};

export function isImageGenerationErrorPayload(
	value: unknown
): value is ImageGenerationErrorPayload {
	if (!value || typeof value !== "object") return false;

	const candidate = value as Partial<ImageGenerationErrorPayload>;
	return (
		candidate.domain === IMAGE_GENERATION_ERROR_DOMAIN &&
		isImageGenerationErrorCode(candidate.code) &&
		typeof candidate.title === "string" &&
		typeof candidate.message === "string"
	);
}

export function isImageGenerationErrorCode(
	value: unknown
): value is ImageGenerationErrorCode {
	return typeof value === "string" && imageGenerationErrorCodes.includes(value as ImageGenerationErrorCode);
}

export function createImageGenerationUiError(
	code: ImageGenerationErrorCode,
	overrides: Partial<Omit<ImageGenerationUiError, "code" | "domain">> = {}
): ImageGenerationUiError {
	const defaults: Record<
		ImageGenerationErrorCode,
		Omit<ImageGenerationUiError, "code" | "domain">
	> = {
		AUTH_REQUIRED: {
			title: "Entre para gerar imagens",
			message: "Você precisa entrar na sua conta para continuar gerando imagens.",
			action: "sign_in",
			surface: "modal",
			summary: "Entre para continuar",
		},
		PLAN_REQUIRED: {
			title: "Assine um plano para gerar imagens",
			message: "Você ainda não tem um plano ativo. Escolha um plano para liberar a geração de imagens.",
			action: "view_plans",
			surface: "modal",
			summary: "Plano necessário",
		},
		CREDITS_EXHAUSTED: {
			title: "Seus créditos acabaram",
			message: "Você não tem créditos suficientes para gerar essas imagens agora. Veja seus planos para continuar.",
			action: "view_plans",
			surface: "modal",
			summary: "Créditos insuficientes",
		},
		PROJECT_NOT_FOUND: {
			title: "Projeto indisponível",
			message: "O projeto selecionado não foi encontrado. Escolha outro projeto e tente novamente.",
			surface: "inline",
			summary: "Projeto não encontrado",
		},
		UNSUPPORTED_SETTINGS: {
			title: "Configuração incompatível",
			message: "A combinação de modelo, proporção e resolução não é suportada.",
			surface: "inline",
			summary: "Ajuste as configurações",
		},
		GENERATION_FAILED: {
			title: "Não foi possível gerar agora",
			message: "A geração falhou desta vez. Tente novamente em instantes ou troque o modelo.",
			surface: "inline",
			summary: "Falha ao gerar imagens",
		},
		UPLOAD_FAILED: {
			title: "Falha no upload",
			message: "Não foi possível enviar sua imagem agora. Tente novamente em instantes.",
			surface: "inline",
			summary: "Falha no upload",
		},
		UNKNOWN: {
			title: "Algo deu errado",
			message: "Não foi possível concluir esta ação agora. Tente novamente em instantes.",
			surface: "inline",
			summary: "Erro inesperado",
		},
	};

	return {
		domain: IMAGE_GENERATION_ERROR_DOMAIN,
		code,
		...defaults[code],
		...overrides,
	};
}

export function normalizeImageGenerationError(
	error: unknown,
	fallbackCode: ImageGenerationErrorCode = "UNKNOWN"
): ImageGenerationUiError {
	const payload = (
		error &&
		typeof error === "object" &&
		"data" in error &&
		isImageGenerationErrorPayload((error as { data?: unknown }).data)
	)
		? (error as { data: ImageGenerationErrorPayload }).data
		: null;

	if (payload) {
		return createImageGenerationUiError(payload.code, payload);
	}

	const fallback = createImageGenerationUiError(fallbackCode);
	const safe = toUserFacingError(error);
	return {
		...fallback,
		title: safe.title,
		message: safe.message,
		summary: safe.message,
	};
}
