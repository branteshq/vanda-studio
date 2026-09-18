import { ConvexError } from "convex/values";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { errorCode, errorCodes, errorMessage, publicError, type ErrorCode } from "./errors";

describe("public errors", () => {
  it.each(errorCodes)("round-trips %s without exposing diagnostic fields", (code: ErrorCode) => {
    expect(errorCode(publicError(code))).toBe(code);
    expect(errorCode(JSON.parse(JSON.stringify(publicError(code).data)))).toBe(code);

    const dirty = new ConvexError({
      kind: "vanda-error",
      code,
      message: "secret-provider-body",
      stack: "convex/internal.ts",
    });

    expect(errorMessage(dirty)).not.toMatch(/secret-provider-body|convex\/internal/);
    expect(new Set(Object.keys(publicError(code).data))).toEqual(new Set(["code", "kind"]));
  });

  it.each([
    new Error("[CONVEX A(chat:sendMessage)] secret-token at internal.ts:123"),
    "secret-provider-body",
    null,
    undefined,
    new ConvexError("raw convex diagnostic"),
    new ConvexError({ code: "USAGE_LIMIT" }),
    { kind: "vanda-error", code: "toString" },
    { kind: "vanda-error", code: "__proto__" },
    { kind: "vanda-error", code: "NEW_UNRECOGNIZED_CODE" },
    { message: "Limite do plano atingido" },
  ])("fails closed for unknown or malformed errors: %#", (error) => {
    expect(errorCode(error)).toBe("UNEXPECTED");
    expect(errorMessage(error)).toBe("Algo deu errado. Tente novamente em instantes.");
  });

  it("keeps the public contract through an Effect failure", async () => {
    await expect(Effect.runPromise(Effect.fail(publicError("UNAVAILABLE")))).rejects.toMatchObject({
      data: { kind: "vanda-error", code: "UNAVAILABLE" },
    });
  });
});
