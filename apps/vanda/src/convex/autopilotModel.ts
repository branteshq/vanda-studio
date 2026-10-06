import { v, type Infer } from "convex/values";
import { postPurposeValidator } from "./postPurposes";

/**
 * Autopilot: the agent-planned weekly feed cadence that keeps an account
 * posting outside the manual chat → draft → schedule flow. Pure values and
 * validators shared by the schema, the pipeline and the UI.
 */

/** Feed formats the autopilot produces; reels and stories are out of scope. */
export const autopilotPostTypes = ["image", "carousel"] as const;

export type AutopilotPostType = (typeof autopilotPostTypes)[number];

/** 0 = Sunday … 6 = Saturday, as Date#getDay. */

export const weekdayNames = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
] as const;

export const weekdayShortNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

export const cadenceSources = ["agent", "owner"] as const;

export const autopilotSlotStatuses = [
  "planned",
  "generating",
  // Produced; the owner approves (→ scheduled) or rejects with a reason (→ planned again).
  "awaiting_approval",
  "scheduled",
  "published",
  "skipped",
  "failed",
] as const;

export type AutopilotSlotStatus = (typeof autopilotSlotStatuses)[number];

/** Why a slot was set aside when the owner paused posts automáticos (restored on resume). */
export const PAUSED_REASON = "posts automáticos pausados";

/** A slot set aside by a pause, as opposed to one the owner skipped. */
export const isPausedSlot = (slot: {
  status: AutopilotSlotStatus;
  lastError?: string | undefined;
}) => slot.status === "skipped" && slot.lastError === PAUSED_REASON;

export const autopilotWeekStatuses = ["planning", "planned", "failed"] as const;

export const auditStatuses = ["running", "ready", "failed"] as const;

export const auditConfidences = ["baixa", "media", "alta"] as const;

export const postOrigins = ["manual", "autopilot"] as const;

/** "required": nothing publishes without the owner's approval. "auto": publishes unless vetoed. */
export const approvalModes = ["required", "auto"] as const;

export type ApprovalMode = (typeof approvalModes)[number];

export const feedbackDecisions = ["approved", "rejected"] as const;

/** Where a rejection reason applies: every future post ("geral") or only that post. */
export const feedbackScopes = ["geral", "post"] as const;

export type FeedbackScope = (typeof feedbackScopes)[number];

/**
 * Work Caetano does for the posts automáticos, queued in his own thread like any
 * owner message: the account diagnosis, a week's plan, or one post.
 */
export const autopilotJobKinds = ["audit", "plan", "post"] as const;

export const autopilotJobValidator = v.object({
  kind: v.union(...autopilotJobKinds.map((kind) => v.literal(kind))),
  accountId: v.id("accounts"),
  weekStart: v.optional(v.number()),
  slotId: v.optional(v.id("autopilotSlots")),
});

export type AutopilotJob = Infer<typeof autopilotJobValidator>;

export const MIN_REJECTION_REASON = 8;

export const MAX_WEEKLY_POSTS = 7;

export const MAX_AUTOPILOT_SLIDES = 10;

/** Slots are produced this long before they publish (just-in-time). */
export const PRODUCE_AHEAD_MS = 24 * 60 * 60 * 1000;

/** How far back the approval rate looks. */
export const FEEDBACK_WINDOW_DAYS = 30;

/** The same window in words, for copy shown to the owner and the agents. */
export const PRODUCE_AHEAD_LABEL = `${PRODUCE_AHEAD_MS / 3_600_000} horas`;

export const cadenceEntryValidator = v.object({
  weekday: v.number(),
  /** "HH:mm", America/Sao_Paulo. */
  time: v.string(),
  type: v.union(...autopilotPostTypes.map((type) => v.literal(type))),
  slideCount: v.number(),
});

export type CadenceEntry = Infer<typeof cadenceEntryValidator>;

export const autopilotSlotStatusValidator = v.union(
  ...autopilotSlotStatuses.map((status) => v.literal(status)),
);

export const cadenceSourceValidator = v.union(...cadenceSources.map((s) => v.literal(s)));

export const postOriginValidator = v.union(...postOrigins.map((origin) => v.literal(origin)));

/** The editable creative brief of one slot (what the agent plans, the owner can change). */
export const slotBriefFields = {
  purpose: postPurposeValidator,
  theme: v.string(),
  angle: v.string(),
  hook: v.string(),
  slideOutline: v.array(v.string()),
  captionBrief: v.string(),
};

export const slotResultsValidator = v.object({
  observedAt: v.number(),
  reach: v.optional(v.number()),
  likes: v.optional(v.number()),
  comments: v.optional(v.number()),
  saves: v.optional(v.number()),
  shares: v.optional(v.number()),
  follows: v.optional(v.number()),
  /** reach ÷ the account's median reach at observation time. */
  outlier: v.optional(v.number()),
});

export const auditMetricsValidator = v.object({
  sampleSize: v.number(),
  windowStart: v.optional(v.number()),
  windowEnd: v.optional(v.number()),
  followers: v.optional(v.number()),
  medianReach: v.optional(v.number()),
  savesPerReach: v.optional(v.number()),
  sharesPerReach: v.optional(v.number()),
  followsPerReach: v.optional(v.number()),
  postsPerWeek: v.optional(v.number()),
  daysSinceLastPost: v.optional(v.number()),
  /** Format/hour buckets with mean outlier multiple and n. */
  byFormat: v.array(v.object({ key: v.string(), n: v.number(), meanOutlier: v.number() })),
  byHour: v.array(v.object({ key: v.string(), n: v.number(), meanOutlier: v.number() })),
});

export type AuditMetrics = Infer<typeof auditMetricsValidator>;

export const auditPostRefValidator = v.object({
  externalPostId: v.string(),
  url: v.optional(v.string()),
  caption: v.string(),
  format: v.string(),
  publishedAt: v.optional(v.number()),
  reach: v.optional(v.number()),
  outlier: v.optional(v.number()),
  why: v.optional(v.string()),
});

export const auditFindingValidator = v.object({
  claim: v.string(),
  evidence: v.string(),
  n: v.optional(v.number()),
});

export const rubricItemValidator = v.object({
  item: v.string(),
  score: v.number(),
  max: v.number(),
  fix: v.optional(v.string()),
  // False when the reading could not see it (bio, highlights…): shown apart, never scored.
  observed: v.optional(v.boolean()),
});
