// Single source of truth for the closed literal sets shared between the Effect
// domain schemas (via `Schema.Literals`) and the Convex persistence validators
// (schema.ts, via `v.union(v.literal(...))`).

export const accountModes = ["auto", "needs_approval", "manual"] as const;

// Brand canon — the owner-confirmed stable identity (output of onboarding's
// approve). `identity`/`summary` are single rows; `voice`/`character`/`restriction`
// are multi.
export const brandCanonKinds = [
  "identity",
  "positioning",
  "audience",
  "offer",
  "differentiator",
  "proof",
  "voice",
  "character",
  "objective",
  "location",
  "restriction",
  "forbidden_claim",
  "summary",
] as const;

// Brand type Vanda proposes at onboarding: a place/product vs a person who IS the brand.
export const brandKinds = ["negocio", "pessoal"] as const;

// Image role: brand reference photos (owner uploads) vs post-bound media (create output).
export const imagePurposes = ["reference", "post"] as const;

export const imageOrigins = ["generated", "uploaded", "gallery"] as const;
export const postTypes = ["feed", "reel", "story", "tweet", "image"] as const;
export const postStatuses = ["draft", "ready", "scheduled", "published"] as const;
export const contentProjectStatuses = [
  "planning",
  "draft",
  "blocked",
  "ready_for_render",
  "rendering",
  "ready",
  "scheduled",
  "published",
  "failed",
  "archived",
] as const;
export const carouselDocumentStatuses = ["draft", "blocked", "ready_for_render"] as const;
export const documentReviewStatuses = ["pending", "approved", "rejected"] as const;
export const contentAssetRequestStatuses = [
  "planned",
  "generating",
  "ready",
  "blocked",
  "failed",
] as const;
export const carouselRenderStatuses = [
  "queued",
  "rendering",
  "succeeded",
  "failed",
  "canceled",
] as const;
export const scheduledStatuses = ["scheduled", "publishing", "published", "failed"] as const;
export const modelStages = [
  "brand_profile",
  "consolidate",
  "plan",
  "create",
  "embedding",
  "market_discovery",
  "market_source",
  "market_mechanism",
  "market_directions",
  "market_selection",
  "market_brief_review",
  "studio_visual_brand",
  "studio_asset_inspection",
  "studio_carousel_plan",
  "studio_carousel_review",
  "studio_slide_regeneration",
  "studio_asset_generation",
  "studio_render",
  "market_adapt",
] as const;

export const marketCreatorStatuses = ["active", "paused", "rejected", "unavailable"] as const;
export const marketCreatorFeedback = ["relevant", "irrelevant", "blocked"] as const;
export const sourceDossierStatuses = ["collecting", "ready", "rejected", "failed"] as const;
export const sourceContentTypes = ["spoken", "text_led", "visual", "mixed", "unknown"] as const;
export const inputAssessmentDecisions = ["qualified", "rejected"] as const;
export const inputAssessmentStages = ["preflight", "final"] as const;
export const inputRejectionCodes = [
  "brand_incomplete",
  "creator_irrelevant",
  "creator_blocked",
  "source_too_old",
  "invalid_published_at",
  "missing_views",
  "missing_followers",
  "weak_breakout",
  "missing_media",
  "unusable_transcript",
  "insufficient_visual_context",
  "unsupported_language",
  "provider_data_inconsistent",
  "duplicate_opportunity",
] as const;
export const marketRunKinds = ["discovery", "observation", "full_loop"] as const;
export const marketRunStatuses = ["running", "succeeded", "failed"] as const;
export const metricSubjectTypes = ["source_post", "publication"] as const;
export const opportunityStatuses = [
  "detected",
  "qualifying",
  "ready_for_analysis",
  "rejected",
  "analyzing",
  "directing",
  "selecting_direction",
  "reviewing_brief",
  "ready_for_production",
  "adapting",
  "awaiting_approval",
  "publishing",
  "published",
  "measuring",
  "dismissed",
  "failed",
] as const;
export const opportunityTriggers = ["absolute_threshold", "audience_ratio", "velocity"] as const;
