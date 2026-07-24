import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  beliefColumns,
  brandCanonColumns,
  memoryNoteColumns,
  signalColumns,
  suggestionColumns,
  themeColumns,
} from "./pipeline/storage";
import {
  accountModes,
  brandKinds,
  imageOrigins,
  imagePurposes,
  knowledgeKinds,
  marketCreatorStatuses,
  marketRunKinds,
  marketRunStatuses,
  metricSubjectTypes,
  modelStages,
  opportunityStatuses,
  opportunityTriggers,
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
    activeAccountId: v.optional(v.id("accounts")),
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
  // consolidate; brandCanon by onboarding's approve. outcomes land with the
  // stage that consumes them.

  accounts: defineTable({
    // The human who owns this business (set on promote from a connection). `orgId`
    // is a reserved slot for if/when Clerk Organizations bring team access — nothing
    // reads it today; ownership is the direct user link.
    ownerUserId: v.optional(v.id("users")),
    orgId: v.optional(v.string()),
    // Display name override; defaults to the connected IG account name when unset.
    name: v.optional(v.string()),
    connectionId: v.optional(v.id("instagramConnections")),
    mode: v.union(...accountModes.map((mode) => v.literal(mode))),
    // Set by approveBrandProfile when the owner confirms the brand profile — the
    // onboarding gate. Unset means connected-but-not-yet-onboarded.
    onboardedAt: v.optional(v.number()),
    // Brand type Vanda proposed and the owner confirmed at onboarding (negocio | pessoal).
    kind: v.optional(v.union(...brandKinds.map((k) => v.literal(k)))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerUserId"])
    .index("by_connection", ["connectionId"]),

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

  // Brand canon (output of onboarding's approve): the owner-confirmed stable
  // identity — one editable row per fact. Confirmed canon grounds create's RAG
  // corpus (create.brandCorpus); the "what Vanda knows" panel reads it too.
  brandCanon: defineTable(brandCanonColumns).index("by_account", ["accountId"]),

  knowledgeChunks: defineTable({
    accountId: v.id("accounts"),
    kind: v.union(...knowledgeKinds.map((kind) => v.literal(kind))),
    sourceId: v.string(),
    text: v.string(),
    embedding: v.array(v.float64()),
    active: v.boolean(),
    observedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_account_source", ["accountId", "sourceId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["accountId", "active"],
    }),

  modelRuns: defineTable({
    accountId: v.id("accounts"),
    stage: v.union(...modelStages.map((stage) => v.literal(stage))),
    model: v.string(),
    promptVersion: v.string(),
    inputIds: v.array(v.string()),
    status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed")),
    outputSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_account_started", ["accountId", "startedAt"]),

  // Suggestions (plan stage): composed post ideas with control status + provenance.
  // Rejected candidates are kept (status "rejected" + rejectionReason) for inspectable autonomy.
  suggestions: defineTable(suggestionColumns)
    .index("by_account_status", ["accountId", "status"])
    .index("by_account_created", ["accountId", "createdAt"]),

  // ----- Market radar: discover → measure → detect → adapt ----------------

  marketCreators: defineTable({
    accountId: v.id("accounts"),
    externalId: v.optional(v.string()),
    handle: v.string(),
    displayName: v.optional(v.string()),
    profileUrl: v.string(),
    biography: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
    followers: v.optional(v.number()),
    following: v.optional(v.number()),
    postsCount: v.optional(v.number()),
    businessCategory: v.optional(v.string()),
    private: v.boolean(),
    verified: v.boolean(),
    relevanceScore: v.number(),
    relevanceReason: v.string(),
    status: v.union(...marketCreatorStatuses.map((status) => v.literal(status))),
    discoveredAt: v.number(),
    lastObservedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_handle", ["accountId", "handle"]),

  marketPosts: defineTable({
    accountId: v.id("accounts"),
    creatorId: v.id("marketCreators"),
    externalPostId: v.string(),
    shortCode: v.optional(v.string()),
    permalink: v.string(),
    caption: v.optional(v.string()),
    mediaType: v.string(),
    productType: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    publishedAt: v.number(),
    firstObservedAt: v.number(),
    lastObservedAt: v.number(),
  })
    .index("by_creator_external", ["creatorId", "externalPostId"])
    .index("by_account_published", ["accountId", "publishedAt"]),

  metricSnapshots: defineTable({
    accountId: v.id("accounts"),
    subjectType: v.union(...metricSubjectTypes.map((type) => v.literal(type))),
    marketPostId: v.optional(v.id("marketPosts")),
    scheduledPostId: v.optional(v.id("scheduledPosts")),
    observedAt: v.number(),
    followers: v.optional(v.number()),
    views: v.optional(v.number()),
    plays: v.optional(v.number()),
    likes: v.optional(v.number()),
    comments: v.optional(v.number()),
    shares: v.optional(v.number()),
  })
    .index("by_account", ["accountId"])
    .index("by_market_post_observed", ["marketPostId", "observedAt"])
    .index("by_publication_observed", ["scheduledPostId", "observedAt"]),

  opportunities: defineTable({
    accountId: v.id("accounts"),
    marketPostId: v.id("marketPosts"),
    status: v.union(...opportunityStatuses.map((status) => v.literal(status))),
    score: v.number(),
    triggerType: v.union(...opportunityTriggers.map((trigger) => v.literal(trigger))),
    triggerReason: v.string(),
    triggeredAt: v.number(),
    sourceTranscript: v.optional(v.string()),
    coreIdea: v.optional(v.string()),
    hook: v.optional(v.string()),
    structure: v.optional(v.string()),
    pacing: v.optional(v.string()),
    visualConcept: v.optional(v.string()),
    whyItWorks: v.optional(v.string()),
    creatorSpecificElements: v.optional(v.array(v.string())),
    adaptedHook: v.optional(v.string()),
    adaptedSlides: v.optional(v.array(v.string())),
    adaptedCaption: v.optional(v.string()),
    transformationNotes: v.optional(v.string()),
    postId: v.optional(v.id("posts")),
    scheduledPostId: v.optional(v.id("scheduledPosts")),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_status", ["accountId", "status"])
    .index("by_market_post", ["marketPostId"]),

  marketRuns: defineTable({
    accountId: v.id("accounts"),
    kind: v.union(...marketRunKinds.map((kind) => v.literal(kind))),
    status: v.union(...marketRunStatuses.map((status) => v.literal(status))),
    stage: v.string(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    category: v.optional(v.string()),
    location: v.optional(v.string()),
    language: v.optional(v.string()),
    searchQueries: v.optional(v.array(v.string())),
    creatorsFound: v.number(),
    creatorsSelected: v.number(),
    postsObserved: v.number(),
    snapshotsRecorded: v.number(),
    opportunitiesDetected: v.number(),
    adaptationsCreated: v.number(),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_account_started", ["accountId", "startedAt"]),

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
    // "reference" = an owner-uploaded brand reference photo (personal brands); absent
    // means post-bound media written by create.
    purpose: v.optional(v.union(...imagePurposes.map((p) => v.literal(p)))),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_storage", ["storageId"]),

  posts: defineTable({
    accountId: v.id("accounts"),
    type: v.union(...postTypes.map((type) => v.literal(type))),
    imageIds: v.array(v.id("images")),
    caption: v.string(),
    platform: v.string(),
    status: v.union(...postStatuses.map((status) => v.literal(status))),
    // Provenance: the suggestion this post was composed from (created by the
    // create stage; absent for manually uploaded / gallery-built posts).
    suggestionId: v.optional(v.id("suggestions")),
    opportunityId: v.optional(v.id("opportunities")),
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
