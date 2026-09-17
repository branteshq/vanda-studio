import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { publicError } from "../errors";
import { ErrorNotice, showErrorToast } from "./error-feedback";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("error feedback", () => {
  it("never renders exception text in inline feedback or toasts", () => {
    const error = new Error("[CONVEX A] credential-secret at backend.ts:90");
    const html = renderToStaticMarkup(createElement(ErrorNotice, { error }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Algo deu errado. Tente novamente em instantes.");
    expect(html).not.toMatch(/CONVEX|credential-secret|backend\.ts/);
    showErrorToast(error);
    expect(toast.error).toHaveBeenLastCalledWith("Não foi possível concluir", {
      description: "Algo deu errado. Tente novamente em instantes.",
    });
  });

  it("offers a safe reconnect action instead of retrying a mutation automatically", () => {
    const error = publicError("RECONNECT_REQUIRED");
    const html = renderToStaticMarkup(createElement(ErrorNotice, { error }));
    expect(html).toContain('href="/perfil"');
    expect(html).toContain("Reconectar");
    showErrorToast(error);
    expect(toast.error).toHaveBeenLastCalledWith(
      "Reconecte sua conta",
      expect.objectContaining({
        action: { label: "Reconectar", onClick: expect.any(Function) },
      }),
    );
  });
});
