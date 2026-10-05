// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { BRAND_FILE_PATH, brandFileFacts, brandFileKinds, composeBrandFile } from "./brandFile";
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

describe("brand file facts", () => {
  it("lists every item under its section and skips the legend", () => {
    expect(brandFileFacts(file)).toEqual([
      { id: "marca-1", kind: "O negócio", text: "Cafeteria de bairro no Recife (dono)" },
      { id: "marca-2", kind: "Tom e voz", text: "Calorosa e direta (dono)" },
      { id: "marca-3", kind: "Nunca fazer", text: "Não anunciar bebidas alcoólicas (dono)" },
    ]);
  });

  it("covers the onboarding kinds of every section with an item", () => {
    const kinds = brandFileKinds(file);

    expect(kinds).toEqual(expect.arrayContaining(["identity", "summary", "voice", "restriction"]));
    expect(kinds).not.toContain("audience");
  });
});

describe("radar brand context", () => {
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
    expect(context.context).toContain("Nunca fazer: Não anunciar bebidas alcoólicas (dono)");
    expect(context.readiness.ready).toBe(true);

    const snapshot = await t.mutation(internal.market.ensureBrandSnapshot, { accountId });
    expect(snapshot.context).toBe(file);
    expect(snapshot.canonIds).toBeUndefined();
    // The same file reuses the snapshot.
    expect((await t.mutation(internal.market.ensureBrandSnapshot, { accountId }))._id).toBe(
      snapshot._id,
    );
  });
});
