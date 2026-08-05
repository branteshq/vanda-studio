// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { entitySuffix } from "./workspace/types";
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
    await ctx.db.insert("brandCanon", {
      accountId,
      kind: "voice",
      text: "tom caloroso e direto",
      confirmedByOwner: true,
      createdAt: now,
    });
    const galleryImageId = await ctx.db.insert("images", {
      accountId,
      origin: "generated",
      purpose: "post",
      externalUrl: "https://images.example/promo.jpg",
      name: "promo agosto",
      prompt: "café gelado na bancada",
      width: 1080,
      height: 1350,
      mimeType: "image/jpeg",
      model: "python/pillow",
      createdAt: now,
    });
    const foreignImageId = await ctx.db.insert("images", {
      accountId: foreignAccountId,
      origin: "generated",
      externalUrl: "https://images.example/foreign.jpg",
      name: "segredo alheio",
      createdAt: now,
    });
    const projectId = await ctx.db.insert("contentProjects", {
      accountId,
      kind: "carousel",
      origin: "manual",
      title: "Promo de Inverno",
      status: "draft",
      latestVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, foreignAccountId, galleryImageId, foreignImageId, projectId };
  });
  return { t, ...ids };
};

describe("workspace navigation", () => {
  it("lists the mounts at the root", async () => {
    const { t, accountId } = await setup();
    const result = await t.query(internal.workspaceData.list, { accountId, path: "/" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries.map((entry) => entry.name)).toEqual([
        "brand",
        "memory",
        "templates",
        "images",
        "projects",
        "market",
        "runs",
      ]);
    }
  });

  it("answers a miss with the nearest listing, never a bare not-found", async () => {
    const { t, accountId } = await setup();
    const result = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/projects/nao-existe-xxxxxx/slides.md",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.nearest).toBe("/projects");
      expect(result.entries.some((entry) => entry.name.startsWith("promo-de-inverno-"))).toBe(true);
    }
  });

  it("reading a directory returns its listing", async () => {
    const { t, accountId } = await setup();
    const result = await t.query(internal.workspaceData.read, { accountId, path: "/brand" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.entries.map((entry) => entry.name)).toContain("memory.md");
    }
  });
});

describe("workspace renders", () => {
  it("renders brand memory with confirmed facts", async () => {
    const { t, accountId } = await setup();
    const result = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/brand/memory.md",
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.file.kind === "text") {
      expect(result.file.text).toContain("Café da Ana");
      expect(result.file.text).toContain("**voice**: tom caloroso e direto");
    }
  });

  it("lists the gallery with summaries carrying the imageId", async () => {
    const { t, accountId, galleryImageId } = await setup();
    const result = await t.query(internal.workspaceData.list, { accountId, path: "/images" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const entry = result.entries[0]!;
      expect(entry.name).toBe(`promo-agosto-${entitySuffix(galleryImageId)}.jpg`);
      expect(entry.summary).toContain("1080×1350");
      expect(entry.summary).toContain(galleryImageId);
    }
  });

  it("reads a gallery image as header + url", async () => {
    const { t, accountId, galleryImageId } = await setup();
    const result = await t.query(internal.workspaceData.read, {
      accountId,
      path: `/images/promo-agosto-${entitySuffix(galleryImageId)}.jpg`,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.file.kind === "image") {
      expect(result.file.url).toBe("https://images.example/promo.jpg");
      expect(result.file.header).toContain(galleryImageId);
      expect(result.file.header).toContain("Pillow (código)");
    }
  });

  it("paginates text reads with a range note", async () => {
    const { t, accountId } = await setup();
    const result = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/brand/memory.md",
      offset: 1,
      limit: 1,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.file.kind === "text") {
      expect(result.file.text).toContain("# Memória de marca");
      expect(result.file.text).toContain("[linhas 1–1 de");
    }
  });
});

describe("workspace path stability", () => {
  it("resolves entities by stale slugs and bare suffixes", async () => {
    const { t, accountId, projectId } = await setup();
    const suffix = entitySuffix(projectId);
    for (const name of [`promo-de-inverno-${suffix}`, `nome-antigo-${suffix}`, suffix, projectId]) {
      const result = await t.query(internal.workspaceData.read, {
        accountId,
        path: `/projects/${name}/status.json`,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.file.kind === "text") {
        expect(result.file.text).toContain("Promo de Inverno");
      }
    }
  });
});

describe("workspace identity boundary", () => {
  it("keeps foreign entities invisible and unresolvable", async () => {
    const { t, accountId, foreignImageId } = await setup();
    const listing = await t.query(internal.workspaceData.list, { accountId, path: "/images" });
    expect(listing.ok).toBe(true);
    if (listing.ok) {
      expect(listing.entries.some((entry) => entry.summary?.includes(foreignImageId))).toBe(false);
    }
    const result = await t.query(internal.workspaceData.read, {
      accountId,
      path: `/images/segredo-alheio-${entitySuffix(foreignImageId)}.jpg`,
    });
    expect(result.ok).toBe(false);
  });
});
