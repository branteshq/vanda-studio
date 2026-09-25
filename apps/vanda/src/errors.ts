import { ConvexError } from "convex/values";
import { z } from "zod";

/** Public copy is selected here, never taken from an exception or provider response. */
export const errorCodes = [
  "USAGE_LIMIT",
  "WEB_LIMIT",
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
    message: "Seu limite de uso foi atingido. Confira seu plano em Perfil para continuar.",
    action: "Ver plano",
    href: "/perfil",
  },
  WEB_LIMIT: {
    title: "Limite de pesquisa web atingido",
    message:
      "A pesquisa web atingiu o limite deste pedido ou das últimas 24 horas. Use as fontes já consultadas e tente novamente mais tarde.",
  },
  PROVIDER_LIMIT: {
    title: "Limite do ChatGPT atingido",
    message: "Aguarde o limite do seu plano ChatGPT renovar e tente novamente.",
  },
  RECONNECT_REQUIRED: {
    title: "Reconecte sua conta",
    message: "Sua conexão expirou. Reconecte sua conta em Perfil para continuar.",
    action: "Reconectar",
    href: "/perfil",
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

export type PublicError = { kind: "vanda-error"; code: ErrorCode };

const errorCodeSchema = z.enum(errorCodes);

const publicErrorSchema = z.object({ kind: z.literal("vanda-error"), code: errorCodeSchema });

export function isErrorCode(code: unknown): code is ErrorCode {
  return errorCodeSchema.safeParse(code).success;
}

/** Convex serializes data across function calls; only this explicit envelope is trusted. */
export function errorCode(cause: unknown): ErrorCode {
  const data = cause instanceof ConvexError ? cause.data : cause;
  const parsed = publicErrorSchema.safeParse(data);

  return parsed.success ? parsed.data.code : "UNEXPECTED";
}

export function publicError(code: ErrorCode): ConvexError<PublicError> {
  return new ConvexError({ kind: "vanda-error", code });
}

export function errorMessage(cause: unknown): string {
  return errorCopy[errorCode(cause)].message;
}
