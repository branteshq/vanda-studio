import { describe, expect, it } from "vitest";
import { productDocs } from "./productDocs/catalog";
import { productHelp } from "./productHelp";
import { SETTINGS } from "./settings/catalog";

const search = (query: string) =>
  productHelp.execute!({ query }, { toolCallId: "product-help", messages: [] });

describe("productHelp", () => {
  it.each([
    ["como conectar meu instagram?", "conexoes"],
    ["qual é o limite de uso do plano?", "planos-e-uso"],
    ["onde encontro meus rascunhos?", "posts-e-agendamento"],
    ["cores e preferências da marca", "marca-e-memoria"],
    ["como vincular o whatsapp do caetano", "caetano-no-whatsapp"],
    ["trocar o modelo de imagem", "modelos"],
  ])("finds the docs page for %s", async (query, slug) => {
    const result = await search(query);

    expect(result).toHaveProperty("results.0.slug", slug);
    expect(result).toHaveProperty("results.0.url", `/docs/${slug}`);
    expect(result).toHaveProperty("results.0.excerpt", expect.any(String));
  });

  it("reads a whole page by slug and lists every page with '*'", async () => {
    const exact = await search("/docs/modelos");
    const browse = await search("*");

    expect(exact).toHaveProperty("page.markdown", expect.stringContaining("Perfil › Modelos"));
    expect(browse).toHaveProperty("results.length", productDocs().length);
  });

  it("serves the settings reference generated from the registry", async () => {
    const result = await search("configuracoes");

    for (const setting of SETTINGS)
      expect(result).toHaveProperty("page.markdown", expect.stringContaining(setting.title));
  });

  it("marca comportamento ausente como não documentado sem inventar interface", async () => {
    const result = await search("exportar relatório em PDF e enviar por e-mail");

    expect(result).toHaveProperty("results", []);
    expect(result).toHaveProperty("message", expect.stringContaining("não documentado"));
    expect(result).toHaveProperty("message", expect.stringContaining("Não invente"));
  });
});
