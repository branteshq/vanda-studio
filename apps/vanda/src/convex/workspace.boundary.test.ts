// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import { entitySuffix } from "./workspace/types";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerUserId = await ctx.db.insert("users", {
      name: "Ana",
      email: "ana@example.com",
      clerkId: "owner",
    });
    const foreignUserId = await ctx.db.insert("users", {
      name: "Outra pessoa",
      email: "outra@example.com",
      clerkId: "foreign",
    });
    const accountId = await ctx.db.insert("accounts", {
      ownerUserId,
      name: "Café da Ana",
      createdAt: now,
      updatedAt: now,
    });
    const foreignAccountId = await ctx.db.insert("accounts", {
      ownerUserId: foreignUserId,
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
    return { accountId, foreignAccountId, galleryImageId, foreignImageId };
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
        "skills",
        "images",
        "instagram",
        "posts",
        "market",
        "runs",
      ]);
    }
  });

  it("lists installed skills and reads their standard SKILL.md package", async () => {
    const { t, accountId } = await setup();
    const listing = await t.query(internal.workspaceData.list, {
      accountId,
      path: "/skills",
    });
    expect(listing.ok).toBe(true);
    if (listing.ok) {
      expect(listing.entries).toEqual([expect.objectContaining({ name: "unslop", kind: "dir" })]);
    }

    const instructions = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/skills/unslop/SKILL.md",
    });
    expect(instructions.ok).toBe(true);
    if (instructions.ok && instructions.file.kind === "text") {
      expect(instructions.file.text).toContain("name: unslop");
      expect(instructions.file.text).toContain("# Unslop");
    }

    const license = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/skills/unslop/LICENSE",
    });
    expect(license.ok).toBe(true);
    if (license.ok && license.file.kind === "text") {
      expect(license.file.text).toContain("MIT License");
    }
  });

  it("answers a miss with the nearest listing, never a bare not-found", async () => {
    const { t, accountId } = await setup();
    const result = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/images/nao-existe-xxxxxx.jpg",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.nearest).toBe("/images");
      expect(result.entries.some((entry) => entry.name.startsWith("promo-agosto-"))).toBe(true);
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

describe("installed skills public query", () => {
  it("lists skills for the owner and rejects another account", async () => {
    const { t, accountId, foreignAccountId } = await setup();
    const asOwner = t.withIdentity({ subject: "owner" });
    await expect(
      asOwner.query(api.workspacePublic.installedSkills, { accountId }),
    ).resolves.toEqual([expect.objectContaining({ name: "unslop", alwaysApply: true })]);
    await expect(
      asOwner.query(api.workspacePublic.installedSkills, { accountId: foreignAccountId }),
    ).rejects.toThrow("account not found");
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
    const { t, accountId, galleryImageId } = await setup();
    const suffix = entitySuffix(galleryImageId);
    for (const name of [
      `promo-agosto-${suffix}.jpg`,
      `nome-antigo-${suffix}.jpg`,
      `${suffix}.jpg`,
    ]) {
      const result = await t.query(internal.workspaceData.read, {
        accountId,
        path: `/images/${name}`,
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.file.kind === "image") {
        expect(result.file.header).toContain(galleryImageId);
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
