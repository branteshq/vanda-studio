// Single source of truth for the closed literal sets shared between the Effect
// domain schemas (pipeline/memory.ts, via `Schema.Literals`) and the Convex
// persistence validators (schema.ts, via `v.union(v.literal(...))`).

export const beliefKinds = ["audience", "product", "competitor", "sentiment", "trend"] as const;
export const beliefStatuses = ["active", "decaying", "retired"] as const;
export const momenta = ["rising", "steady", "falling"] as const;
export const accountModes = ["auto", "needs_approval", "manual"] as const;

// Brand canon — the owner-confirmed stable identity (output of onboarding's
// approve). `identity`/`summary` are single rows; `voice`/`character`/`restriction`
// are multi. Themes and opportunities shown at onboarding are NOT canon: on
// approve they materialize into `themes` / `suggestions`, never brandCanon.
export const brandCanonKinds = [
  "identity",
  "voice",
  "character",
  "restriction",
  "summary",
] as const;

// Brand type Vanda proposes at onboarding: a place/product vs a person who IS the brand.
export const brandKinds = ["negocio", "pessoal"] as const;

// Image role: brand reference photos (owner uploads) vs post-bound media (create output).
export const imagePurposes = ["reference", "post"] as const;

export const imageOrigins = ["generated", "uploaded", "gallery"] as const;
export const postTypes = ["feed", "reel", "story", "tweet", "image"] as const;
export const postStatuses = ["draft", "ready", "scheduled", "published"] as const;
export const scheduledStatuses = ["scheduled", "publishing", "published", "failed"] as const;
export const signalSources = ["comments", "mentions", "competitors", "trends", "posts"] as const;
export const signalSyncKinds = ["backfill", "reconciliation", "webhook"] as const;
export const knowledgeKinds = ["canon", "belief", "caption", "post", "feedback"] as const;
export const modelStages = [
  "brand_profile",
  "consolidate",
  "plan",
  "create",
  "embedding",
  "market_discovery",
  "market_adapt",
] as const;

export const marketCreatorStatuses = ["active", "paused", "rejected", "unavailable"] as const;
export const marketRunKinds = ["discovery", "observation", "full_loop"] as const;
export const marketRunStatuses = ["running", "succeeded", "failed"] as const;
export const metricSubjectTypes = ["source_post", "publication"] as const;
export const opportunityStatuses = [
  "detected",
  "analyzing",
  "adapting",
  "awaiting_approval",
  "publishing",
  "published",
  "measuring",
  "dismissed",
  "failed",
] as const;
export const opportunityTriggers = ["absolute_threshold", "audience_ratio", "velocity"] as const;
export const suggestionStatuses = [
  "suggestion",
  "needs_you",
  "approved",
  "creating",
  "scheduled",
  "dismissed",
  "rejected",
] as const;
