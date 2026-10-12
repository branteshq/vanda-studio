// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { designDirection } from "./brandContext";
import {
  BRAND_FILE_PATH,
  brandFileDesign,
  brandFileFacts,
  brandFileKinds,
  brandFileOutline,
  brandGuide,
  composeBrandFile,
} from "./brandFile";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const file = composeBrandFile({
  name: "Café Caju",
  handle: "cafecaju",
  facts: [
    { kind: "identity", text: "Cafeteria de bairro no Recife" },
    { kind: "voice", text: "Calorosa e direta" },
    { kind: "restriction", text: "Não anunciar bebidas alcoólicas" },
  ],
  legacy: [],
});

const DESIGN =
  "## Design\n- Paleta: #3860BE azul (principal); #AC8A5E dourado/ocre (destaque) (dono)\n- Tipografia: `Gotham Narrow` (dono)";

/** An account whose owner is signed in as clerk id "c2". */
const ownedAccount = async (handle: string) => {
  const t = convexTest(schema, modules);

  const accountId = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", {
      name: "Dona",
      email: "d@e.com",
      clerkId: "c2",
    });

    return ctx.db.insert("accounts", { handle, ownerUserId, createdAt: 1, updatedAt: 1 });
  });

  return { t, accountId, owner: t.withIdentity({ subject: "c2" }) };
};

const write = (t: ReturnType<typeof convexTest>, accountId: Id<"accounts">, content: string) =>
  t.mutation(internal.workspaceData.write, { accountId, path: BRAND_FILE_PATH, content });

describe("brand file facts, kinds and composition", () => {
  it("lists items under their sections, legacy notes included, and covers the kinds filled", () => {
    expect(brandFileFacts(file)).toEqual([
      { id: "marca-1", kind: "O negócio", text: "O que é: Cafeteria de bairro no Recife (dono)" },
      { id: "marca-2", kind: "Voz", text: "Voz: Calorosa e direta (dono)" },
      { id: "marca-3", kind: "Nunca fazer", text: "Não anunciar bebidas alcoólicas (dono)" },
    ]);
    expect(brandFileFacts("# Marca\n## Notas anteriores\n- antiga (dono)\n")).toEqual([
      { id: "marca-1", kind: "Notas anteriores", text: "antiga (dono)" },
    ]);
    expect(brandFileKinds(file)).toEqual(
      expect.arrayContaining(["identity", "voice", "restriction"]),
    );
    expect(brandFileKinds(file)).not.toContain("audience");
  });

  it("opens with the legend, keeps headings next to their items, and groups one kind and origin", () => {
    expect(file).toContain("\nLido pela Vanda");
    expect(file).toContain("## O negócio\n- O que é:");
    expect(file).toContain("## Design\n\n## Nunca fazer");

    const offers = [
      { kind: "offer" as const, text: "Capital de giro" },
      { kind: "offer" as const, text: "Antecipação de recebíveis" },
      { kind: "offer" as const, text: "Taxa a confirmar", origin: "Vanda" },
    ];

    const grouped = composeBrandFile({ name: "Vida Cia", facts: offers, legacy: [] });

    expect(grouped).toMatch(
      /- Oferta: Capital de giro; Antecipação de recebíveis \(dono\)\n- Oferta: Taxa a confirmar \(Vanda\)/,
    );
    expect(brandGuide("").map((section) => section.title)).toEqual([
      "O negócio",
      "Público",
      "Voz",
      "Design",
      "Nunca fazer",
      "Provas",
    ]);
  });
});

describe("brand guide", () => {
  it("counts Design as answered only once it has the colors", () => {
    const designOf = (lines: string) =>
      brandGuide(`# Marca\n\n## Design\n${lines}\n`).find((s) => s.title === "Design")?.filled;

    expect(designOf("- Logo: sem logo por enquanto; usar o nome em texto (dono)")).toBe(false);
    expect(designOf("- Tipografia: serifada nos títulos (Vanda)")).toBe(false);
    expect(designOf("- Paleta: #c99a9a rosa antigo (fundo); #6b3f45 vinho (títulos) (Vanda)")).toBe(
      true,
    );
  });
});

describe("brand file outline and design", () => {
  it("keeps labels, origins and empty sections in file order, and stops at the legacy notes", () => {
    const outline = brandFileOutline(`# Marca · Teste

Legenda sem seção.
- item antes de qualquer seção (dono)
## Voz
- Postura: estritamente profissional (dono)
- Tom por situação: dicas claras (Vanda)
- Preços (aprox): variam (dono)
- Atenção!: não postar ofertas (dono)
- Este rótulo é longo demais para caber: sim (dono)
- Presença: em 53 cidades (observado: Do perfil, 11/10/2026)
- Sem origem nenhuma
### Subtítulo
- item de subseção (dono)
## Provas
${DESIGN}
## Notas anteriores
- Texto antigo (dono)
## Preferências
- Gosta de azul (dono)`);

    expect(outline.map((section) => section.title)).toEqual(["Voz", "Provas", "Design"]);
    expect(outline[0]!.items).toEqual([
      { label: "Postura", text: "estritamente profissional", origin: "dono" },
      { label: "Tom por situação", text: "dicas claras", origin: "Vanda" },
      { label: null, text: "Preços (aprox): variam", origin: "dono" },
      { label: null, text: "Atenção!: não postar ofertas", origin: "dono" },
      { label: null, text: "Este rótulo é longo demais para caber: sim", origin: "dono" },
      { label: "Presença", text: "em 53 cidades", origin: "observado: Do perfil, 11/10/2026" },
      { label: null, text: "Sem origem nenhuma", origin: "dono" },
      { label: null, text: "item de subseção", origin: "dono" },
    ]);
    expect(outline[1]!.items).toEqual([]);
  });

  it("returns swatches with role, typography and the linked logo URL", () => {
    const outline = brandFileOutline(`${DESIGN}\n- Logo: ![logo](image:abc) (dono)`);

    expect(brandFileDesign(outline, { abc: "https://example.com/logo.png" })).toEqual({
      palette: [
        { hex: "#3860BE", name: "azul", role: "principal" },
        { hex: "#AC8A5E", name: "dourado/ocre", role: "destaque" },
      ],
      typography: "Gotham Narrow",
      logoUrl: "https://example.com/logo.png",
    });
    expect(brandFileDesign(outline, {}).logoUrl).toBeNull();
  });

  it("reads nested parentheses in an origin and a period after a role", () => {
    const outline = brandFileOutline(`## O negócio
- Onde: Brasil (observado: Do perfil e legendas (presença nacional e link na bio), 11/10/2026)

## Design
- Paleta: #a6874b dourado (principal); #fefefe branco (destaque). (dono)`);

    expect(outline[0]!.items[0]).toEqual({
      label: "Onde",
      text: "Brasil",
      origin: "observado: Do perfil e legendas (presença nacional e link na bio), 11/10/2026",
    });
    expect(brandFileDesign(outline, {}).palette).toEqual([
      { hex: "#a6874b", name: "dourado", role: "principal" },
      { hex: "#fefefe", name: "branco", role: "destaque" },
    ]);
  });
});

describe("brand file images, get and guide", () => {
  const setup = async () => {
    const account = await ownedAccount("vida");

    const { own, foreign } = await account.t.run(async (ctx) => {
      const otherId = await ctx.db.insert("accounts", {
        handle: "outra",
        createdAt: 1,
        updatedAt: 1,
      });

      const image = {
        origin: "uploaded" as const,
        purpose: "reference" as const,
        referenceKind: "product" as const,
        externalUrl: "https://example.com/logo.png",
        createdAt: 1,
      };

      return {
        own: await ctx.db.insert("images", { ...image, accountId: account.accountId }),
        foreign: await ctx.db.insert("images", { ...image, accountId: otherId }),
      };
    });

    return { ...account, own, foreign };
  };

  it("rejects another account's image or an invalid id, and accepts an own one", async () => {
    const { t, accountId, own, foreign } = await setup();

    const save = (imageId: string) =>
      write(t, accountId, `# Marca\n\n## Design\n- Logo: ![logo](image:${imageId}) (dono)\n`);

    expect(await save(foreign)).toMatchObject({
      ok: false,
      error: expect.stringContaining("não é desta conta"),
    });
    expect((await save("naoexiste")).ok).toBe(false);
    // A placeholder for an image that never arrived is not a link either.
    expect((await save("ANEXO_NAO_DISPONIVEL")).ok).toBe(false);
    expect((await save(own)).ok).toBe(true);
  });

  it("serves outline, design and images through get", async () => {
    const { t, accountId, owner, own } = await setup();

    await write(
      t,
      accountId,
      `# Marca\n\n## O negócio\n- Oferta: consultoria (dono)\n## Público\n- Quem: donos de pet (dono)\n## Voz\n- Voz: próxima (dono)\n\n${DESIGN}\n- Logo: ![logo](image:${own}) (dono)\n`,
    );

    const brandFile = await owner.query(api.brandFile.get, { accountId });

    expect(brandFile).toMatchObject({
      outline: expect.arrayContaining([expect.objectContaining({ title: "Design" })]),
      images: { [own]: "https://example.com/logo.png" },
      design: { typography: "Gotham Narrow", logoUrl: "https://example.com/logo.png" },
    });
  });
});

describe("brand context design and radar", () => {
  it("returns the palette and typography of Design only, never the logo or style", async () => {
    const { t, accountId } = await ownedAccount("vida");

    await write(
      t,
      accountId,
      "# Marca\n\n## Voz\n- Voz: próxima (dono)\n\n## Design\n- Paleta: #142b4a azul (dono)\n- Tipografia: Inter (Vanda)\n- Estilo: sóbrio (dono)\n",
    );

    expect(await t.query(internal.brandContext.design, { accountId })).toEqual({
      palette: "#142b4a azul",
      typography: "Inter",
    });
    expect(
      designDirection(
        "## Design\n- Logo: ![logo](image:abc) (dono)\n- Paleta: **#3860BE** azul (principal) (dono)\n- Tipografia: `Gotham Narrow` (dono)",
      ),
    ).toEqual({ palette: "#3860BE azul (principal)", typography: "Gotham Narrow" });
  });

  it("reads the brand file and quotes its items from the immutable snapshot", async () => {
    const t = convexTest(schema, modules);

    const accountId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("accounts", {
        handle: "cafecaju",
        createdAt: 1,
        updatedAt: 1,
      });

      await ctx.db.insert("workspaceFiles", {
        accountId: id,
        path: BRAND_FILE_PATH,
        content: file,
        updatedAt: 1,
        updatedBy: "owner",
      });

      return id;
    });

    const context = await t.query(internal.market.loadBrandContext, { accountId });

    expect(context.context).toContain("Não anunciar bebidas alcoólicas (dono)");
    expect(context.readiness.ready).toBe(true);

    const snapshot = await t.mutation(internal.market.ensureBrandSnapshot, { accountId });

    expect(snapshot.context).toBe(file);
    expect(snapshot.canonIds).toBeUndefined();
    expect((await t.mutation(internal.market.ensureBrandSnapshot, { accountId }))._id).toBe(
      snapshot._id,
    );
  });
});
