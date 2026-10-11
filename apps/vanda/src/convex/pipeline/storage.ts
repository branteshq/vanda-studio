import { v } from "convex/values";
import { brandCanonKinds, brandKinds } from "./constants";

/**
 * Storage contract for the legacy `brandCanon` table: the facts of accounts
 * onboarded before the brand file. Nothing writes it anymore; `brandFile` reads
 * it once to seed those accounts' /brand/marca.md.
 */

/** The brand type onboarding proposes: a place or product (negocio), or a person (pessoal). */
export const brandKindValidator = v.union(...brandKinds.map((kind) => v.literal(kind)));

export const brandCanonColumns = {
  accountId: v.id("accounts"),
  kind: v.union(...brandCanonKinds.map((kind) => v.literal(kind))),
  text: v.string(),
  evidence: v.optional(v.string()),
  confidence: v.optional(v.number()),
  confirmedByOwner: v.boolean(),
  createdAt: v.number(),
};

/** One brand file item as onboarding writes it (`BrandFact`). */
export const brandFactArg = v.object({
  kind: brandCanonColumns.kind,
  text: v.string(),
  origin: v.optional(v.string()),
});
