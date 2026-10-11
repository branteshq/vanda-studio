// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { saveMessage } from "@convex-dev/agent";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { brandFileFacts } from "./brandFile";
import { analysisFacts } from "./pipeline/brandProfile";
import { cafeLumiarAnalysis } from "./pipeline/brandProfile.testing";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async (clerkId = "c1") => {
  const t = convexTest(schema, modules);
  agentTest.register(t);

  const accountId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Marina", email: "m@e.com", clerkId });

    return ctx.db.insert("accounts", {
      ownerUserId: userId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return { t, accountId };
};

const readArgs = (accountId: Id<"accounts">) => ({
  accountId,
  kind: "negocio" as const,
  facts: analysisFacts(cafeLumiarAnalysis, Date.UTC(2026, 9, 11, 12)),
  opener: "Oi! Eu sou o Caetano 🐒 Quanto custa o combo de inverno?",
  note: "# Leitura do Instagram",
});

type Harness = ReturnType<typeof convexTest>;

const storePhoto = (t: Harness) =>
  t.run((ctx) => ctx.storage.store(new Blob(["fake-image"], { type: "image/png" })));

const addPhoto = (t: Harness, accountId: Id<"accounts">, storageId: Id<"_storage">) =>
  t.withIdentity({ subject: "c1" }).mutation(api.brandProfile.addReferencePhoto, {
    accountId,
    storageId,
  });

describe("completeOnboarding", () => {
  it("opens the brand file from the Instagram read and Caetano's guide thread", async () => {
    const { t, accountId } = await setup();
    await t.mutation(internal.brandProfile.completeOnboarding, readArgs(accountId));

    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account?.onboardedAt).toBeTypeOf("number");
    expect(account?.kind).toBe("negocio");

    const brandFile = await t
      .withIdentity({ subject: "c1" })
      .query(api.brandFile.get, { accountId });

    expect(brandFile.persisted).toBe(true);
    expect(brandFile.content).toContain(
      "- O que é: Café Lumiar — cafeteria pet-friendly em Pinheiros (observado: Do perfil e bio, 11/10/2026)",
    );
    // Low-confidence cards are asked in the conversation, not written.
    expect(brandFile.content).not.toContain("golden retriever");

    const threads = await t.run((ctx) =>
      ctx.runQuery(components.agent.threads.listThreadsByUserId, {
        userId: String(accountId),
        paginationOpts: { cursor: null, numItems: 5 },
      }),
    );

    expect(threads.page).toHaveLength(1);
    expect(account?.brandGuideThreadId).toBe(threads.page[0]!._id);

    const guide = await t.withIdentity({ subject: "c1" }).query(api.brandFile.guide, { accountId });
    // The read filled the business and the voice; the rest is the interview.
    expect(guide.sections.map((section) => section.filled)).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it("is a no-op once onboarded (a retried read)", async () => {
    const { t, accountId } = await setup();
    await t.mutation(internal.brandProfile.completeOnboarding, readArgs(accountId));
    await t.mutation(internal.brandProfile.completeOnboarding, {
      ...readArgs(accountId),
      facts: [],
    });

    const brandFile = await t
      .withIdentity({ subject: "c1" })
      .query(api.brandFile.get, { accountId });

    expect(brandFileFacts(brandFile.content).length).toBeGreaterThan(0);
  });
});

describe("completeOnboarding restart", () => {
  it("refills an empty brand file of an onboarded business and opens a fresh guide", async () => {
    const { t, accountId } = await setup();
    const read = readArgs(accountId);

    await t.mutation(internal.brandProfile.completeOnboarding, {
      accountId,
      kind: null,
      facts: [],
      opener: null,
      note: null,
    });

    const first = (await t.run((ctx) => ctx.db.get(accountId)))?.brandGuideThreadId;

    await t.mutation(internal.brandProfile.completeOnboarding, read);

    const brandFile = await t
      .withIdentity({ subject: "c1" })
      .query(api.brandFile.get, { accountId });

    expect(brandFile.content).toContain("Café Lumiar");

    const note = await t.run((ctx) =>
      ctx.db
        .query("workspaceFiles")
        .withIndex("by_account_path", (q) =>
          q.eq("accountId", accountId).eq("path", "/notes/leitura-instagram.md"),
        )
        .unique(),
    );

    expect(note?.content).toBe("# Leitura do Instagram");

    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account?.brandGuideThreadId).not.toBe(first);

    // A file with content is left alone: no new thread, no new facts.
    await t.mutation(internal.brandProfile.completeOnboarding, { ...read, facts: [] });

    const after = await t.run((ctx) => ctx.db.get(accountId));
    expect(after?.brandGuideThreadId).toBe(account?.brandGuideThreadId);
    expect(brandFileFacts(brandFile.content).length).toBeGreaterThan(0);
  });
});

describe("resolveOwnedHandle", () => {
  it("returns a null handle for the owner when no Instagram is connected", async () => {
    const { t, accountId } = await setup();

    await expect(
      t.query(internal.brandProfile.resolveOwnedHandle, { accountId, clerkId: "c1" }),
    ).resolves.toEqual({ handle: null, onboarded: false, guideEmpty: true });
    await expect(
      t.query(internal.brandProfile.resolveOwnedHandle, { accountId, clerkId: "c2" }),
    ).rejects.toThrow("account not found");
  });
});

describe("reference photos", () => {
  it("adds, lists, and removes an owner's reference photo", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "c1" });

    const imageId = await addPhoto(t, accountId, await storePhoto(t));

    const listed = await owner.query(api.brandProfile.listReferencePhotos, { accountId });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(imageId);

    // the stored image is tagged as a reference, not post-bound media
    const image = await t.run((ctx) => ctx.db.get(imageId));
    expect(image?.purpose).toBe("reference");
    expect(image?.origin).toBe("uploaded");

    await owner.mutation(api.brandProfile.removeReferencePhoto, { imageId });
    const after = await owner.query(api.brandProfile.listReferencePhotos, { accountId });
    expect(after).toHaveLength(0);
  });

  it("rejects adding a reference photo to an account the caller does not own", async () => {
    const { t, accountId } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("users", { name: "Other", email: "o@e.com", clerkId: "c2" }),
    );
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"])));
    await expect(
      t
        .withIdentity({ subject: "c2" })
        .mutation(api.brandProfile.addReferencePhoto, { accountId, storageId }),
    ).rejects.toThrow();
  });

  it("requires auth to generate an upload URL", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.brandProfile.generateUploadUrl, {})).rejects.toThrow();
  });

  it("is idempotent on a repeated upload id (no shared-blob rows)", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "c1" });
    const storageId = await storePhoto(t);
    const first = await addPhoto(t, accountId, storageId);
    const second = await addPhoto(t, accountId, storageId);

    expect(second).toBe(first); // relinking returns the existing row, not a duplicate
    const listed = await owner.query(api.brandProfile.listReferencePhotos, { accountId });
    expect(listed).toHaveLength(1);
  });
});

describe("openGuide", () => {
  it("opens the guide thread once for an onboarded business without one", async () => {
    const { t, accountId } = await setup();
    await t.run((ctx) => ctx.db.patch(accountId, { onboardedAt: Date.now() }));

    const owner = t.withIdentity({ subject: "c1" });
    const threadId = await owner.mutation(api.brandProfile.openGuide, { accountId });

    expect(threadId).toBeTypeOf("string");

    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account?.brandGuideThreadId).toBe(threadId);

    await expect(owner.mutation(api.brandProfile.openGuide, { accountId })).resolves.toBe(threadId);
  });

  it("restarts a cleared guide only once the owner has answered in it", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "c1" });
    const oldId = (await owner.mutation(api.brandProfile.openGuide, { accountId }))!;

    await t.run((ctx) =>
      saveMessage(ctx, components.agent, {
        threadId: oldId,
        message: { role: "user", content: "oi" },
      }),
    );

    const freshId = await owner.mutation(api.brandProfile.openGuide, { accountId });
    expect(freshId).not.toBe(oldId);

    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account?.brandGuideThreadId).toBe(freshId);
    await expect(owner.mutation(api.brandProfile.openGuide, { accountId })).resolves.toBe(freshId);
  });

  it("rejects a caller who does not own the account", async () => {
    const { t, accountId } = await setup();

    await expect(
      t.withIdentity({ subject: "c2" }).mutation(api.brandProfile.openGuide, { accountId }),
    ).rejects.toThrow();
  });
});
