import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GalleryFailureMessage } from "./_dashboard.galeria";

describe("gallery failure rendering", () => {
  it("renders curated reconnect copy and its safe action", () => {
    const html = renderToStaticMarkup(
      createElement(GalleryFailureMessage, { code: "RECONNECT_REQUIRED" }),
    );

    expect(html).toContain("Sua conexão expirou");
    expect(html).toContain("Reconectar");
    expect(html).toContain('href="/perfil"');
  });

  it("renders curated fallback copy without a raw legacy diagnostic", () => {
    const rawDiagnostic = "provider leaked diagnostic: key=secret";
    const html = renderToStaticMarkup(createElement(GalleryFailureMessage, { code: "UNEXPECTED" }));

    expect(html).toContain("Algo deu errado");
    expect(html).not.toContain(rawDiagnostic);
  });
});
