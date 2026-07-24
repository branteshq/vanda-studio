import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import * as Schema from "effect/Schema";
import { requireOwnedAccount } from "./authz";
import { BrandAnalysis, type BrandCanonKind } from "./pipeline/brand";
import { brandAnalysisArgs } from "./pipeline/storage";
import { accountModes, brandCanonKinds } from "./pipeline/constants";
import { assessBrandReadiness } from "./pipeline/inputQuality";
import { internal } from "./_generated/api";

/**
 * The Instagram connection (id + encrypted token) for an account the caller owns.
 * Internal-only — it returns token ciphertext, so it must never be a public
 * function. `analyzeAccount` (brandProfileNode.ts) passes its verified `clerkId`;
 * ownership is re-checked here against the account before any secret is handed out.
 */
export const resolveOwnedConnection = internalQuery({
  args: { accountId: v.id("accounts"), clerkId: v.string() },
  handler: async (ctx, { accountId, clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
    const account = await ctx.db.get(accountId);
    if (!user || account === null || account.ownerUserId !== user._id) {
      throw new Error("account not found");
    }
    if (account.connectionId === undefined) throw new Error("account has no Instagram connection");
    const connection = await ctx.db.get(account.connectionId);
    if (connection === null) throw new Error("connection not found");
    return {
      igUserId: connection.externalAccountId,
      tokenCiphertext: connection.tokenCiphertext,
      tokenIv: connection.tokenIv,
      tokenAuthTag: connection.tokenAuthTag,
    };
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
 * `restriction` one row per chip) and seeds the detected `themes`, then stamps
 * `onboardedAt`. Opportunities are previews only — the planner earns the first
 * real suggestions from observed evidence, so onboarding never hand-seeds them
 * (a "suggestion"-status row is regenerable and a plan pass would erase it).
 * Single-use: re-confirming after onboarding is rejected — later memory edits get
 * their own mutation. Canon is fully replaced so a retry before completion stays
 * idempotent.
 */
export const approveBrandProfile = mutation({
  args: {
    accountId: v.id("accounts"),
    mode: v.union(...accountModes.map((m) => v.literal(m))),
    ...brandAnalysisArgs,
  },
  handler: async (ctx, args) => {
    const account = await requireOwnedAccount(ctx, args.accountId);
    if (account.onboardedAt !== undefined) throw new Error("account already onboarded");
    const { accountId, mode, ...rest } = args;
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

    // Seed detected themes (upsert by name — consolidate may already own some).
    const existingThemes = await ctx.db
      .query("themes")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    const themeNames = new Set(existingThemes.map((t) => t.name));
    for (const name of analysis.themes.items) {
      if (themeNames.has(name)) continue;
      themeNames.add(name); // also dedup chips repeated within this same approval
      await ctx.db.insert("themes", {
        accountId,
        name,
        summary: analysis.themes.evidence,
        momentum: "steady",
        postCount: 0,
        signalCount: 0,
      });
    }

    await ctx.db.patch(accountId, {
      kind: analysis.kind.value,
      mode,
      onboardedAt: now,
      updatedAt: now,
    });
    if (account.ownerUserId !== undefined) {
      await ctx.db.patch(account.ownerUserId, { activeAccountId: accountId, updatedAt: now });
    }
    await ctx.scheduler.runAfter(0, internal.knowledge.refreshAccount, { accountId });
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
    await ctx.scheduler.runAfter(0, internal.knowledge.refreshAccount, { accountId });
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
    await ctx.scheduler.runAfter(0, internal.knowledge.refreshAccount, {
      accountId: fact.accountId,
    });
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
  },
  handler: async (ctx, { accountId, storageId, width, height }) => {
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
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      createdAt: Date.now(),
    });
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
