import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  beliefColumns,
  memoryNoteColumns,
  signalColumns,
  suggestionColumns,
  themeColumns,
} from "./pipeline/storage";
import {
  accountModes,
  imageOrigins,
  postStatuses,
  postTypes,
  scheduledStatuses,
} from "./pipeline/constants";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    clerkId: v.string(),
    imageUrl: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  }).index("by_clerk_id", ["clerkId"]),

  instagramConnections: defineTable({
    userId: v.id("users"),
    provider: v.literal("instagram_graph"),
    status: v.union(v.literal("connected"), v.literal("error"), v.literal("expired")),
    externalAccountId: v.string(),
    externalAccountName: v.optional(v.string()),
    handle: v.optional(v.string()),
    accountType: v.optional(v.string()),
    mediaCount: v.optional(v.number()),
    scopes: v.optional(v.array(v.string())),
    tokenCiphertext: v.optional(v.string()),
    tokenIv: v.optional(v.string()),
    tokenAuthTag: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    lastConnectedAt: v.number(),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_id", ["userId"])
    .index("by_external_account", ["provider", "externalAccountId"]),

  instagramPosts: defineTable({
    userId: v.id("users"),
    connectionId: v.id("instagramConnections"),
    externalPostId: v.string(),
    caption: v.optional(v.string()),
    mediaType: v.string(),
    mediaUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    permalink: v.string(),
    publishedAt: v.number(),
    likeCount: v.optional(v.number()),
    commentsCount: v.optional(v.number()),
    importedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_connection_external", ["connectionId", "externalPostId"])
    .index("by_user_published", ["userId", "publishedAt"]),

  // Observed signals (observe stage). The feed reads by_account_observedAt;
  // dedup looks up by_account_source_external; consolidate scans the pending
  // queue via by_account_consolidated (consolidatedAt unset).
  signals: defineTable(signalColumns)
    .index("by_account_observedAt", ["accountId", "observedAt"])
    .index("by_account_source_external", ["accountId", "source", "externalId"])
    .index("by_account_consolidated", ["accountId", "consolidatedAt"]),

  // ----- Memory model (persistence projection of pipeline/memory.ts) -----
  // Account-scoped tables for the discernment core. `accounts` is populated by
  // promoteConnection (observe.ts); beliefs/themes/memoryNotes are written by
  // consolidate. brandCanon / outcomes land with the stages that consume them.

  accounts: defineTable({
    connectionId: v.optional(v.id("instagramConnections")),
    mode: v.union(...accountModes.map((mode) => v.literal(mode))),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  beliefs: defineTable(beliefColumns).index("by_account_status", ["accountId", "status"]),

  themes: defineTable(themeColumns).index("by_account", ["accountId"]),

  policies: defineTable({
    accountId: v.id("accounts"),
    minConfidence: v.number(),
    minEvidence: v.number(),
    decayHalfLifeMs: v.number(),
    cadenceWindowMs: v.number(),
    learningRate: v.number(),
    contradictionFactor: v.number(),
    retireBelow: v.number(),
    decayingBelow: v.number(),
    momentumRisingRatio: v.number(),
    momentumFallingRatio: v.number(),
  }).index("by_account", ["accountId"]),

  // The consolidation journal: one reflection note per pass, newest-first by account.
  memoryNotes: defineTable(memoryNoteColumns).index("by_account", ["accountId"]),

  // Suggestions (plan stage): composed post ideas with control status + provenance.
  // Rejected candidates are kept (status "rejected" + rejectionReason) for inspectable autonomy.
  suggestions: defineTable(suggestionColumns)
    .index("by_account_status", ["accountId", "status"])
    .index("by_account_created", ["accountId", "createdAt"]),

  // ----- Phase 2 composable media + calendar -----
  // Images are atomic units; posts compose ordered image sets; scheduledPosts
  // pin a post to a datetime (the calendar) and carry the publish lifecycle.

  images: defineTable({
    accountId: v.id("accounts"),
    origin: v.union(...imageOrigins.map((origin) => v.literal(origin))),
    storageId: v.optional(v.id("_storage")),
    externalUrl: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    prompt: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_account", ["accountId"]),

  posts: defineTable({
    accountId: v.id("accounts"),
    type: v.union(...postTypes.map((type) => v.literal(type))),
    imageIds: v.array(v.id("images")),
    caption: v.string(),
    platform: v.string(),
    status: v.union(...postStatuses.map((status) => v.literal(status))),
    createdAt: v.number(),
  }).index("by_account", ["accountId"]),

  scheduledPosts: defineTable({
    accountId: v.id("accounts"),
    postId: v.id("posts"),
    scheduledFor: v.number(),
    status: v.union(...scheduledStatuses.map((status) => v.literal(status))),
    externalPostId: v.optional(v.string()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_account_scheduledFor", ["accountId", "scheduledFor"]),
});
