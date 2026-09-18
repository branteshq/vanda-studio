// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { parseBrandKit } from "./workspace/brandKit";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  agentTest.register(t);

  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    const accountId = await ctx.db.insert("accounts", {
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

  return { t, ...ids };
};

describe("workspace writes", () => {
  it("round-trips a memory note through write, read and list", async () => {
    const { t, accountId } = await setup();

    const written = await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/memory/preferencias.md",
      content: "# Preferências\n\n- nunca usar vermelho",
    });

    expect(written).toEqual({ ok: true, path: "/memory/preferencias.md", note: "criado" });

    const read = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/memory/preferencias.md",
    });

    expect(read.ok).toBe(true);

    if (read.ok && read.file.kind === "text") {
      expect(read.file.text).toContain("nunca usar vermelho");
    }

    const listing = await t.query(internal.workspaceData.list, { accountId, path: "/memory" });
    expect(listing.ok).toBe(true);

    if (listing.ok) {
      expect(listing.entries.map((entry) => entry.name)).toEqual(["preferencias.md"]);
    }
  });

  it("overwrites replace the head and append a revision", async () => {
    const { t, accountId } = await setup();
    const path = "/memory/plano.md";
    await t.mutation(internal.workspaceData.write, { accountId, path, content: "v1" });

    const second = await t.mutation(internal.workspaceData.write, {
      accountId,
      path,
      content: "v2",
    });

    expect(second).toEqual({ ok: true, path, note: "atualizado" });

    const read = await t.query(internal.workspaceData.read, { accountId, path });

    if (read.ok && read.file.kind === "text") expect(read.file.text).toBe("v2");

    const revisions = await t.run((ctx) =>
      ctx.db
        .query("workspaceFileRevisions")
        .withIndex("by_account_path", (q) => q.eq("accountId", accountId).eq("path", path))
        .collect(),
    );

    expect(revisions.map((revision) => revision.content)).toEqual(["v1", "v2"]);
  });

  it("writes brand notes and gates only them behind approval", async () => {
    const { t, accountId } = await setup();

    const written = await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/brand/notes.md",
      content: "assinar sempre como Café da Ana",
    });

    expect(written.ok).toBe(true);

    const read = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/brand/notes.md",
    });

    if (read.ok && read.file.kind === "text") {
      expect(read.file.text).toContain("assinar sempre");
    }
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

    const read = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/brand/kit.json",
    });

    expect(read.ok).toBe(true);

    if (read.ok && read.file.kind === "text") {
      const kit = parseBrandKit(read.file.text);

      expect(kit?.colors[0]?.hex).toBe("#d81b60");
      expect(kit?.tagline).toBe("café com afeto");
    }

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

  it("refuses projection writes with the verb that changes them", async () => {
    const { t, accountId } = await setup();

    const cases: Array<[string, string]> = [
      ["/images/promo.jpg", "paint"],
      ["/market/last-scan.json", "ferramentas Instagram"],
      ["/runs/x.json", "/templates"],
      ["/brand/memory.md", "notes.md"],
      ["/nao-existe/x.md", "/memory"],
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
      "/memory/Nota Final.md",
      "/memory/nota.txt",
      "/memory/sub/nota.md",
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
      path: "/memory/grande.md",
      content: "x".repeat(64_001),
    });

    expect(oversized.ok).toBe(false);

    if (!oversized.ok) expect(oversized.error).toContain("grande demais");
  });

  it("keeps written files invisible to other accounts", async () => {
    const { t, accountId, foreignAccountId } = await setup();
    await t.mutation(internal.workspaceData.write, {
      accountId,
      path: "/memory/segredo.md",
      content: "receita secreta",
    });

    const listing = await t.query(internal.workspaceData.list, {
      accountId: foreignAccountId,
      path: "/memory",
    });

    expect(listing.ok).toBe(true);

    if (listing.ok) expect(listing.entries).toEqual([]);

    const read = await t.query(internal.workspaceData.read, {
      accountId: foreignAccountId,
      path: "/memory/segredo.md",
    });

    expect(read.ok).toBe(false);
  });

  it("bounds serialized memory across files, counts UTF-8 bytes, and does not double-count replacements", async () => {
    const { t, accountId, foreignAccountId } = await setup();
    const path = "/memory/a.md";
    // The JSON array envelope and this path take 38 bytes, independently of the budget helper.
    const content = "x".repeat(23_962);

    const write = (path: string, content: string) =>
      t.mutation(internal.workspaceData.write, { accountId, path, content });

    expect((await write(path, content)).ok).toBe(true);
    expect((await write(path, content.replaceAll("x", "y"))).ok).toBe(true);
    expect((await write(path, content + "x")).ok).toBe(false);
    expect((await write("/memory/b.md", "")).ok).toBe(false);

    const stored = await t.query(internal.workspaceData.read, { accountId, path });
    expect(stored).toMatchObject({ ok: true, file: { text: content.replaceAll("x", "y") } });
    const context = await t.query(internal.brandContext.conversation, { accountId });
    expect(context).not.toContain("MEMÓRIA PARCIAL");
    expect(context).toContain(content.replaceAll("x", "y"));
    const revisions = await t.run((ctx) => ctx.db.query("workspaceFileRevisions").collect());
    expect(revisions).toHaveLength(2);

    expect((await write(path, "curto")).ok).toBe(true);
    expect((await write("/memory/b.md", "🌿".repeat(6_000))).ok).toBe(false);
    expect((await write("/memory/b.md", '"'.repeat(12_000))).ok).toBe(false);
    expect((await write("/memory/b.md", "z".repeat(12_000))).ok).toBe(true);
    expect((await write("/memory/c.md", "z".repeat(12_000))).ok).toBe(false);
    expect(
      (
        await t.mutation(internal.workspaceData.write, {
          accountId: foreignAccountId,
          path,
          content,
        })
      ).ok,
    ).toBe(true);
  });

  it("keeps legacy oversized memory readable, includes brand and preferences, and allows incremental compaction", async () => {
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
      ])
        await ctx.db.insert("workspaceFiles", {
          accountId,
          path: path!,
          content: content!,
          updatedAt: 1,
          updatedBy: "vanda",
        });
    });

    const context = await t.query(internal.brandContext.conversation, { accountId });
    expect(context).toContain("MEMÓRIA PARCIAL");
    expect(context).toContain("Café da Ana");
    expect(context).toContain("Não anunciar álcool");
    expect(context).toContain("Nunca oferecer entrega grátis");
    expect(context.length).toBeLessThan(25_000);
    expect(context).not.toContain("a".repeat(1_000));
    expect(
      await t.query(internal.workspaceData.read, { accountId, path: "/memory/a.md" }),
    ).toMatchObject({ ok: true, file: { text: "a".repeat(40_000) } });

    const write = (path: string, content: string) =>
      t.mutation(internal.workspaceData.write, { accountId, path, content });

    expect((await write("/memory/c.md", "mais notas")).ok).toBe(false);
    expect((await write("/memory/a.md", "a".repeat(40_001))).ok).toBe(false);
    // Preserve full details outside automatic memory before compacting each head.
    expect((await write("/notes/a.md", "a".repeat(40_000))).ok).toBe(true);
    expect(await write("/memory/a.md", "Resumo A: detalhes em /notes/a.md")).toMatchObject({
      ok: true,
      note: expect.stringContaining("ainda excede"),
    });
    expect((await write("/notes/b.md", "b".repeat(40_000))).ok).toBe(true);
    expect((await write("/memory/b.md", "Resumo B: detalhes em /notes/b.md")).ok).toBe(true);

    const compact = await t.query(internal.brandContext.conversation, { accountId });
    expect(compact).not.toContain("MEMÓRIA PARCIAL");
    expect(compact).toContain("Resumo A");
    expect(compact).toContain("Resumo B");
    expect(compact).toContain("Nunca oferecer entrega grátis");
    expect(compact).not.toContain("b".repeat(1_000));
    expect(
      await t.query(internal.workspaceData.read, { accountId, path: "/notes/b.md" }),
    ).toMatchObject({ ok: true, file: { text: "b".repeat(40_000) } });
  });
});
