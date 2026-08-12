// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/** A representative edited analysis the owner approves (mutable — these are mutation args). */
const analysis = {
  identity: {
    text: "Café Lumiar — cafeteria pet-friendly em Pinheiros",
    evidence: "Do perfil e bio",
    confidence: 0.95,
  },
  summary: {
    text: "Cafeteria pet-friendly em Pinheiros, de tom acolhedor.",
    evidence: "Síntese de 18 posts",
    confidence: 0.9,
  },
  kind: { value: "negocio" as const, evidence: "Conta business de um lugar", confidence: 0.85 },
  voice: {
    items: ["acolhedor", "informal", "local", "afetuoso com pets"],
    evidence: "Detectado em 18 posts",
    confidence: 0.9,
  },
  themes: {
    items: ["café especial", "inverno", "dogs", "clientes fiéis"],
    evidence: "Aparecem em 12 posts recentes",
    confidence: 0.6,
  },
  characters: {
    items: ["golden retriever", "baristas", "clientes com pets"],
    evidence: "Citados em 7 comentários",
    confidence: 0.4,
  },
  restrictions: {
    items: ["evitar promessas médicas", "evitar temas políticos"],
    evidence: "Sugestão da Vanda",
    confidence: 0.3,
  },
  opportunities: {
    items: ["combo de inverno", "posts com cachorro", "bastidores"],
    evidence: "Baseado no que mais engaja",
    confidence: 0.6,
  },
};

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

describe("approveBrandProfile", () => {
  it("writes canon, sets kind, and stamps onboardedAt", async () => {
    const { t, accountId } = await setup();
    await t
      .withIdentity({ subject: "c1" })
      .mutation(api.brandProfile.approveBrandProfile, { accountId, ...analysis });

    const canon = await t.run((ctx) => ctx.db.query("brandCanon").collect());
    const ofKind = (kind: string) => canon.filter((c) => c.kind === kind);
    expect(canon).toHaveLength(11); // 1 identity + 1 summary + 4 voice + 3 character + 2 restriction
    expect(ofKind("identity")).toHaveLength(1);
    expect(ofKind("summary")).toHaveLength(1);
    expect(ofKind("voice")).toHaveLength(4);
    expect(ofKind("character")).toHaveLength(3);
    expect(ofKind("restriction")).toHaveLength(2);
    expect(canon.every((c) => c.confirmedByOwner)).toBe(true);
    // themes/opportunities are NOT canon — they are onboarding previews only.
    expect(ofKind("theme")).toHaveLength(0);
    expect(ofKind("opportunity")).toHaveLength(0);

    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account?.onboardedAt).toBeTypeOf("number");
    expect(account?.kind).toBe("negocio"); // brand type carried from the analysis
  });

  it("rejects approval from a non-owner", async () => {
    const { t, accountId } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("users", { name: "Other", email: "o@e.com", clerkId: "c2" }),
    );
    await expect(
      t.withIdentity({ subject: "c2" }).mutation(api.brandProfile.approveBrandProfile, {
        accountId,
        ...analysis,
      }),
    ).rejects.toThrow();
  });

  it("rejects a second approve (single-use onboarding)", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "c1" });
    await owner.mutation(api.brandProfile.approveBrandProfile, {
      accountId,
      ...analysis,
    });
    await expect(
      owner.mutation(api.brandProfile.approveBrandProfile, {
        accountId,
        ...analysis,
      }),
    ).rejects.toThrow();
  });

  it("getBrandCanon returns the owner's confirmed canon", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "c1" });
    await owner.mutation(api.brandProfile.approveBrandProfile, {
      accountId,
      ...analysis,
    });
    const canon = await owner.query(api.brandProfile.getBrandCanon, { accountId });
    expect(canon).toHaveLength(11);
  });

  it("rejects an out-of-range confidence", async () => {
    const { t, accountId } = await setup();
    const bad = { ...analysis, voice: { ...analysis.voice, confidence: 1.5 } };
    await expect(
      t.withIdentity({ subject: "c1" }).mutation(api.brandProfile.approveBrandProfile, {
        accountId,
        ...bad,
      }),
    ).rejects.toThrow();
  });

});

describe("completeWithoutAnalysis", () => {
  it("onboards with empty canon and opens the welcome thread", async () => {
    const { t, accountId } = await setup();
    await t
      .withIdentity({ subject: "c1" })
      .mutation(api.brandProfile.completeWithoutAnalysis, { accountId });
    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account?.onboardedAt).toBeTypeOf("number");
    const canon = await t
      .withIdentity({ subject: "c1" })
      .query(api.brandProfile.getBrandCanon, { accountId });
    expect(canon).toHaveLength(0);
  });

  it("rejects non-owners and already-onboarded accounts", async () => {
    const { t, accountId } = await setup();
    await expect(
      t
        .withIdentity({ subject: "intruder" })
        .mutation(api.brandProfile.completeWithoutAnalysis, { accountId }),
    ).rejects.toThrow();
    await t
      .withIdentity({ subject: "c1" })
      .mutation(api.brandProfile.completeWithoutAnalysis, { accountId });
    await expect(
      t
        .withIdentity({ subject: "c1" })
        .mutation(api.brandProfile.completeWithoutAnalysis, { accountId }),
    ).rejects.toThrow(/already onboarded/);
  });
});

describe("reference photos", () => {
  it("adds, lists, and removes an owner's reference photo", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "c1" });

    const storageId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["fake-image"], { type: "image/png" })),
    );
    const imageId = await owner.mutation(api.brandProfile.addReferencePhoto, {
      accountId,
      storageId,
    });

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
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["dup"])));
    const first = await owner.mutation(api.brandProfile.addReferencePhoto, {
      accountId,
      storageId,
    });
    const second = await owner.mutation(api.brandProfile.addReferencePhoto, {
      accountId,
      storageId,
    });
    expect(second).toBe(first); // relinking returns the existing row, not a duplicate
    const listed = await owner.query(api.brandProfile.listReferencePhotos, { accountId });
    expect(listed).toHaveLength(1);
  });
});
