import { ConvexError } from "convex/values";

/** Public copy is selected here, never taken from an exception or provider response. */
export const errorCopy = {
  USAGE_LIMIT: {
    title: "Limite do plano atingido",
    message: "Seu limite de uso foi atingido. Confira seu plano em Perfil para continuar.",
    action: "Ver plano",
    href: "/perfil",
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
} as const;

export type ErrorCode = keyof typeof errorCopy;
export type PublicError = { kind: "vanda-error"; code: ErrorCode };

export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && Object.hasOwn(errorCopy, code);
}

/** Convex serializes data across function calls; only this explicit envelope is trusted. */
export function errorCode(error: unknown): ErrorCode {
  const data = error instanceof ConvexError ? error.data : error;
  if (
    typeof data === "object" &&
    data !== null &&
    "kind" in data &&
    data.kind === "vanda-error" &&
    "code" in data &&
    isErrorCode(data.code)
  )
    return data.code;
  return "UNEXPECTED";
}

export function publicError(code: ErrorCode): ConvexError<PublicError> {
  return new ConvexError({ kind: "vanda-error", code });
}

export function errorMessage(error: unknown): string {
  return errorCopy[errorCode(error)].message;
}
