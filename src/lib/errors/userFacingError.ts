/**
 * Maps any thrown value (Convex, network, etc.) to copy safe to show in the UI.
 * Never surfaces raw stack traces, request IDs, or English internal errors when avoidable.
 */

export type UserFacingErrorIntent = "none" | "account_plans" | "sign_in";

export type UserFacingError = {
	title: string;
	message: string;
	/** Optional UX hint for toasts (e.g. CTA to billing). */
	intent?: UserFacingErrorIntent;
	/** Toast shows only the title (no long description). */
	toastBodyOnly?: boolean;
};

const DEFAULT: UserFacingError = {
	title: "Não foi possível concluir",
	message:
		"Algo deu errado do nosso lado. Tente de novo em instantes. Se continuar, fale com o suporte.",
	intent: "none",
};

const STUDIO_ERROR_DOMAIN = "image_generation";

type StructuredStudioPayload = {
	domain: string;
	code: string;
	title?: string;
	message?: string;
};

function parseStudioStructuredError(error: unknown): StructuredStudioPayload | null {
	if (!error || typeof error !== "object") return null;
	let data: unknown = (error as { data?: unknown }).data;
	if (data === undefined) data = error;
	if (!data || typeof data !== "object") return null;
	const o = data as Record<string, unknown>;
	if (typeof o.domain !== "string" || typeof o.code !== "string") return null;
	const out: StructuredStudioPayload = { domain: o.domain, code: o.code };
	if (typeof o.title === "string") out.title = o.title;
	if (typeof o.message === "string") out.message = o.message;
	return out;
}

function polishNao(text: string | undefined): string | undefined {
	if (!text) return undefined;
	return text
		.replace(/\bNao\b/g, "Não")
		.replace(/\bnao\b/g, "não")
		.replace(/\bVoce\b/g, "Você")
		.replace(/\bvoce\b/g, "você");
}

function mapStructuredStudioError(s: StructuredStudioPayload): UserFacingError {
	const detail = (s.message ?? "").trim();

	if (s.domain === STUDIO_ERROR_DOMAIN) {
		switch (s.code) {
			case "CREDITS_EXHAUSTED":
				return {
					title: "Créditos insuficientes",
					message: "",
					intent: "account_plans",
					toastBodyOnly: true,
				};
			case "PLAN_REQUIRED":
				return {
					title: "Plano necessário",
					message: (polishNao(detail) ?? detail) || "Assine um plano para usar recursos com IA.",
					intent: "account_plans",
				};
			case "AUTH_REQUIRED":
				return {
					title: "Sessão necessária",
					message: (polishNao(detail) ?? detail) || "Entre na sua conta para continuar.",
					intent: "sign_in",
				};
			case "PROJECT_NOT_FOUND":
				return {
					title: "Projeto indisponível",
					message: (polishNao(detail) ?? detail) || "O projeto não foi encontrado ou você não tem acesso.",
				};
			case "UNSUPPORTED_SETTINGS":
				return {
					title: "Configuração não suportada",
					message:
						(polishNao(detail) ?? detail) ||
						"Esse modelo não aceita a combinação de proporção e resolução escolhida. Ajuste e tente de novo.",
				};
			case "UPLOAD_FAILED":
				return {
					title: "Envio da imagem falhou",
					message:
						(polishNao(detail) ?? detail) ||
						"Não foi possível enviar a imagem. Tente outro arquivo ou mais tarde.",
				};
			case "GENERATION_FAILED":
				return {
					title: "Geração não concluída",
					message:
						(polishNao(detail) ?? detail) ||
						"O provedor de imagem não concluiu desta vez. Troque de modelo ou simplifique o pedido.",
				};
			default:
				return {
					title: polishNao(s.title) ?? "Não foi possível concluir",
					message: (polishNao(detail) ?? detail) || DEFAULT.message,
				};
		}
	}

	return {
		title: polishNao(s.title) ?? DEFAULT.title,
		message: (polishNao(detail) ?? detail) || DEFAULT.message,
	};
}

function isBillingOrCreditCopy(message: string): boolean {
	const l = message.toLowerCase();
	const hasCredit = l.includes("credito") || l.includes("crédito");
	const hasPlan =
		l.includes("plano") ||
		l.includes("planos") ||
		l.includes("acao") ||
		l.includes("ação") ||
		l.includes("disponiveis") ||
		l.includes("disponíveis");
	return hasCredit && hasPlan;
}

/** Plain-text credit messages from billing (often ASCII / unaccented). */
function matchCreditLimitPlainText(inner: string): UserFacingError | null {
	const l = inner.toLowerCase();
	if (!l.includes("credito") && !l.includes("crédito")) return null;
	if (
		/esta\s+acao\s+precisa\s+de/.test(l) ||
		/voce\s+so\s+tem/.test(l) ||
		/veja\s+seus\s+planos/.test(l) ||
		/liberar\s+a\s+geracao\s+com\s+creditos/.test(l) ||
		/geracao\s+com\s+creditos/.test(l)
	) {
		return {
			title: "Créditos insuficientes",
			message: "",
			intent: "account_plans",
			toastBodyOnly: true,
		};
	}
	return null;
}

const CONVEX_PREFIX =
	/^\[CONVEX [^\]]+\]\s*(?:\[Request ID:[^\]]+\]\s*)?(?:Uncaught\s+)?(?:Error:\s*)?/i;
const SERVER_ERROR_NOISE = /Server Error\s*(?:Called by client)?\s*/gi;

function stripConvexNoise(text: string): string {
	let t = text.replace(CONVEX_PREFIX, "").replace(SERVER_ERROR_NOISE, "").trim();
	t = t.replace(/^Uncaught\s+Error:\s*/i, "").trim();
	return t;
}

function looksTechnical(message: string): boolean {
	if (isBillingOrCreditCopy(message)) {
		return false;
	}
	const lower = message.toLowerCase();
	return (
		lower.includes("convex") ||
		lower.includes("request id") ||
		lower.includes("typeerror") ||
		lower.includes("referenceerror") ||
		lower.includes("syntaxerror") ||
		lower.includes("ecdsa") ||
		lower.includes("json.parse") ||
		/\.(ts|js|tsx|jsx):\d+/.test(message) ||
		/\bat\s+[\w./]+:\d+/.test(message) ||
		lower.includes("undefined is not") ||
		lower.includes("cannot read propert") ||
		lower.includes("failed to fetch") ||
		lower.includes("networkerror") ||
		lower.includes("load failed") ||
		(message.length > 320 && !isBillingOrCreditCopy(message))
	);
}

function normalizeKey(message: string): string {
	return stripConvexNoise(message)
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(/[.!?…]+$/u, "")
		.trim();
}

/** Known backend / product strings → user-facing copy (never echo raw). */
const KNOWN: Record<string, UserFacingError> = (() => {
	const pairs: [string, UserFacingError][] = [
		[
			"entre antes de exportar pdf",
			{
				title: "Exportação indisponível",
				message: "Entre na sua conta para exportar o PDF.",
			},
		],
		["not authenticated", { title: "Sessão necessária", message: "Entre na sua conta para continuar." }],
		["não autenticado", { title: "Sessão necessária", message: "Entre na sua conta para continuar." }],
		["você precisa estar autenticado", { title: "Sessão necessária", message: "Entre na sua conta para continuar." }],
		["must be signed in to fetch instagram data", { title: "Sessão necessária", message: "Entre na sua conta para continuar." }],
		["called storeuser without authentication present", { title: "Sessão necessária", message: "Entre na sua conta para continuar." }],
		["called ensurecurrentuser without authentication present", { title: "Sessão necessária", message: "Entre na sua conta para continuar." }],
		["called create project without authentication present", { title: "Sessão necessária", message: "Entre na sua conta para continuar." }],
		["called replaceforproject without authentication", { title: "Sessão necessária", message: "Entre na sua conta para continuar." }],
		["called updatemediastorage without authentication", { title: "Sessão necessária", message: "Entre na sua conta para continuar." }],
		["project not found", { title: "Projeto não encontrado", message: "Esse projeto não existe ou você não tem acesso." }],
		["projeto não encontrado", { title: "Projeto não encontrado", message: "Esse projeto não existe ou você não tem acesso." }],
		["project not found after update", { title: "Projeto indisponível", message: "Não encontramos o projeto após salvar. Atualize a página e tente de novo." }],
		["post not found", { title: "Post não encontrado", message: "Esse post não existe mais ou foi removido." }],
		["post não encontrado", { title: "Post não encontrado", message: "Esse post não existe mais ou foi removido." }],
		["generated post not found", { title: "Post não encontrado", message: "Esse post não existe mais ou foi removido." }],
		["user not found", { title: "Conta indisponível", message: "Não encontramos sua conta. Entre novamente." }],
		["conversation not found", { title: "Conversa não encontrada", message: "Essa conversa não existe mais." }],
		["conversa não encontrada", { title: "Conversa não encontrada", message: "Essa conversa não existe mais." }],
		["turno não encontrado", { title: "Sessão de edição não encontrada", message: "Atualize a página e tente de novo." }],
		["version not found", { title: "Versão não encontrada", message: "Essa versão não está mais disponível." }],
		["media item not found", { title: "Mídia não encontrada", message: "Essa imagem não está mais disponível." }],
		["link not found", { title: "Vínculo não encontrado", message: "Esse vínculo não existe mais." }],
		["reference image not found", { title: "Imagem não encontrada", message: "Essa imagem de referência não está mais disponível." }],
		["context image not found", { title: "Imagem não encontrada", message: "Essa imagem de contexto não está mais disponível." }],
		["source image not found", { title: "Imagem não encontrada", message: "A imagem de origem não está mais disponível." }],
		["source asset not found", { title: "Arquivo não encontrado", message: "O arquivo de origem não está mais disponível." }],
		["source media not found", { title: "Mídia não encontrada", message: "A mídia de origem não está mais disponível." }],
		["image not found", { title: "Imagem não encontrada", message: "Essa imagem não está mais disponível." }],
		["mensagem não encontrada", { title: "Mensagem não encontrada", message: "Essa mensagem não existe mais." }],
		["not authorized", { title: "Sem permissão", message: "Você não pode fazer isso neste projeto." }],
		["not authorized to update this project", { title: "Sem permissão", message: "Você não pode editar este projeto." }],
		["not authorized to delete this project", { title: "Sem permissão", message: "Você não pode excluir este projeto." }],
		["not authorized to update posts for this project", { title: "Sem permissão", message: "Você não pode alterar posts deste projeto." }],
		["not authorized to update this post", { title: "Sem permissão", message: "Você não pode alterar este post." }],
		["mensagem não pertence a este post", { title: "Ação indisponível", message: "Essa mensagem não pertence a este post." }],
		[
			"capture o instagram do projeto antes de gerar os 5 posts",
			{
				title: "Instagram necessário",
				message: "Capture o feed do Instagram neste projeto antes de gerar os 5 posts automáticos.",
			},
		],
		[
			"os 5 posts deste projeto já foram gerados",
			{
				title: "Demo já usada",
				message: "Os 5 posts automáticos deste projeto já foram criados.",
			},
		],
		[
			"a geração de ideias não retornou os 5 posts esperados",
			{
				title: "Geração incompleta",
				message: "Não conseguimos montar as ideias dos 5 posts desta vez. Tente de novo em instantes.",
			},
		],
		[
			"não foi possível calcular a próxima data de agendamento",
			{
				title: "Agendamento indisponível",
				message: "Não foi possível definir as datas no calendário. Tente de novo em instantes.",
			},
		],
		[
			"token apify não configurado",
			{ title: "Captura indisponível", message: "A captura do Instagram não está configurada no momento. Tente mais tarde." },
		],
		[
			"token apify não configurado (contate o suporte)",
			{ title: "Captura indisponível", message: "A captura do Instagram não está configurada. Fale com o suporte." },
		],
		[
			"missing apify token (set apify_token or apify_api_token)",
			{ title: "Captura indisponível", message: "A integração de captura não está configurada. Tente mais tarde." },
		],
		["apify não retornou dados", { title: "Instagram sem resposta", message: "Não recebemos dados desse perfil. Verifique o @ e tente de novo." }],
		["apify não retornou dados para esse perfil", { title: "Instagram sem resposta", message: "Não recebemos dados desse perfil. Verifique o @ e tente de novo." }],
		["apify run did not return a dataset", { title: "Captura incompleta", message: "A captura não retornou dados. Tente de novo em instantes." }],
		["apify did not return any instagram data", { title: "Perfil sem dados", message: "Não encontramos publicações para esse perfil." }],
		[
			"nenhum dado encontrado para esse perfil do instagram",
			{ title: "Perfil sem dados", message: "Não encontramos publicações para esse perfil." },
		],
		["escreva um brief para gerar o post", { title: "Brief vazio", message: "Escreva um brief para gerarmos o post." }],
		["template inválido", { title: "Modelo inválido", message: "Escolha outro modelo de post." }],
		[
			"não foi possível gerar nenhuma imagem. tente outro modelo ou ajuste o brief",
			{ title: "Imagens não geradas", message: "Não geramos imagens desta vez. Tente outro modelo ou ajuste o brief." },
		],
		["informe o projeto ou um rascunho de contexto", { title: "Contexto necessário", message: "Selecione um projeto ou descreva o contexto." }],
		["at least one media item is required", { title: "Mídia necessária", message: "Adicione pelo menos uma imagem ao post." }],
		["invalid media selection", { title: "Mídia inválida", message: "A seleção de mídia não é válida. Escolha outra imagem." }],
		["scheduled time must be in the future", { title: "Data inválida", message: "Escolha uma data e hora no futuro." }],
		[
			"no google calendar connection found",
			{ title: "Google Agenda desconectado", message: "Conecte o Google Agenda nas configurações para sincronizar." },
		],
		[
			"google calendar not connected or sync disabled",
			{
				title: "Sincronização desligada",
				message: "Conecte o Google Agenda ou ative a sincronização nas configurações.",
			},
		],
		[
			"google calendar token expired and no refresh token available. please reconnect",
			{
				title: "Reconectar Google Agenda",
				message: "Sua sessão do Google expirou. Abra as configurações e conecte de novo.",
			},
		],
		[
			"google calendar token expired and refresh failed. please reconnect",
			{
				title: "Reconectar Google Agenda",
				message: "Não foi possível renovar o acesso ao Google. Conecte de novo nas configurações.",
			},
		],
		[
			"token expired and no refresh token",
			{ title: "Reconectar Google Agenda", message: "Conecte o Google Agenda novamente nas configurações." },
		],
		["token refresh failed", { title: "Google Agenda", message: "Não foi possível renovar o acesso. Conecte de novo nas configurações." }],
		[
			"post not found or not scheduled",
			{ title: "Post não agendado", message: "Esse post não está agendado ou não foi encontrado." },
		],
		["post missing user id", { title: "Dados incompletos", message: "Não foi possível sincronizar este post. Tente salvar de novo." }],
		[
			"google calendar api response missing event id",
			{ title: "Sincronização incompleta", message: "O Google não confirmou o evento. Tente sincronizar de novo." },
		],
		["no refresh token available", { title: "Google Agenda", message: "Conceda acesso completo ao calendário ao conectar de novo." }],
		[
			"google oauth credentials not configured",
			{ title: "Integração indisponível", message: "O Google Agenda não está configurado neste ambiente." },
		],
		[
			"google calendar integration is not configured yet. please set up your google cloud console credentials",
			{
				title: "Google Agenda indisponível",
				message: "A conexão com o Google Agenda ainda não está configurada. Avise o suporte ou tente mais tarde.",
			},
		],
		["failed to refresh token", { title: "Google Agenda", message: "Não foi possível renovar o acesso. Conecte de novo." }],
		["autumn checkout failed", { title: "Pagamento", message: "Não foi possível abrir o checkout. Tente de novo em instantes." }],
		["autumn attach failed", { title: "Plano", message: "Não foi possível ativar o plano. Tente de novo em instantes." }],
		["failed to open billing portal", { title: "Cobrança", message: "Não foi possível abrir o portal de cobrança. Tente de novo." }],
		["failed to load customer", { title: "Assinatura", message: "Não foi possível carregar os dados da assinatura. Atualize a página." }],
		["failed to refresh customer", { title: "Assinatura", message: "Não foi possível atualizar os dados da assinatura. Tente de novo." }],
		["falha ao preparar a geração", { title: "Geração indisponível", message: "Não foi possível preparar a geração. Tente de novo." }],
		["falha ao regenerar imagem", { title: "Imagem", message: "Não foi possível gerar outra imagem agora. Tente de novo." }],
		[
			"esta mensagem não tem um estado para restaurar",
			{ title: "Ação indisponível", message: "Não há versão anterior para restaurar nesta mensagem." },
		],
	];

	const map: Record<string, UserFacingError> = {};
	for (const [k, v] of pairs) {
		map[normalizeKey(k)] = v;
	}
	return map;
})();

function matchByRule(inner: string): UserFacingError | null {
	const lower = inner.toLowerCase();
	if (
		lower.includes("google calendar api error") ||
		(lower.includes("google") && lower.includes("api error"))
	) {
		return {
			title: "Google Agenda",
			message: "O Google não respondeu como esperado. Tente de novo em instantes ou reconecte a conta.",
		};
	}
	if (lower.includes("not authenticated") || lower.includes("authentication present")) {
		return KNOWN["not authenticated"] ?? null;
	}
	if (lower.includes("not authorized")) {
		return KNOWN["not authorized"] ?? null;
	}
	if (lower.includes("project not found")) {
		return KNOWN["project not found"] ?? null;
	}
	if (
		lower.includes("houve um problema ao verificar seus creditos") ||
		lower.includes("nao foi possivel verificar seu plano")
	) {
		return {
			title: "Saldo indisponível",
			message: "Não foi possível ver seu saldo agora. Tente de novo em instantes.",
			intent: "account_plans",
		};
	}
	if (
		lower.includes("voce ainda nao tem um plano ativo") ||
		(lower.includes("plano ativo") && lower.includes("assine"))
	) {
		return {
			title: "Plano necessário",
			message: "É preciso ter um plano ativo para continuar.",
			intent: "account_plans",
		};
	}
	return null;
}

function coerceMessage(error: unknown): string {
	if (error == null) return "";
	if (typeof error === "string") return error;
	if (error instanceof Error) return error.message;
	if (typeof error === "object" && error !== null && "message" in error) {
		const m = (error as { message?: unknown }).message;
		if (typeof m === "string") return m;
	}
	if (typeof error === "object" && error !== null && "data" in error) {
		const data = (error as { data?: unknown }).data;
		if (typeof data === "string") return data;
		if (data && typeof data === "object" && "message" in data) {
			const m = (data as { message?: unknown }).message;
			if (typeof m === "string") return m;
		}
	}
	return "";
}

export function toUserFacingError(error: unknown): UserFacingError {
	const structured = parseStudioStructuredError(error);
	if (structured) {
		return mapStructuredStudioError(structured);
	}

	const raw = coerceMessage(error);
	if (!raw.trim()) {
		return DEFAULT;
	}

	const inner = stripConvexNoise(raw);
	if (!inner) {
		return DEFAULT;
	}

	const creditHit = matchCreditLimitPlainText(inner);
	if (creditHit) {
		return creditHit;
	}

	if (looksTechnical(inner)) {
		return DEFAULT;
	}

	const key = normalizeKey(inner);
	if (KNOWN[key]) {
		return KNOWN[key];
	}

	const ruled = matchByRule(inner);
	if (ruled) {
		return ruled;
	}

	if (looksTechnical(inner)) {
		return DEFAULT;
	}

	if (/^[a-záàâãéêíóôõúç\s.,!?\-–—0-9]+$/i.test(inner) && inner.length <= 160 && /[áàâãéêíóôõúç]/i.test(inner)) {
		return {
			title: "Não foi possível concluir",
			message: inner.charAt(0).toUpperCase() + inner.slice(1),
		};
	}

	return DEFAULT;
}

export function formatUserFacingMessage(error: unknown): string {
	const r = toUserFacingError(error);
	if (r.toastBodyOnly && !r.message.trim()) {
		return r.title;
	}
	return r.message.trim() || r.title;
}

export function formatUserFacingMessageFromText(raw: string | null | undefined): string {
	if (raw == null || raw.trim() === "") {
		return DEFAULT.message;
	}
	return toUserFacingError(new Error(raw)).message;
}
