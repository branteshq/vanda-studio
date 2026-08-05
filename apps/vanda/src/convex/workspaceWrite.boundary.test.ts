// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { writeNeedsApproval } from "./workspace";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const accountId = await ctx.db.insert("accounts", {
      mode: "manual",
      name: "Café da Ana",
      createdAt: now,
      updatedAt: now,
    });
    const foreignAccountId = await ctx.db.insert("accounts", {
      mode: "manual",
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

    expect(writeNeedsApproval("/brand/notes.md")).toBe(true);
    expect(writeNeedsApproval("brand/notes.md/")).toBe(true);
    expect(writeNeedsApproval("/memory/preferencias.md")).toBe(false);
    expect(writeNeedsApproval("/templates/moldura.py")).toBe(false);
  });

  it("refuses projection writes with the verb that changes them", async () => {
    const { t, accountId } = await setup();
    const cases: Array<[string, string]> = [
      ["/projects/qualquer/status.json", "revise_slide"],
      ["/images/promo.jpg", "paint"],
      ["/market/last-scan.json", "start_market_scan"],
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
});
