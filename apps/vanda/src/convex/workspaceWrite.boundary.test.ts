// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { parseBrandKit } from "./workspace/brandKit";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  agentTest.register(t);

  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    const userId = await ctx.db.insert("users", {
      name: "Ana",
      email: "ana@example.com",
      clerkId: "ana",
    });

    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      name: "Café da Ana",
      createdAt: now,
      updatedAt: now,
    });

    const foreignAccountId = await ctx.db.insert("accounts", {
      createdAt: now,
      updatedAt: now,
    });

    return { accountId, foreignAccountId };
  });

  return { t, owner: t.withIdentity({ subject: "ana" }), ...ids };
};

const readText = async (
  t: Awaited<ReturnType<typeof setup>>["t"],
  accountId: Awaited<ReturnType<typeof setup>>["accountId"],
  path: string,
) => {
  const read = await t.query(internal.workspaceData.read, { accountId, path });

  return read.ok && read.file.kind === "text" ? read.file.text : null;
};

describe("workspace writes", () => {
  it("opens the brand file from confirmed facts and round-trips agent edits", async () => {
    const { t, accountId } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("brandCanon", {
        accountId,
        kind: "restriction",
        text: "Não anunciar álcool",
        confirmedByOwner: true,
        createdAt: 1,
      }),
    );

    const first = await readText(t, accountId, "/brand/marca.md");
    expect(first).toContain("# Marca · Café da Ana");
    expect(first).toContain("## Nunca fazer\n\n- Não anunciar álcool (dono)");

    const edited = `${first}\n- Fotos com luz natural rendem mais salvamentos (observado: 6 posts, out)\n`;

    expect(
      await t.mutation(internal.workspaceData.write, {
        accountId,
        path: "/brand/marca.md",
        content: edited,
      }),
    ).toEqual({ ok: true, path: "/brand/marca.md", note: "criado" });
    expect(await readText(t, accountId, "/brand/marca.md")).toBe(edited);
    expect(await t.query(internal.brandContext.conversation, { accountId })).toContain(
      "luz natural",
    );
  });

  it("records whether the owner or Vanda wrote the brand file", async () => {
    const { t, owner, accountId } = await setup();

    await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/brand/marca.md",
      content: "# Marca\n\n- Sempre assinar como Café da Ana (dono)\n",
    });
    await owner.mutation(api.brandFile.save, {
      accountId,
      content: "# Marca\n\n- Sempre assinar como Café da Ana (dono)\n- Sem emojis (dono)\n",
    });

    const file = await owner.query(api.brandFile.get, { accountId });
    expect(file).toMatchObject({ persisted: true, updatedBy: "owner" });
    expect(file.content).toContain("Sem emojis");

    const revisions = await t.run((ctx) =>
      ctx.db
        .query("workspaceFileRevisions")
        .withIndex("by_account_path", (q) =>
          q.eq("accountId", accountId).eq("path", "/brand/marca.md"),
        )
        .collect(),
    );

    expect(revisions.map((revision) => revision.savedBy)).toEqual(["vanda", "owner"]);
    await expect(
      t.withIdentity({ subject: "bia" }).query(api.brandFile.get, { accountId }),
    ).rejects.toThrow();
  });

  it("bounds the brand file to the always-on budget", async () => {
    const { t, owner, accountId } = await setup();

    const oversized = await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/brand/marca.md",
      content: "x".repeat(24_001),
    });

    expect(oversized).toMatchObject({ ok: false, error: expect.stringContaining("limite") });
    await expect(
      owner.mutation(api.brandFile.save, { accountId, content: "🌿".repeat(7_000) }),
    ).rejects.toThrow("limite");
    await expect(owner.mutation(api.brandFile.save, { accountId, content: "  " })).rejects.toThrow(
      "vazio",
    );
  });

  it("overwrites replace the head and append a revision", async () => {
    const { t, accountId } = await setup();
    const path = "/notes/plano.md";
    await t.mutation(internal.workspaceData.write, { accountId, path, content: "v1" });

    const second = await t.mutation(internal.workspaceData.write, {
      accountId,
      path,
      content: "v2",
    });

    expect(second).toEqual({ ok: true, path, note: "atualizado" });
    expect(await readText(t, accountId, path)).toBe("v2");

    const revisions = await t.run((ctx) =>
      ctx.db
        .query("workspaceFileRevisions")
        .withIndex("by_account_path", (q) => q.eq("accountId", accountId).eq("path", path))
        .collect(),
    );

    expect(revisions.map((revision) => revision.content)).toEqual(["v1", "v2"]);
  });

  it("validates and normalizes brand kit writes", async () => {
    const { t, accountId } = await setup();

    const written = await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/brand/kit.json",
      content: JSON.stringify({
        colors: [{ hex: "#D81B60", name: "rosa", role: "primária" }, { hex: "#fdfcfb" }],
        fonts: [{ family: "Poppins", role: "títulos" }],
        tagline: "café com afeto",
      }),
    });

    expect(written.ok).toBe(true);

    const kit = parseBrandKit((await readText(t, accountId, "/brand/kit.json")) ?? "");
    expect(kit?.colors[0]?.hex).toBe("#d81b60");
    expect(kit?.tagline).toBe("café com afeto");

    const cases: Array<[string, string]> = [
      ["não é json", "JSON válido"],
      [JSON.stringify({ colors: [{ hex: "rosa" }] }), "hex"],
      [JSON.stringify({ palette: [] }), "campo desconhecido"],
    ];

    for (const [content, hint] of cases) {
      const result = await t.mutation(internal.workspaceData.write, {
        accountId,
        path: "/brand/kit.json",
        content,
      });

      expect(result.ok).toBe(false);

      if (!result.ok) expect(result.error).toContain(hint);
    }
  });

  it("refuses projection and retired writes with where to write instead", async () => {
    const { t, accountId } = await setup();

    const cases: Array<[string, string]> = [
      ["/images/promo.jpg", "paint"],
      ["/market/last-scan.json", "ferramentas Instagram"],
      ["/runs/x.json", "somente leitura"],
      ["/brand/memory.md", "/brand/marca.md"],
      ["/brand/notes.md", "/brand/marca.md"],
      ["/memory/preferencias.md", "/brand/marca.md"],
      ["/legado/brand-notes.md", "formato antigo"],
    ];

    for (const [path, hint] of cases) {
      const result = await t.mutation(internal.workspaceData.write, {
        accountId,
        path,
        content: "x",
      });

      expect(result.ok).toBe(false);

      if (!result.ok) expect(result.error).toContain(hint);
    }
  });

  it("rejects invalid names and oversized content", async () => {
    const { t, accountId } = await setup();

    for (const path of [
      "/notes/Nota Final.md",
      "/notes/nota.txt",
      "/notes/sub/nota.md",
      "/templates/moldura.md",
    ]) {
      const result = await t.mutation(internal.workspaceData.write, {
        accountId,
        path,
        content: "x",
      });

      expect(result.ok).toBe(false);
    }

    const oversized = await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/notes/grande.md",
      content: "x".repeat(64_001),
    });

    expect(oversized).toMatchObject({ ok: false, error: expect.stringContaining("grande demais") });
  });

  it("keeps written files invisible to other accounts", async () => {
    const { t, accountId, foreignAccountId } = await setup();

    for (const path of ["/notes/segredo.md", "/brand/marca.md"])
      await t.mutation(internal.workspaceData.write, {
        accountId,
        path,
        content: "receita secreta",
      });

    const listing = await t.query(internal.workspaceData.list, {
      accountId: foreignAccountId,
      path: "/notes",
    });

    expect(listing.ok && listing.entries).toEqual([]);
    expect(
      (
        await t.query(internal.workspaceData.read, {
          accountId: foreignAccountId,
          path: "/notes/segredo.md",
        })
      ).ok,
    ).toBe(false);
    expect(await readText(t, foreignAccountId, "/brand/marca.md")).not.toContain("receita secreta");
  });

  it("carries legacy notes into the brand file within budget and keeps the rest readable", async () => {
    const { t, accountId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("brandCanon", {
        accountId,
        kind: "restriction",
        text: "Não anunciar álcool",
        confirmedByOwner: true,
        createdAt: 1,
      });

      for (const [path, content] of [
        ["/memory/a.md", "a".repeat(40_000)],
        ["/memory/b.md", "b".repeat(40_000)],
        ["/memory/preferences.md", "Nunca oferecer entrega grátis"],
        ["/brand/notes.md", "Assinar como Café da Ana"],
      ] as const)
        await ctx.db.insert("workspaceFiles", {
          accountId,
          path,
          content,
          updatedAt: 1,
          updatedBy: "vanda",
        });
    });

    const context = await t.query(internal.brandContext.conversation, { accountId });
    expect(context).toContain("Não anunciar álcool");
    expect(context).toContain("Nunca oferecer entrega grátis");
    expect(context).toContain("Assinar como Café da Ana");
    expect(context).toContain("/legado/memory-a.md");
    expect(context).not.toContain("a".repeat(1_000));
    expect(context.length).toBeLessThan(25_000);
    expect(await readText(t, accountId, "/legado/memory-a.md")).toBe("a".repeat(40_000));

    // runAll stores it once per deployment (both setup accounts get one); later deploys skip it.
    expect(await t.action(internal.migrations.runAll, {})).toMatchObject({
      ran: { brandFiles: 2 },
    });
    expect(await t.action(internal.migrations.runAll, {})).toMatchObject({
      skipped: expect.arrayContaining(["brandFiles"]),
    });

    const stored = await t.run((ctx) =>
      ctx.db
        .query("workspaceFiles")
        .withIndex("by_account_path", (q) =>
          q.eq("accountId", accountId).eq("path", "/brand/marca.md"),
        )
        .unique(),
    );

    expect(stored?.content).toContain("Nunca oferecer entrega grátis");
    expect(stored?.content.length).toBeLessThan(24_000);
  });
});
