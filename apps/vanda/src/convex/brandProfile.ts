import { createThread, saveMessage } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalQuery, mutation, query } from "./_generated/server";
import * as Schema from "effect/Schema";
import { requireOwnedAccount } from "./authz";
import { BrandAnalysis, type BrandCanonKind } from "./pipeline/brand";
import { brandAnalysisArgs } from "./pipeline/storage";
import { brandCanonKinds } from "./pipeline/constants";
import { assessBrandReadiness } from "./pipeline/inputQuality";

/**
 * Resolve the connected Instagram handle for an account the caller owns.
 * `analyzeAccount` passes its verified Clerk id; ownership is checked again here
 * before first-party account data is read through the publisher profile.
 */
export const resolveOwnedHandle = internalQuery({
  args: { accountId: v.id("accounts"), clerkId: v.string() },
  handler: async (ctx, { accountId, clerkId }): Promise<{ handle: string }> => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
    const account = await ctx.db.get(accountId);
    if (!user || account === null || account.ownerUserId !== user._id) {
      throw new Error("account not found");
    }
    if (account.handle === undefined) throw new Error("account has no Instagram connection");
    return { handle: account.handle };
  },
});

/** Shapes of the analysis cards `approveBrandProfile` flattens into canon rows. */
type CanonCard = { readonly text: string; readonly evidence: string; readonly confidence: number };
type CanonGroup = {
  readonly items: ReadonlyArray<string>;
  readonly evidence: string;
  readonly confidence: number;
};

const canonFromText = (kind: BrandCanonKind, card: CanonCard) => ({
  kind,
  text: card.text,
  evidence: card.evidence,
  confidence: card.confidence,
});

const canonFromGroup = (kind: BrandCanonKind, group: CanonGroup) =>
  group.items.map((text) => ({
    kind,
    text,
    evidence: group.evidence,
    confidence: group.confidence,
  }));

/**
 * Confirm the brand profile — the end of onboarding. Validates the owner-approved
 * analysis against the domain contract (rejecting out-of-range confidence), then
 * writes it as canon (`identity`/`summary` single rows; `voice`/`character`/
 * `restriction` one row per chip), then stamps `onboardedAt`.
 * Single-use: re-confirming after onboarding is rejected — later memory edits get
 * their own mutation. Canon is fully replaced so a retry before completion stays
 * idempotent.
 */
export const approveBrandProfile = mutation({
  args: {
    accountId: v.id("accounts"),
    ...brandAnalysisArgs,
  },
  handler: async (ctx, args) => {
    const account = await requireOwnedAccount(ctx, args.accountId);
    if (account.onboardedAt !== undefined) throw new Error("account already onboarded");
    const { accountId, ...rest } = args;
    // The public mutation's v.number() args don't enforce UnitInterval; decode against
    // the domain contract so an out-of-range confidence is rejected, not persisted.
    const analysis = Schema.decodeSync(BrandAnalysis)(rest);
    const now = Date.now();

    const canon = [
      canonFromText("identity", analysis.identity),
      canonFromText("summary", analysis.summary),
      ...canonFromGroup("voice", analysis.voice),
      ...canonFromGroup("character", analysis.characters),
      ...canonFromGroup("restriction", analysis.restrictions),
    ];

    // Clean replace: drop any prior canon for this account, then insert confirmed rows.
    const existingCanon = await ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    for (const row of existingCanon) await ctx.db.delete(row._id);
    for (const item of canon) {
      await ctx.db.insert("brandCanon", {
        accountId,
        ...item,
        confirmedByOwner: true,
        createdAt: now,
      });
    }

    await ctx.db.patch(accountId, {
      kind: analysis.kind.value,
      onboardedAt: now,
      updatedAt: now,
    });
    if (account.ownerUserId !== undefined) {
      await ctx.db.patch(account.ownerUserId, { activeAccountId: accountId, updatedAt: now });
    }

    // Onboarding resolves into the conversation: Vanda opens the account's
    // first thread with what she learned and proposes the first action, so the
    // first thing the owner sees in /conversa is an operator, not an empty chat.
    // Threads are keyed by the account id (multi-thread model — see chat.ts).
    const existingThreads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: String(accountId),
      paginationOpts: { cursor: null, numItems: 1 },
    });
    if (existingThreads.page.length === 0) {
      const threadId = await createThread(ctx, components.agent, {
        userId: String(accountId),
        title: "Boas-vindas",
      });
      const voice = analysis.voice.items.slice(0, 4).join(", ");
      const themes = analysis.themes.items.slice(0, 4).join(", ");
      await saveMessage(ctx, components.agent, {
        threadId,
        agentName: "vanda",
        message: {
          role: "assistant",
          content:
            `Prontinho — sua marca agora faz parte da minha memória. Entendi que ${analysis.identity.text} ` +
            `A voz da marca é ${voice || "a que você confirmou"}, e os temas que mais aparecem no seu conteúdo são: ${themes || "os que confirmamos juntos"}.\n\n` +
            `Você pode corrigir qualquer um desses fatos no Perfil quando quiser — eu só trabalho com o que você confirmou.\n\n` +
            `Quer que eu já procure uma oportunidade no seu mercado? Eu observo criadores parecidos com você, encontro conteúdos com desempenho fora da curva e trago no máximo uma ideia forte. Tudo o que eu criar ou agendar fica visível no painel de posts — e dá para mudar ou desfazer quando quiser.`,
        },
      });
    }
  },
});

/**
 * The onboarding escape hatch: the corpus read failed (vendor outage, quota)
 * and the owner chose to continue anyway. Stamps `onboardedAt` with an empty
 * brand canon — Vanda starts knowing nothing and learns from the conversation,
 * which the instructions already handle (readiness 0 → ask the owner).
 */
export const completeWithoutAnalysis = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await requireOwnedAccount(ctx, accountId);
    if (account.onboardedAt !== undefined) throw new Error("account already onboarded");
    const now = Date.now();
    await ctx.db.patch(accountId, { onboardedAt: now, updatedAt: now });
    if (account.ownerUserId !== undefined) {
      await ctx.db.patch(account.ownerUserId, { activeAccountId: accountId, updatedAt: now });
    }
    const existingThreads = await ctx.runQuery(components.agent.threads.listThreadsByUserId, {
      userId: String(accountId),
      paginationOpts: { cursor: null, numItems: 1 },
    });
    if (existingThreads.page.length === 0) {
      const threadId = await createThread(ctx, components.agent, {
        userId: String(accountId),
        title: "Boas-vindas",
      });
      await saveMessage(ctx, components.agent, {
        threadId,
        agentName: "vanda",
        message: {
          role: "assistant",
          content:
            `Não consegui ler sua conta do Instagram agora, então vamos começar do jeito direto: me conta sobre o seu negócio — o que você vende, para quem, e o tom que você gosta de usar nas redes.\n\n` +
            `Vou anotando o que você me contar na memória da marca, e você revisa tudo no Perfil quando quiser. Fotos do seu produto ou do seu espaço também ajudam muito — pode mandar aqui na conversa.`,
        },
      });
    }
  },
});

/** The "what Vanda knows about your brand" panel: confirmed canon for an owned account. */
export const getBrandCanon = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    return ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
  },
});

export const getBrandReadiness = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    const canon = await ctx.db
      .query("brandCanon")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    return assessBrandReadiness({
      confirmedKinds: canon.filter((item) => item.confirmedByOwner).map((item) => item.kind),
    });
  },
});

/** Owner-authored corrections and missing creative facts become confirmed canon immediately. */
export const saveBrandFact = mutation({
  args: {
    accountId: v.id("accounts"),
    factId: v.optional(v.id("brandCanon")),
    kind: v.union(...brandCanonKinds.map((kind) => v.literal(kind))),
    text: v.string(),
  },
  handler: async (ctx, { accountId, factId, kind, text }) => {
    await requireOwnedAccount(ctx, accountId);
    const normalized = text.trim();
    if (!normalized) throw new Error("brand fact cannot be empty");
    const now = Date.now();
    let id = factId;
    if (factId) {
      const existing = await ctx.db.get(factId);
      if (!existing || existing.accountId !== accountId) throw new Error("brand fact not found");
      await ctx.db.patch(factId, {
        kind,
        text: normalized,
        evidence: "Corrigido pelo proprietário.",
        confidence: 1,
        confirmedByOwner: true,
      });
    } else {
      id = await ctx.db.insert("brandCanon", {
        accountId,
        kind,
        text: normalized,
        evidence: "Adicionado pelo proprietário.",
        confidence: 1,
        confirmedByOwner: true,
        createdAt: now,
      });
    }
    return id!;
  },
});

export const removeBrandFact = mutation({
  args: { factId: v.id("brandCanon") },
  handler: async (ctx, { factId }) => {
    const fact = await ctx.db.get(factId);
    if (!fact) throw new Error("brand fact not found");
    await requireOwnedAccount(ctx, fact.accountId);
    await ctx.db.delete(factId);
  },
});

// --- Reference photos (brand reference images for personal brands) ----------

/**
 * A short-lived upload URL for a reference photo. Auth-gated; the uploaded file is
 * linked to an account by `addReferencePhoto` once the client finishes the upload.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Link an uploaded file to an account as a brand reference photo (personal brands).
 * Validates the upload exists and is unlinked first: a double-submit (or a reused
 * id) would otherwise create rows sharing one blob, so removing one breaks the
 * rest. Idempotent — relinking the same upload returns the existing row.
 */
export const addReferencePhoto = mutation({
  args: {
    accountId: v.id("accounts"),
    storageId: v.id("_storage"),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    kind: v.optional(
      v.union(v.literal("face"), v.literal("product"), v.literal("place"), v.literal("style")),
    ),
  },
  handler: async (ctx, { accountId, storageId, width, height, kind }) => {
    await requireOwnedAccount(ctx, accountId);
    // getUrl is null for an unknown/expired upload — reject before linking a dead id.
    if ((await ctx.storage.getUrl(storageId)) === null) throw new Error("upload not found");
    const existing = await ctx.db
      .query("images")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (existing !== null) return existing._id;
    return ctx.db.insert("images", {
      accountId,
      origin: "uploaded",
      purpose: "reference",
      storageId,
      ...(kind !== undefined ? { referenceKind: kind } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      createdAt: Date.now(),
    });
  },
});

/**
 * The owner's authorized reference photos with resolved URLs — what generation
 * may condition on (identity, product, place). Used by the render pipeline and
 * the agent; account scoping is structural.
 */
export const listAuthorizedReferences = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const images = await ctx.db
      .query("images")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const references = images.filter((image) => image.purpose === "reference");
    return (
      await Promise.all(
        references.map(async (image) => ({
          imageId: image._id,
          kind: image.referenceKind,
          containsFace: image.containsFace,
          description: image.description,
          url:
            image.externalUrl ??
            (image.storageId ? await ctx.storage.getUrl(image.storageId) : null),
        })),
      )
    ).filter((item) => item.url !== null);
  },
});

/** The owner's brand reference photos, with resolved URLs for display. */
export const listReferencePhotos = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    const images = await ctx.db
      .query("images")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const references = images.filter((image) => image.purpose === "reference");
    return Promise.all(
      references.map(async (image) => ({
        id: image._id,
        url: image.storageId === undefined ? null : await ctx.storage.getUrl(image.storageId),
      })),
    );
  },
});

/** Remove a reference photo the caller owns (deletes the row; the blob only when
 *  no other image row still references it). */
export const removeReferencePhoto = mutation({
  args: { imageId: v.id("images") },
  handler: async (ctx, { imageId }) => {
    const image = await ctx.db.get(imageId);
    if (image === null || image.purpose !== "reference") {
      throw new Error("reference photo not found");
    }
    await requireOwnedAccount(ctx, image.accountId);
    await ctx.db.delete(imageId);
    if (image.storageId !== undefined) {
      const stillLinked = await ctx.db
        .query("images")
        .withIndex("by_storage", (q) => q.eq("storageId", image.storageId))
        .first();
      if (stillLinked === null) await ctx.storage.delete(image.storageId);
    }
  },
});
