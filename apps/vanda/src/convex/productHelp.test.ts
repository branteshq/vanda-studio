import { describe, expect, it } from "vitest";
import { productHelp } from "./productHelp";

const search = (query: string) =>
  productHelp.execute!({ query }, { toolCallId: "product-help", messages: [] });

describe("productHelp", () => {
  it.each([
    ["como conectar meu instagram?", "connections.instagram-openai", "/perfil"],
    ["qual é o limite de uso do plano?", "billing.usage", "/perfil"],
    ["onde encontro meus rascunhos?", "posts.drafts-and-scheduling", "/calendario"],
    ["cores e preferências da marca", "brand.preferences-and-memory", "/perfil"],
  ])("recupera ajuda em português para %s", async (query, id, route) => {
    const result = await search(query);

    expect(result).toHaveProperty("results.0", {
      id,
      route,
      title: expect.any(String),
      guidance: expect.any(String),
      sourceFiles: expect.arrayContaining([expect.any(String)]),
    });
  });

  it("aceita id exato e lista o catálogo pequeno com '*'", async () => {
    const exact = await search("models.subscription-limits");
    const browse = await search("*");

    expect(exact).toHaveProperty("results.length", 1);
    expect(exact).toHaveProperty("results.0.id", "models.subscription-limits");
    expect(browse).toHaveProperty("results.length", 6);
  });

  it("marca comportamento ausente como não documentado sem inventar interface", async () => {
    const result = await search("exportar relatório em PDF e enviar por e-mail");

    expect(result).toHaveProperty("results", []);
    expect(result).toHaveProperty("message", expect.stringContaining("não documentado"));
    expect(result).toHaveProperty("message", expect.stringContaining("Não invente"));
  });
});
