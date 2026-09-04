import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { threadResourceValidator } from "./resourceRefs";
import { brandCanonColumns } from "./pipeline/storage";
import {
  brandKinds,
  imageOrigins,
  imagePurposes,
  inputAssessmentDecisions,
  inputAssessmentStages,
  inputRejectionCodes,
  marketCreatorFeedback,
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
  sourceContentTypes,
  sourceDossierStatuses,
} from "./pipeline/constants";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.string(),
    clerkId: v.string(),
    imageUrl: v.optional(v.string()),
    activeAccountId: v.optional(v.id("accounts")),
    // Billing snapshot cached from Autumn so usage enforcement never leaves
    // Convex: the active plan, its usage allowance, and the current period.
    // Absent = trial (a one-time allowance, no period reset).
    planId: v.optional(v.string()),
    usageAllowanceMicroUsd: v.optional(v.number()),
    billingPeriodStart: v.optional(v.number()),
    billingPeriodEnd: v.optional(v.number()),
    billingSyncedAt: v.optional(v.number()),
    // A plan change Autumn deferred to the next renewal (downgrades).
    scheduledPlanId: v.optional(v.string()),
    // Which model thinks as Vanda (an id from agentModels.ORCHESTRATOR_MODELS).
    // Absent = the catalog default; unknown ids resolve to it too, so retiring
    // a model never wedges a conversation.
    orchestratorModel: v.optional(v.string()),
    // Which model paints by default (an id from imageModels.IMAGE_MODELS).
    // Same resolution rules; overridden entirely by the Conectado plan, which
    // runs every paint on the owner's ChatGPT subscription.
    imageModel: v.optional(v.string()),
    // One canonical user-level conversation with Caetano, shared by every
    // present and future client (web first, WhatsApp later).
    caetanoThreadId: v.optional(v.string()),
    // BYO OpenAI subscription (plano Conectado): ChatGPT OAuth tokens,
    // AES-256-GCM encrypted like the Instagram connection tokens.
    openaiAccountId: v.optional(v.string()),
    openaiAccessCiphertext: v.optional(v.string()),
    openaiAccessIv: v.optional(v.string()),
    openaiAccessAuthTag: v.optional(v.string()),
    openaiRefreshCiphertext: v.optional(v.string()),
    openaiRefreshIv: v.optional(v.string()),
    openaiRefreshAuthTag: v.optional(v.string()),
    openaiTokenExpiresAt: v.optional(v.number()),
    openaiConnectedAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  }).index("by_clerk_id", ["clerkId"]),

  // ----- Usage metering: every real-money cost lands here -----------------
  // The audit trail: one row per charge (paint, run_code, chat, pipeline,
  // scan, title). userId is the enforcement key (subscriptions are per user,
  // pooled across businesses); accountId attributes the spend to a business.
  usageEvents: defineTable({
    userId: v.id("users"),
    accountId: v.optional(v.id("accounts")),
    kind: v.string(),
    microUsd: v.number(),
    ref: v.optional(v.string()),
    periodKey: v.string(),
    createdAt: v.number(),
  }).index("by_user_period", ["userId", "periodKey"]),

  // O(1) balance checks: one counter row per user per billing period.
  usagePeriods: defineTable({
    userId: v.id("users"),
    periodKey: v.string(),
    spentMicroUsd: v.number(),
    updatedAt: v.number(),
  }).index("by_user_period", ["userId", "periodKey"]),

  // `accounts` is created by publisherConnect.startConnect; brandCanon by
  // onboarding's approve. Instagram is reached through the publisher port
  // (Upload-Post) — the customer's tokens never touch our database.

  accounts: defineTable({
    // The human who owns this business. `orgId` is a reserved slot for if/when
    // Clerk Organizations bring team access — nothing reads it today;
    // ownership is the direct user link.
    ownerUserId: v.optional(v.id("users")),
    orgId: v.optional(v.string()),
    // Display name override; defaults to the connected IG handle when unset.
    name: v.optional(v.string()),
    // The connected Instagram @username, synced from the publisher profile.
    handle: v.optional(v.string()),
    // Set when the publisher profile reports a live Instagram connection.
    publisherConnectedAt: v.optional(v.number()),
    // Set by approveBrandProfile when the owner confirms the brand profile — the
    // onboarding gate. Unset means connected-but-not-yet-onboarded.
    onboardedAt: v.optional(v.number()),
    // Brand type Vanda proposed and the owner confirmed at onboarding (negocio | pessoal).
    kind: v.optional(v.union(...brandKinds.map((k) => v.literal(k)))),
    // DEPRECATED (pre-multi-thread): the once-canonical conversation pointer.
    // Threads are now keyed in the agent component by String(accountId); this
    // field remains only for the one-time chat:migrateThreadKeys backfill.
    vandaThreadId: v.optional(v.string()),
    // The default account-scoped Vanda thread Caetano continues. Manual Vanda
    // conversations remain independent in the agent component.
    caetanoVandaThreadId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerUserId"]),

  // Ephemeral rows marking agent turns currently running. One thread can have
  // multiple rows if turns overlap; the row is deleted when its action settles.
  chatThreadActivity: defineTable({
    accountId: v.id("accounts"),
    threadId: v.string(),
    promptMessageId: v.string(),
    startedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_thread", ["threadId"]),

  caetanoThreadActivity: defineTable({
    userId: v.id("users"),
    threadId: v.string(),
    promptMessageId: v.string(),
    activeVandaThreadId: v.optional(v.string()),
    startedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Typed resources touched or presented by one tool call. The agent component
  // owns prose and tool history; this table is the durable domain-resource
  // manifest that web and delegated agents can consume without parsing prose.
  threadResourceManifests: defineTable({
    threadId: v.string(),
    anchorMessageId: v.string(),
    toolCallId: v.string(),
    resources: v.array(threadResourceValidator),
    presented: v.array(threadResourceValidator),
    createdAt: v.number(),
  })
    .index("by_thread_created", ["threadId", "createdAt"])
    .index("by_thread_tool", ["threadId", "toolCallId"]),

  // Brand canon (output of onboarding's approve): the owner-confirmed stable
  // identity — one editable row per fact. This is the durable brand memory the
  // agent's context is assembled from; the "what Vanda knows" panel reads it too.
  brandCanon: defineTable(brandCanonColumns).index("by_account", ["accountId"]),

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
    topicalOverlap: v.optional(v.number()),
    audienceOverlap: v.optional(v.number()),
    offerOverlap: v.optional(v.number()),
    geographicOverlap: v.optional(v.number()),
    languageMatch: v.optional(v.number()),
    contentActivity: v.optional(v.number()),
    relevanceConfidence: v.optional(v.number()),
    relevanceVetoes: v.optional(v.array(v.string())),
    feedback: v.optional(v.union(...marketCreatorFeedback.map((value) => v.literal(value)))),
    feedbackReason: v.optional(v.string()),
    feedbackAt: v.optional(v.number()),
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

  brandVisualProfiles: defineTable({
    accountId: v.id("accounts"),
    status: v.union(v.literal("ready"), v.literal("failed")),
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
    referenceImageIds: v.array(v.id("images")),
    validationIssues: v.array(v.string()),
    textContrast: v.number(),
    accentContrast: v.number(),
    model: v.string(),
    promptVersion: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_updated", ["accountId", "updatedAt"])
    .index("by_account_status", ["accountId", "status"]),

  brandSnapshots: defineTable({
    accountId: v.id("accounts"),
    context: v.string(),
    canonIds: v.array(v.id("brandCanon")),
    hash: v.string(),
    readinessScore: v.number(),
    missingRequired: v.array(v.string()),
    missingRecommended: v.array(v.string()),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_hash", ["accountId", "hash"]),

  sourceDossiers: defineTable({
    accountId: v.id("accounts"),
    marketPostId: v.id("marketPosts"),
    status: v.union(...sourceDossierStatuses.map((status) => v.literal(status))),
    provider: v.optional(v.string()),
    providerFetchedAt: v.optional(v.number()),
    caption: v.optional(v.string()),
    transcript: v.optional(v.string()),
    transcriptLanguage: v.optional(v.string()),
    transcriptConfidence: v.optional(v.number()),
    videoStorageId: v.optional(v.id("_storage")),
    thumbnailStorageId: v.optional(v.id("_storage")),
    frameStorageIds: v.array(v.id("_storage")),
    frameEvidence: v.optional(
      v.array(
        v.object({
          timestampMs: v.number(),
          description: v.string(),
          onScreenText: v.optional(v.string()),
        }),
      ),
    ),
    visualDescription: v.optional(v.string()),
    visualConfidence: v.optional(v.number()),
    contentType: v.optional(v.union(...sourceContentTypes.map((type) => v.literal(type)))),
    hasUsableVideo: v.boolean(),
    hasUsableTranscript: v.boolean(),
    hasUsableCaption: v.boolean(),
    hasUsableVisualEvidence: v.boolean(),
    qualityScore: v.number(),
    rejectionCodes: v.array(v.union(...inputRejectionCodes.map((code) => v.literal(code)))),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_market_post", ["marketPostId"]),

  creativeAnalyses: defineTable({
    accountId: v.id("accounts"),
    opportunityId: v.id("opportunities"),
    dossierId: v.id("sourceDossiers"),
    status: v.union(v.literal("accepted"), v.literal("rejected")),
    sourceSummary: v.string(),
    hook: v.object({ type: v.string(), mechanism: v.string(), evidence: v.string() }),
    tension: v.string(),
    audiencePromise: v.string(),
    narrativeBeats: v.array(v.object({ role: v.string(), description: v.string() })),
    proof: v.string(),
    payoff: v.string(),
    callToAction: v.string(),
    pacing: v.object({
      tempo: v.string(),
      progression: v.string(),
      patternInterrupts: v.array(v.string()),
    }),
    visualGrammar: v.object({
      composition: v.string(),
      motion: v.string(),
      textTreatment: v.string(),
      recurringDevices: v.array(v.string()),
    }),
    reusableMechanisms: v.array(v.string()),
    creatorSpecificElements: v.array(v.string()),
    performanceHypotheses: v.array(
      v.object({
        hypothesis: v.string(),
        evidence: v.array(v.string()),
        confidence: v.number(),
      }),
    ),
    uncertainties: v.array(v.string()),
    adaptable: v.boolean(),
    rejectionReason: v.string(),
    confidence: v.number(),
    model: v.string(),
    promptVersion: v.string(),
    createdAt: v.number(),
  })
    .index("by_opportunity", ["opportunityId"])
    .index("by_account_created", ["accountId", "createdAt"]),

  creativeDirections: defineTable({
    accountId: v.id("accounts"),
    opportunityId: v.id("opportunities"),
    analysisId: v.id("creativeAnalyses"),
    ordinal: v.number(),
    title: v.string(),
    concept: v.string(),
    objective: v.string(),
    targetAudience: v.string(),
    angle: v.string(),
    hook: v.string(),
    narrativeArc: v.array(v.string()),
    visualDirection: v.string(),
    callToAction: v.string(),
    brandFactIds: v.array(v.string()),
    requiredAssets: v.array(
      v.object({
        kind: v.string(),
        description: v.string(),
        strategy: v.union(
          v.literal("available"),
          v.literal("generate"),
          v.literal("needs_owner"),
          v.literal("not_needed"),
        ),
        assetIds: v.array(v.string()),
      }),
    ),
    retainedMechanisms: v.array(v.string()),
    avoidedSourceElements: v.array(v.string()),
    brandFitScore: v.number(),
    evidenceFitScore: v.number(),
    noveltyScore: v.number(),
    feasibilityScore: v.number(),
    riskScore: v.number(),
    totalScore: v.number(),
    model: v.string(),
    promptVersion: v.string(),
    createdAt: v.number(),
  })
    .index("by_opportunity", ["opportunityId"])
    .index("by_analysis_ordinal", ["analysisId", "ordinal"]),

  creativeBriefs: defineTable({
    accountId: v.id("accounts"),
    opportunityId: v.id("opportunities"),
    analysisId: v.id("creativeAnalyses"),
    selectedDirectionId: v.id("creativeDirections"),
    status: v.union(v.literal("ready"), v.literal("rejected")),
    selectionReason: v.string(),
    tradeoffs: v.array(v.string()),
    rejectedDirectionReasons: v.array(v.string()),
    title: v.string(),
    objective: v.string(),
    targetAudience: v.string(),
    format: v.literal("carousel"),
    coreMessage: v.string(),
    audiencePromise: v.string(),
    angle: v.string(),
    hook: v.string(),
    narrativeBeats: v.array(
      v.object({
        position: v.number(),
        role: v.string(),
        intent: v.string(),
        keyMessage: v.string(),
        visualInstruction: v.string(),
      }),
    ),
    visualSystem: v.string(),
    tone: v.array(v.string()),
    callToAction: v.string(),
    brandFactIds: v.array(v.string()),
    sourceMechanisms: v.array(v.string()),
    excludedSourceElements: v.array(v.string()),
    assetRequirements: v.array(
      v.object({
        kind: v.string(),
        description: v.string(),
        strategy: v.union(
          v.literal("available"),
          v.literal("generate"),
          v.literal("needs_owner"),
          v.literal("not_needed"),
        ),
        assetIds: v.array(v.string()),
      }),
    ),
    restrictionsApplied: v.array(v.string()),
    productionNotes: v.array(v.string()),
    confidence: v.number(),
    reviewDecision: v.union(v.literal("approved"), v.literal("rejected")),
    reviewSummary: v.string(),
    brandGrounding: v.array(v.object({ factId: v.string(), usage: v.string() })),
    unsupportedClaims: v.array(v.string()),
    similarityRisks: v.array(v.string()),
    missingAssets: v.array(v.string()),
    reviewIssues: v.array(v.string()),
    reviewConfidence: v.number(),
    deterministicIssues: v.array(v.string()),
    sourceSimilarity: v.number(),
    model: v.string(),
    promptVersion: v.string(),
    reviewModel: v.string(),
    reviewPromptVersion: v.string(),
    createdAt: v.number(),
  })
    .index("by_opportunity", ["opportunityId"])
    .index("by_account_status", ["accountId", "status"]),

  inputAssessments: defineTable({
    accountId: v.id("accounts"),
    marketPostId: v.id("marketPosts"),
    opportunityId: v.optional(v.id("opportunities")),
    brandSnapshotId: v.optional(v.id("brandSnapshots")),
    dossierId: v.optional(v.id("sourceDossiers")),
    decision: v.union(...inputAssessmentDecisions.map((value) => v.literal(value))),
    stage: v.union(...inputAssessmentStages.map((value) => v.literal(value))),
    detectorVersion: v.string(),
    postAgeMs: v.number(),
    qualityScore: v.number(),
    rejectionCodes: v.array(v.union(...inputRejectionCodes.map((code) => v.literal(code)))),
    warnings: v.array(v.string()),
    snapshotIds: v.array(v.id("metricSnapshots")),
    evaluatedAt: v.number(),
  })
    .index("by_market_post", ["marketPostId"])
    .index("by_opportunity", ["opportunityId"])
    .index("by_account_evaluated", ["accountId", "evaluatedAt"]),

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
    detectorVersion: v.optional(v.string()),
    eligibleUntil: v.optional(v.number()),
    postAgeAtDetection: v.optional(v.number()),
    brandSnapshotId: v.optional(v.id("brandSnapshots")),
    dossierId: v.optional(v.id("sourceDossiers")),
    inputAssessmentId: v.optional(v.id("inputAssessments")),
    creativeAnalysisId: v.optional(v.id("creativeAnalyses")),
    creativeDirectionIds: v.optional(v.array(v.id("creativeDirections"))),
    creativeBriefId: v.optional(v.id("creativeBriefs")),
    creativeRejectionReason: v.optional(v.string()),
    rejectionCodes: v.optional(
      v.array(v.union(...inputRejectionCodes.map((code) => v.literal(code)))),
    ),
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
    // What an authorized reference photo depicts. "face" references are the only
    // images generation may use to depict the owner — identity conditioning is
    // opt-in per photo, never inferred from arbitrary uploads.
    referenceKind: v.optional(
      v.union(v.literal("face"), v.literal("product"), v.literal("place"), v.literal("style")),
    ),
    mimeType: v.optional(v.string()),
    description: v.optional(v.string()),
    altText: v.optional(v.string()),
    inspectionStatus: v.optional(
      v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    ),
    visualDescription: v.optional(v.string()),
    visualSubjects: v.optional(v.array(v.string())),
    dominantColors: v.optional(v.array(v.string())),
    containsText: v.optional(v.boolean()),
    containsFace: v.optional(v.boolean()),
    containsProduct: v.optional(v.boolean()),
    safeForBrandUse: v.optional(v.boolean()),
    allowedRoles: v.optional(v.array(v.string())),
    inspectionWarnings: v.optional(v.array(v.string())),
    inspectionConfidence: v.optional(v.number()),
    inspectedAt: v.optional(v.number()),
    // Once attached to chat, composer cleanup may no longer delete this asset.
    lastAttachedAt: v.optional(v.number()),
    // Gallery metadata: a human/agent-given title plus the generation record shown
    // in the image detail view. Absent on uploads and legacy rows.
    name: v.optional(v.string()),
    model: v.optional(v.string()),
    costUsd: v.optional(v.number()),
    generationMs: v.optional(v.number()),
    // Who wrote the generation prompt: Vanda (from chat) or the owner (gallery
    // composer). Absent on uploads and legacy rows.
    promptAuthor: v.optional(v.union(v.literal("vanda"), v.literal("user"))),
    // Generation lifecycle for gallery fan-outs: rows are inserted as
    // "generating" placeholders, then filled in place (status cleared) or
    // marked "failed". Absent = ready.
    status: v.optional(v.union(v.literal("generating"), v.literal("failed"))),
    generationError: v.optional(v.string()),
    // Set when this image was produced by a run_code execution.
    codeRunId: v.optional(v.id("codeRuns")),
    // Set when this image is a paint edit of another image (provenance).
    editOfImageId: v.optional(v.id("images")),
    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_created", ["accountId", "createdAt"])
    .index("by_storage", ["storageId"]),

  // Bounded, normalized reads produced by the Instagram provider router.
  // The table is both a TTL cache and the source for the read-only /instagram
  // workspace mount; provider credentials and raw responses never enter it.
  instagramObservations: defineTable({
    accountId: v.id("accounts"),
    requestKey: v.string(),
    operation: v.string(),
    target: v.string(),
    workspacePath: v.string(),
    source: v.union(v.literal("upload_post"), v.literal("apify")),
    completeness: v.union(v.literal("complete"), v.literal("partial")),
    payload: v.any(),
    itemCount: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    nextCursor: v.optional(v.string()),
    observedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_account_request", ["accountId", "requestKey"])
    .index("by_account_observed", ["accountId", "observedAt"]),

  instagramReadEvents: defineTable({
    accountId: v.id("accounts"),
    operation: v.string(),
    source: v.union(v.literal("upload_post"), v.literal("apify")),
    itemCount: v.number(),
    costUsd: v.optional(v.number()),
    observedAt: v.number(),
  }).index("by_account_observed", ["accountId", "observedAt"]),

  // Audit log of run_code executions: the agent-authored Python, its output, and
  // the images it produced. Doubles as the rate-limit counter and the seed for
  // promoting successful runs into reusable templates later.
  codeRunArtifacts: defineTable({
    accountId: v.id("accounts"),
    codeRunId: v.id("codeRuns"),
    filename: v.string(),
    mimeType: v.string(),
    content: v.string(),
    createdAt: v.number(),
  })
    .index("by_run", ["codeRunId"])
    .index("by_account_created", ["accountId", "createdAt"]),

  codeRuns: defineTable({
    accountId: v.id("accounts"),
    threadId: v.optional(v.string()),
    code: v.string(),
    description: v.string(),
    status: v.union(v.literal("running"), v.literal("ok"), v.literal("failed")),
    stdout: v.optional(v.string()),
    stderr: v.optional(v.string()),
    // Infra failures only — Python tracebacks land in stderr instead.
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    imageIds: v.optional(v.array(v.id("images"))),
    createdAt: v.number(),
  }).index("by_account_created", ["accountId", "createdAt"]),

  // Writable workspace documents (/memory, /templates, /brand/notes.md). Unlike
  // the projected views, these files ARE the data: this table holds the head of
  // each file; every write also appends to workspaceFileRevisions.
  workspaceFiles: defineTable({
    accountId: v.id("accounts"),
    path: v.string(),
    content: v.string(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_account_path", ["accountId", "path"]),

  workspaceFileRevisions: defineTable({
    accountId: v.id("accounts"),
    path: v.string(),
    content: v.string(),
    savedAt: v.number(),
    savedBy: v.string(),
  }).index("by_account_path", ["accountId", "path"]),

  posts: defineTable({
    accountId: v.id("accounts"),
    // Conversation destinations for deterministic publication follow-ups.
    originThreadId: v.optional(v.string()),
    caetanoThreadId: v.optional(v.string()),
    type: v.union(...postTypes.map((type) => v.literal(type))),
    imageIds: v.array(v.id("images")),
    caption: v.string(),
    platform: v.string(),
    status: v.union(...postStatuses.map((status) => v.literal(status))),
    opportunityId: v.optional(v.id("opportunities")),
    createdAt: v.number(),
  }).index("by_account", ["accountId"]),

  scheduledPosts: defineTable({
    accountId: v.id("accounts"),
    postId: v.id("posts"),
    scheduledFor: v.number(),
    status: v.union(...scheduledStatuses.map((status) => v.literal(status))),
    // The armed scheduler job — kept so a reschedule/cancel can disarm it.
    scheduledJobId: v.optional(v.id("_scheduled_functions")),
    externalPostId: v.optional(v.string()),
    // Public Instagram URL, when the publisher reports one.
    permalink: v.optional(v.string()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_scheduledFor", ["accountId", "scheduledFor"])
    .index("by_post", ["postId"]),
});
