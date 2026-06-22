import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { signalColumns } from "./pipeline/storage";
import { accountModes, beliefKinds, beliefStatuses, momenta } from "./pipeline/constants";

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

  // Phase 0 pipeline spike: observed signals produced by the `observe` stage.
  signals: defineTable(signalColumns).index("by_account_external", [
    "accountExternalId",
    "externalId",
  ]),

  // ----- Phase 1 memory model (persistence projection of pipeline/memory.ts) -----
  // Account-scoped tables for the discernment core. `accounts` is populated when a
  // connection is promoted (Phase 3); until then these are declared but empty, and
  // `signals` keeps its Phase 0 `accountExternalId`. brandCanon / outcomes /
  // memoryNotes land with the stages that consume them, where their shapes can be
  // designed against real usage.

  accounts: defineTable({
    connectionId: v.optional(v.id("instagramConnections")),
    mode: v.union(...accountModes.map((mode) => v.literal(mode))),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  beliefs: defineTable({
    accountId: v.id("accounts"),
    statement: v.string(),
    kind: v.union(...beliefKinds.map((kind) => v.literal(kind))),
    confidence: v.number(),
    // The deduplicated evidence set. A long-lived, high-volume belief grows this
    // unbounded; Phase 4 (consolidate) revisits with a bounded window or join
    // table, and the ids become `v.id("signals")` once signals are account-scoped.
    supportingSignalIds: v.array(v.string()),
    firstSeenAt: v.number(),
    lastReinforcedAt: v.number(),
    status: v.union(...beliefStatuses.map((status) => v.literal(status))),
  }).index("by_account_status", ["accountId", "status"]),

  themes: defineTable({
    accountId: v.id("accounts"),
    name: v.string(),
    summary: v.string(),
    momentum: v.union(...momenta.map((m) => v.literal(m))),
    lastPostedAt: v.optional(v.number()),
    postCount: v.number(),
    signalCount: v.number(),
  }).index("by_account", ["accountId"]),

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
});
