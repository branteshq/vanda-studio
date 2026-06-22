import { v } from "convex/values";
import {
  beliefKinds,
  beliefStatuses,
  momenta,
  postTypes,
  signalSources,
  suggestionStatuses,
} from "./constants";

/**
 * The Convex storage contract for `signals`, shared by the table definition
 * (`schema.ts`) and the insert mutation (`observe.ts`) so the durable shape
 * lives in exactly one place. A signal is a raw observation — `source` mirrors
 * the domain literal union. `consolidatedAt` is stamped once the consolidate
 * stage has folded the signal into memory; absent means still pending.
 */
export const signalColumns = {
  accountId: v.id("accounts"),
  source: v.union(...signalSources.map((source) => v.literal(source))),
  externalId: v.string(),
  text: v.string(),
  authorHandle: v.optional(v.string()),
  permalink: v.optional(v.string()),
  observedAt: v.number(),
  consolidatedAt: v.optional(v.number()),
};

/**
 * Storage contract for the memory model (persistence projection of
 * `pipeline/memory.ts`), shared by the `schema.ts` tables and the
 * `applyConsolidation` mutation args. The literal unions come from `constants`,
 * the single source of truth shared with the Effect schemas.
 *
 * `supportingSignalIds` holds real signal ids (signals are account-scoped since
 * Phase 3). It can grow unbounded for a long-lived belief; bounding it (window
 * or join table) waits until plan's access pattern shows whether the full set
 * or just a recent window + count is needed.
 */
export const beliefColumns = {
  accountId: v.id("accounts"),
  statement: v.string(),
  kind: v.union(...beliefKinds.map((kind) => v.literal(kind))),
  confidence: v.number(),
  supportingSignalIds: v.array(v.string()),
  firstSeenAt: v.number(),
  confidenceAsOf: v.number(),
  status: v.union(...beliefStatuses.map((status) => v.literal(status))),
};

export const themeColumns = {
  accountId: v.id("accounts"),
  name: v.string(),
  summary: v.string(),
  momentum: v.union(...momenta.map((m) => v.literal(m))),
  lastPostedAt: v.optional(v.number()),
  postCount: v.number(),
  signalCount: v.number(),
};

/** The consolidation journal — "what Vanda is thinking" — one row per pass. */
export const memoryNoteColumns = {
  accountId: v.id("accounts"),
  note: v.string(),
  signalCount: v.number(),
  createdAt: v.number(),
};

/**
 * Storage contract for `suggestions` — the output of plan. Accepted ideas carry
 * a control status + reasoning + provenance (the beliefs/signals behind them);
 * rejected candidates are persisted with status "rejected" + `rejectionReason`.
 */
export const suggestionColumns = {
  accountId: v.id("accounts"),
  title: v.string(),
  rationale: v.string(),
  format: v.optional(v.union(...postTypes.map((t) => v.literal(t)))),
  themeName: v.string(),
  beliefStatements: v.array(v.string()),
  signalIds: v.array(v.string()),
  status: v.union(...suggestionStatuses.map((s) => v.literal(s))),
  requiresApproval: v.boolean(),
  rejectionReason: v.optional(v.string()),
  createdAt: v.number(),
};
