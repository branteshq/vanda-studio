import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireOwnedAccount } from "./authz";

const inspectionArg = {
  description: v.string(),
  subjects: v.array(v.string()),
  dominantColors: v.array(v.string()),
  containsText: v.boolean(),
  containsFace: v.boolean(),
  containsProduct: v.boolean(),
  safeForBrandUse: v.boolean(),
  allowedRoles: v.array(v.string()),
  warnings: v.array(v.string()),
  confidence: v.number(),
};

const visualProfileArg = {
  name: v.string(),
  rationale: v.string(),
  palette: v.object({
    background: v.string(),
    surface: v.string(),
    text: v.string(),
    muted: v.string(),
    accent: v.string(),
    accentContrast: v.string(),
  }),
  typography: v.object({
    headline: v.union(
      v.literal("modern_sans"),
      v.literal("humanist_sans"),
      v.literal("editorial_serif"),
    ),
    body: v.union(
      v.literal("modern_sans"),
      v.literal("humanist_sans"),
      v.literal("editorial_serif"),
    ),
    weight: v.union(
      v.literal("regular"),
      v.literal("medium"),
      v.literal("bold"),
      v.literal("black"),
    ),
  }),
  artDirection: v.string(),
  motifs: v.array(v.string()),
  photoTreatment: v.union(
    v.literal("natural"),
    v.literal("warm"),
    v.literal("cool"),
    v.literal("duotone"),
    v.literal("none"),
  ),
  avoid: v.array(v.string()),
};

export const requireAccountOwner = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    return accountId;
  },
});

export const loadInput = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get(accountId);
    if (!account) return null;
    const facts = (
      await ctx.db
        .query("brandCanon")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    ).filter((fact) => fact.confirmedByOwner);
    const references = (
      await ctx.db
        .query("images")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect()
    ).filter((image) => image.purpose === "reference");
    return {
      account,
      facts: facts.map((fact) => ({ id: String(fact._id), kind: fact.kind, text: fact.text })),
      references: await Promise.all(
        references.map(async (image) => ({
          image,
          url:
            image.externalUrl ??
            (image.storageId ? await ctx.storage.getUrl(image.storageId) : null),
        })),
      ),
    };
  },
});

export const saveInspection = internalMutation({
  args: { imageId: v.id("images"), ...inspectionArg },
  handler: async (ctx, { imageId, ...inspection }) => {
    const image = await ctx.db.get(imageId);
    if (!image) throw new Error("reference image not found");
    await ctx.db.patch(imageId, {
      inspectionStatus: "ready",
      description: inspection.description,
      visualDescription: inspection.description,
      visualSubjects: inspection.subjects,
      dominantColors: inspection.dominantColors,
      containsText: inspection.containsText,
      containsFace: inspection.containsFace,
      containsProduct: inspection.containsProduct,
      safeForBrandUse: inspection.safeForBrandUse,
      allowedRoles: inspection.allowedRoles,
      inspectionWarnings: inspection.warnings,
      inspectionConfidence: inspection.confidence,
      inspectedAt: Date.now(),
    });
  },
});

export const markInspectionFailed = internalMutation({
  args: { imageId: v.id("images"), error: v.string() },
  handler: async (ctx, { imageId, error }) => {
    await ctx.db.patch(imageId, {
      inspectionStatus: "failed",
      inspectionWarnings: [error],
      inspectedAt: Date.now(),
    });
  },
});

export const saveProfile = internalMutation({
  args: {
    accountId: v.id("accounts"),
    referenceImageIds: v.array(v.id("images")),
    validationIssues: v.array(v.string()),
    textContrast: v.number(),
    accentContrast: v.number(),
    model: v.string(),
    promptVersion: v.string(),
    ...visualProfileArg,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const profileId = await ctx.db.insert("brandVisualProfiles", {
      accountId: args.accountId,
      status: "ready",
      name: args.name,
      rationale: args.rationale,
      palette: args.palette,
      typography: args.typography,
      artDirection: args.artDirection,
      motifs: args.motifs,
      photoTreatment: args.photoTreatment,
      avoid: args.avoid,
      referenceImageIds: args.referenceImageIds,
      validationIssues: args.validationIssues,
      textContrast: args.textContrast,
      accentContrast: args.accentContrast,
      model: args.model,
      promptVersion: args.promptVersion,
      createdAt: now,
      updatedAt: now,
    });
    return profileId;
  },
});

export const latestInternal = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: (ctx, { accountId }) =>
    ctx.db
      .query("brandVisualProfiles")
      .withIndex("by_account_updated", (q) => q.eq("accountId", accountId))
      .order("desc")
      .first(),
});

export const latest = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);
    return ctx.db
      .query("brandVisualProfiles")
      .withIndex("by_account_updated", (q) => q.eq("accountId", accountId))
      .order("desc")
      .first();
  },
});
