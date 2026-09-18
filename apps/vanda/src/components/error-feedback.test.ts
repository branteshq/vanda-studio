import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { publicError } from "../errors";
import { createErrorToast, ErrorNotice } from "./error-feedback";

describe("error feedback", () => {
  it("never renders exception text in inline feedback or toasts", () => {
    const error = new Error("[CONVEX A] credential-secret at backend.ts:90");
    const html = renderToStaticMarkup(createElement(ErrorNotice, { error }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Algo deu errado. Tente novamente em instantes.");
    expect(html).not.toMatch(/CONVEX|credential-secret|backend\.ts/);
    expect(createErrorToast(error)).toEqual({
      title: "Não foi possível concluir",
      options: { description: "Algo deu errado. Tente novamente em instantes." },
    });
  });

  it("offers a safe reconnect action instead of retrying a mutation automatically", () => {
    const error = publicError("RECONNECT_REQUIRED");
    const html = renderToStaticMarkup(createElement(ErrorNotice, { error }));
    expect(html).toContain('href="/perfil"');
    expect(html).toContain("Reconectar");
    expect(createErrorToast(error)).toEqual(
      expect.objectContaining({
        title: "Reconecte sua conta",
        options: expect.objectContaining({
          action: { label: "Reconectar", onClick: expect.any(Function) },
        }),
      }),
    );
  });
});
