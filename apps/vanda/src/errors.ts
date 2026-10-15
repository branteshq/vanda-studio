import { ConvexError } from "convex/values";
import { z } from "zod";

/** Public copy is selected here, never taken from an exception or provider response. */
export const errorCodes = [
  "USAGE_LIMIT",
  "WEB_LIMIT",
  "RATE_LIMITED",
  "PROVIDER_LIMIT",
  "RECONNECT_REQUIRED",
  "UNAUTHENTICATED",
  "INVALID_INPUT",
  "NOT_FOUND",
  "UNAVAILABLE",
  "TIMEOUT",
  "UNEXPECTED",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export const errorCopy = {
  USAGE_LIMIT: {
    title: "Limite do plano atingido",
    message:
      "Seu limite de uso foi atingido. Confira seu plano em Perfil › Plano e uso para continuar.",
    action: "Ver plano",
    href: "/perfil/plano",
  },
  WEB_LIMIT: {
    title: "Limite de pesquisa web atingido",
    message:
      "A pesquisa web atingiu o limite deste pedido ou das últimas 24 horas. Use as fontes já consultadas e tente novamente mais tarde.",
  },
  RATE_LIMITED: {
    title: "Muitos pedidos seguidos",
    message: "Você fez muitos pedidos em pouco tempo. Aguarde um pouco e tente novamente.",
  },
  PROVIDER_LIMIT: {
    title: "Limite do ChatGPT atingido",
    message: "Aguarde o limite do seu plano ChatGPT renovar e tente novamente.",
  },
  RECONNECT_REQUIRED: {
    title: "Reconecte sua conta",
    message: "Sua conexão expirou. Reconecte sua conta em Perfil › Conexões para continuar.",
    action: "Reconectar",
    href: "/perfil/conexoes",
  },
  UNAUTHENTICATED: {
    title: "Entre novamente",
    message: "Sua sessão expirou. Entre novamente para continuar.",
    action: "Entrar",
    href: "/login",
  },
  INVALID_INPUT: {
    title: "Confira os dados",
    message:
      "Não foi possível continuar com esses dados. Revise o que você preencheu e tente novamente.",
  },
  NOT_FOUND: {
    title: "Não disponível",
    message: "Este conteúdo não está disponível ou você não tem acesso a ele.",
  },
  UNAVAILABLE: {
    title: "Serviço indisponível",
    message: "Não foi possível concluir agora. Aguarde um pouco e tente novamente.",
  },
  TIMEOUT: {
    title: "A resposta demorou demais",
    message: "Não foi possível concluir a tempo. Seu pedido foi salvo; tente novamente.",
  },
  UNEXPECTED: {
    title: "Não foi possível concluir",
    message: "Algo deu errado. Tente novamente em instantes.",
  },
} as const satisfies Record<
  ErrorCode,
  { title: string; message: string; action?: string; href?: string }
>;

export type PublicError = { kind: "vanda-error"; code: ErrorCode; retryAfterMs?: number };

const errorCodeSchema = z.enum(errorCodes);

const publicErrorSchema = z.object({
  kind: z.literal("vanda-error"),
  code: errorCodeSchema,
  retryAfterMs: z.number().nonnegative().optional(),
});

export function isErrorCode(code: unknown): code is ErrorCode {
  return errorCodeSchema.safeParse(code).success;
}

/** Convex serializes data across function calls; only this explicit envelope is trusted. */
export function errorCode(cause: unknown): ErrorCode {
  const data = cause instanceof ConvexError ? cause.data : cause;
  const parsed = publicErrorSchema.safeParse(data);

  return parsed.success ? parsed.data.code : "UNEXPECTED";
}

export function publicError(code: ErrorCode, retryAfterMs?: number): ConvexError<PublicError> {
  return new ConvexError(
    retryAfterMs === undefined
      ? { kind: "vanda-error", code }
      : { kind: "vanda-error", code, retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)) },
  );
}

/** How long to wait before retrying a rate-limited request, when the server said so. */
export function retryAfterMs(cause: unknown): number | null {
  const data = cause instanceof ConvexError ? cause.data : cause;
  const parsed = publicErrorSchema.safeParse(data);

  return parsed.success && parsed.data.retryAfterMs !== undefined ? parsed.data.retryAfterMs : null;
}

/** "em 45 segundos" or "em 3 minutos", rounded up, for copy that tells the owner when to retry. */
export function retryWait(ms: number): string {
  if (ms < 60_000) return `em ${Math.max(1, Math.ceil(ms / 1000))} segundos`;

  return `em ${Math.ceil(ms / 60_000)} minutos`;
}

export function errorMessage(cause: unknown): string {
  const code = errorCode(cause);
  const wait = retryAfterMs(cause);

  if (code === "RATE_LIMITED" && wait !== null)
    return `${errorCopy.RATE_LIMITED.message} Tente de novo ${retryWait(wait)}.`;

  return errorCopy[code].message;
}
