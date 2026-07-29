import { v } from "convex/values";
import { brandCanonKinds, brandKinds } from "./constants";

/**
 * Storage contract for `brandCanon` — the owner-confirmed brand identity that
 * `approveBrandProfile` writes at the end of onboarding. One row per fact (each
 * voice adjective / character / restriction is its own editable row), so the
 * owner can later correct memory piecemeal. `confidence`/`evidence` are the
 * model's pre-confirmation detection provenance, kept for the "what Vanda knows"
 * panel; `confirmedByOwner` is true for every approve-written row.
 */
export const brandCanonColumns = {
  accountId: v.id("accounts"),
  kind: v.union(...brandCanonKinds.map((kind) => v.literal(kind))),
  text: v.string(),
  evidence: v.optional(v.string()),
  confidence: v.optional(v.number()),
  confirmedByOwner: v.boolean(),
  createdAt: v.number(),
};

/**
 * Wire shape of one analysis card with a single confidence/evidence:
 * `text` for identity/summary, `items` for the multi-value groups (voice,
 * themes, characters, restrictions, opportunities). Mirrors `pipeline/brand.ts`
 * (BrandText / BrandGroup) for the `approveBrandProfile` mutation args.
 */
const brandTextArg = v.object({
  text: v.string(),
  evidence: v.string(),
  confidence: v.number(),
});
const brandGroupArg = v.object({
  items: v.array(v.string()),
  evidence: v.string(),
  confidence: v.number(),
});

const brandKindArg = v.object({
  value: v.union(...brandKinds.map((k) => v.literal(k))),
  evidence: v.string(),
  confidence: v.number(),
});

/** The edited brand analysis the owner approves — the `approveBrandProfile` args. */
export const brandAnalysisArgs = {
  identity: brandTextArg,
  summary: brandTextArg,
  kind: brandKindArg,
  voice: brandGroupArg,
  themes: brandGroupArg,
  characters: brandGroupArg,
  restrictions: brandGroupArg,
  opportunities: brandGroupArg,
};
