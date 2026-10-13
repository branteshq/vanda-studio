// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { saveMessage } from "@convex-dev/agent";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { brandFileFacts } from "./brandFile";
import { isPlatformTurn } from "./platformTurn";
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

type Harness = ReturnType<typeof convexTest>;

const storePhoto = (t: Harness) =>
  t.run((ctx) => ctx.storage.store(new Blob(["fake-image"], { type: "image/png" })));

const addPhoto = (t: Harness, accountId: Id<"accounts">, storageId: Id<"_storage">) =>
  t.withIdentity({ subject: "c1" }).mutation(api.brandProfile.addReferencePhoto, {
    accountId,
    storageId,
  });

describe("onboard", () => {
  it("marks the business onboarded with an empty brand file, once", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "c1" });

    await owner.mutation(api.brandProfile.onboard, { accountId });

    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account?.onboardedAt).toBeTypeOf("number");

    const user = await t.run((ctx) => ctx.db.get(account!.ownerUserId!));
    expect(user?.activeAccountId).toBe(accountId);

    const brandFile = await owner.query(api.brandFile.get, { accountId });
    expect(brandFile.persisted).toBe(true);
    expect(brandFileFacts(brandFile.content)).toEqual([]);

    // A retry leaves the first onboarding alone.
    await owner.mutation(api.brandProfile.onboard, { accountId });
    const again = await t.run((ctx) => ctx.db.get(accountId));
    expect(again?.onboardedAt).toBe(account?.onboardedAt);
  });

  it("rejects a caller who does not own the account", async () => {
    const { t, accountId } = await setup();

    await expect(
      t.withIdentity({ subject: "c2" }).mutation(api.brandProfile.onboard, { accountId }),
    ).rejects.toThrow();
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

  it("starts the guide with Caetano's turn, not a canned question", async () => {
    const { t, accountId } = await setup();

    const threadId = (await t
      .withIdentity({ subject: "c1" })
      .mutation(api.brandProfile.openGuide, { accountId }))!;

    const messages = await t.run((ctx) =>
      ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
        threadId,
        order: "asc",
        paginationOpts: { cursor: null, numItems: 5 },
      }),
    );

    // Only the hidden start: Caetano writes the first message after reading the account.
    expect(messages.page.map((message) => message.message?.role)).toEqual(["user"]);
    expect(isPlatformTurn(messages.page[0]!.text ?? "")).toBe(true);

    const activity = await t.run((ctx) => ctx.db.query("chatThreadActivity").collect());
    expect(activity.map((row) => row.threadId)).toEqual([threadId]);

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.map((job) => job.name)).toContain("chat:generateResponse");
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

/** Caetano's first draft: every section filled with guesses, plus one observed result. */
const DRAFT = `# Tábua Contábil

## O negócio
- Oferta: contabilidade para MEI (Vanda)
- Preço: plano MEI R$ 89/mês (dono)

## Público
- MEIs de Recife que fazem tudo sozinhos (Vanda).

## Voz
- Tom: direto, didático (Vanda)

## Design
- Paleta: #14213D azul (fundo); #F2B134 mostarda (destaque) (Vanda)

## Nunca fazer
- prometer restituição de imposto (dono)

## Provas
- CRC ativo (Vanda)

## O que funciona
- carrosséis de dicas salvam mais (Vanda)
`;

describe("the guide ends on the owner's approval", () => {
  it("stays open with a complete draft, then finishGuide confirms the guesses and closes it", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "c1" });
    await t.run((ctx) => ctx.db.patch(accountId, { onboardedAt: Date.now() }));
    const threadId = (await owner.mutation(api.brandProfile.openGuide, { accountId }))!;
    await owner.mutation(api.brandFile.save, { accountId, content: DRAFT });

    // A full draft is not an approval: the guide keeps its thread.
    await expect(owner.mutation(api.brandProfile.openGuide, { accountId })).resolves.toBe(threadId);
    expect((await owner.query(api.brandFile.guide, { accountId })).done).toBe(false);

    // Only the guide thread may end it.
    await expect(
      t.mutation(internal.brandProfile.finishGuide, { accountId, threadId: "another-thread" }),
    ).resolves.toMatchObject({ ok: false });

    await expect(
      t.mutation(internal.brandProfile.finishGuide, { accountId, threadId }),
    ).resolves.toEqual({ ok: true, confirmed: 5 });

    const file = await owner.query(api.brandFile.get, { accountId });
    const content = file?.content ?? "";
    expect(content).toContain("- Oferta: contabilidade para MEI (dono)");
    expect(content).toContain("- MEIs de Recife que fazem tudo sozinhos (dono).");
    expect(content).toContain("(destaque) (dono)");
    // Results are evidence, not the owner's word.
    expect(content).toContain("- carrosséis de dicas salvam mais (Vanda)");

    expect((await owner.query(api.brandFile.guide, { accountId })).done).toBe(true);
    await expect(owner.mutation(api.brandProfile.openGuide, { accountId })).resolves.toBeNull();
  });
  it("ends from the owner's button the same way, once, and only for the owner", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "c1" });
    const stranger = t.withIdentity({ subject: "someone-else" });
    await t.run((ctx) => ctx.db.patch(accountId, { onboardedAt: Date.now() }));
    await owner.mutation(api.brandProfile.openGuide, { accountId });
    await owner.mutation(api.brandFile.save, { accountId, content: DRAFT });

    await expect(stranger.mutation(api.brandProfile.approveGuide, { accountId })).rejects.toThrow();
    expect((await owner.query(api.brandFile.guide, { accountId })).done).toBe(false);

    await expect(owner.mutation(api.brandProfile.approveGuide, { accountId })).resolves.toEqual({
      confirmed: 5,
    });
    const content = (await owner.query(api.brandFile.get, { accountId }))?.content ?? "";
    expect(content).toContain("- Oferta: contabilidade para MEI (dono)");
    expect((await owner.query(api.brandFile.guide, { accountId })).done).toBe(true);

    // A second press (or Caetano's tool after it) changes nothing.
    await expect(owner.mutation(api.brandProfile.approveGuide, { accountId })).resolves.toEqual({
      confirmed: 0,
    });
  });
});
