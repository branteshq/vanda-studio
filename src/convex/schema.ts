import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
    brandKitValidator,
    onboardingPathValidator,
    onboardingStatusValidator,
} from "./brandKitShape";
import { instagramContentDigestValidator } from "./instagramDigestShape";
import { launchPostsGenerationValidator } from "../lib/convex/launchPostsShape";

export default defineSchema({
    users: defineTable({
        name: v.string(),
        email: v.string(),
        clerkId: v.string(),
        imageUrl: v.optional(v.string()),
    }).index("by_clerk_id", ["clerkId"]),

    projects: defineTable({
        userId: v.id("users"),
        name: v.string(), // e.g. "Vanda Studio"
        instagramUrl: v.optional(v.string()),
        instagramHandle: v.optional(v.string()),
        profilePictureUrl: v.optional(v.string()),
        profilePictureStorageId: v.optional(v.id("_storage")),
        bio: v.optional(v.string()),
        followersCount: v.optional(v.number()),
        followingCount: v.optional(v.number()),
        postsCount: v.optional(v.number()),
        website: v.optional(v.string()),
        isFetching: v.optional(v.boolean()),
        createdAt: v.number(),
        // Brand context fields
        platform: v.optional(v.string()), // "instagram" | "tiktok" | "twitter" | "other"
        accountDescription: v.optional(v.string()), // What is this account about?
        brandTraits: v.optional(v.array(v.string())), // ["friendly", "witty", "concise"]
        additionalContext: v.optional(v.string()), // Free-form additional context
        latestBrandAnalysisId: v.optional(v.string()), // Legacy field kept for schema compatibility
        brandKit: v.optional(brandKitValidator),
        brandContextMarkdown: v.optional(v.string()),
        onboardingStatus: v.optional(onboardingStatusValidator),
        onboardingPath: v.optional(onboardingPathValidator),
        /** LLM summary of recent synced IG captions — avoids repeating recent themes in AI posts */
        instagramContentDigest: v.optional(instagramContentDigestValidator),
        brandIntelligence: v.optional(v.object({
            summary: v.string(),
            contentPillars: v.array(v.string()),
            audienceSignals: v.array(v.string()),
            visualDirection: v.array(v.string()),
            recommendationNotes: v.array(v.string()),
            sourcePostCount: v.number(),
            generatedAt: v.number(),
        })),
        lastInstagramSyncAt: v.optional(v.number()),
        /** How the last Instagram sync ran: captions-only vs mirrored media to storage */
        lastInstagramSyncMode: v.optional(v.union(v.literal("intel_only"), v.literal("full"))),
        /** One-shot demo run that creates and schedules 5 launch posts for the project. */
        launchPostsGeneration: v.optional(launchPostsGenerationValidator),
    }).index("by_user_id", ["userId"]),

    social_connections: defineTable({
        userId: v.id("users"),
        projectId: v.optional(v.id("projects")),
        platform: v.string(), // "instagram"
        provider: v.string(), // "instagram_graph"
        status: v.string(), // "connected" | "error" | "expired"
        externalAccountId: v.string(), // Instagram professional account ID
        externalAccountName: v.optional(v.string()),
        handle: v.optional(v.string()),
        pageId: v.optional(v.string()),
        pageName: v.optional(v.string()),
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
    }).index("by_user_id", ["userId"])
      .index("by_user_platform", ["userId", "platform"])
      .index("by_project_platform", ["projectId", "platform"])
      .index("by_external_account", ["provider", "externalAccountId"]),

    // Context images for brand context
    context_images: defineTable({
        projectId: v.id("projects"),
        storageId: v.id("_storage"),
        storageUrl: v.optional(v.string()),
        createdAt: v.number(),
    }).index("by_project_id", ["projectId"]),

    social_posts: defineTable({
        userId: v.id("users"),
        projectId: v.id("projects"),
        connectionId: v.id("social_connections"),
        platform: v.string(), // "instagram"
        provider: v.string(), // "instagram_graph"
        externalAccountId: v.string(),
        externalPostId: v.string(),
        caption: v.optional(v.string()),
        mediaType: v.string(),
        mediaProductType: v.optional(v.string()),
        mediaUrl: v.optional(v.string()),
        thumbnailUrl: v.optional(v.string()),
        permalink: v.string(),
        publishedAt: v.number(),
        likeCount: v.optional(v.number()),
        commentsCount: v.optional(v.number()),
        reach: v.optional(v.number()),
        impressions: v.optional(v.number()),
        saved: v.optional(v.number()),
        shares: v.optional(v.number()),
        totalInteractions: v.optional(v.number()),
        engagementScore: v.optional(v.float64()),
        insightsCapturedAt: v.optional(v.number()),
        intelligence: v.optional(v.object({
            topic: v.string(),
            hook: v.string(),
            format: v.string(),
            visualSignals: v.array(v.string()),
            performanceNotes: v.array(v.string()),
            recommendationWeight: v.number(),
            analyzedAt: v.number(),
        })),
        children: v.optional(v.array(v.object({
            externalPostId: v.string(),
            mediaType: v.string(),
            mediaUrl: v.optional(v.string()),
            thumbnailUrl: v.optional(v.string()),
            permalink: v.optional(v.string()),
        }))),
        importedAt: v.number(),
        updatedAt: v.number(),
    }).index("by_project_platform", ["projectId", "platform"])
      .index("by_project_published", ["projectId", "publishedAt"])
      .index("by_connection_external", ["connectionId", "externalPostId"]),

    account_metric_snapshots: defineTable({
        userId: v.id("users"),
        projectId: v.id("projects"),
        connectionId: v.id("social_connections"),
        platform: v.string(),
        provider: v.string(),
        externalAccountId: v.string(),
        capturedAt: v.number(),
        followersCount: v.optional(v.number()),
        followingCount: v.optional(v.number()),
        postsCount: v.optional(v.number()),
        reach: v.optional(v.number()),
        profileViews: v.optional(v.number()),
    }).index("by_project_captured", ["projectId", "capturedAt"])
      .index("by_connection_captured", ["connectionId", "capturedAt"]),

    post_metric_snapshots: defineTable({
        userId: v.id("users"),
        projectId: v.id("projects"),
        connectionId: v.id("social_connections"),
        socialPostId: v.id("social_posts"),
        platform: v.string(),
        provider: v.string(),
        externalAccountId: v.string(),
        externalPostId: v.string(),
        capturedAt: v.number(),
        likeCount: v.optional(v.number()),
        commentsCount: v.optional(v.number()),
        reach: v.optional(v.number()),
        impressions: v.optional(v.number()),
        saved: v.optional(v.number()),
        shares: v.optional(v.number()),
        totalInteractions: v.optional(v.number()),
        engagementScore: v.optional(v.float64()),
    }).index("by_project_captured", ["projectId", "capturedAt"])
      .index("by_post_captured", ["socialPostId", "capturedAt"])
      .index("by_connection_captured", ["connectionId", "capturedAt"]),

    // AI-generated posts
    generated_posts: defineTable({
        projectId: v.optional(v.id("projects")), // Optional - can be null for standalone posts
        userId: v.optional(v.id("users")), // Direct user ownership for standalone posts
        platform: v.optional(v.string()), // "instagram" | "twitter" | "linkedin"
        title: v.optional(v.string()),
        caption: v.string(),
        // Legacy fields - kept for backwards compatibility with existing data
        additionalContext: v.optional(v.string()),
        brandAnalysisId: v.optional(v.string()), // Legacy - no longer used
        selectedAngle: v.optional(v.any()), // Legacy - no longer used
        // Source posts used as context (optional)
        sourcePostIds: v.optional(v.array(v.id("social_posts"))),
        // AI reasoning
        reasoning: v.optional(v.string()),
        // Generated image
        imageStorageId: v.optional(v.id("_storage")),
        imagePrompt: v.optional(v.string()), // The prompt used to generate the image
        // Generation metadata
        model: v.optional(v.string()),
        imageModel: v.optional(v.string()),
        // Status
        status: v.string(), // "generating_caption" | "generating_images" | "generated" | "edited" | "regenerated"
        createdAt: v.number(),
        updatedAt: v.number(),
        // Progressive loading fields
        pendingImageModels: v.optional(v.array(v.string())), // Models still generating
        totalImageModels: v.optional(v.number()), // Total models requested
        // Soft delete
        deletedAt: v.optional(v.number()), // Timestamp when soft-deleted (null = not deleted)

        // Lineage tracking - for posts created from edit conversations
        parentPostId: v.optional(v.id("generated_posts")), // The post this was derived from
        sourceConversationId: v.optional(v.id("image_edit_conversations")), // The conversation that created this
        sourceOutputId: v.optional(v.id("image_edit_outputs")), // The specific output

        // Full brief that was used for generation
        brief: v.optional(v.object({
            postType: v.string(), // "promocao" | "conteudo_profissional" | "engajamento"
            contentPillar: v.optional(v.string()), // Selected pillar name
            customTopic: v.optional(v.string()),
            toneOverride: v.optional(v.array(v.string())),
            captionLength: v.optional(v.string()), // "curta" | "media" | "longa"
            includeHashtags: v.optional(v.boolean()),
            additionalContext: v.optional(v.string()),
            // Reference materials info (not the actual files)
            referenceText: v.optional(v.string()),
            referenceImageIds: v.optional(v.array(v.id("_storage"))),
        })),

        // Composed post flag (created from media library, not from generation)
        isComposed: v.optional(v.boolean()),

        // ============================================================================
        // Scheduling fields
        // ============================================================================
        scheduledFor: v.optional(v.number()), // Unix timestamp when the post should be published
        schedulingStatus: v.optional(v.string()), // "scheduled" | "publishing" | "posted" | "missed" | "publish_failed"
        reminderMinutes: v.optional(v.number()), // Reminder before scheduled time (e.g., 30)
        publishedAt: v.optional(v.number()),
        publishedConnectionId: v.optional(v.id("social_connections")),
        publishedSocialPostId: v.optional(v.id("social_posts")),
        instagramContainerId: v.optional(v.string()),
        instagramPublishedMediaId: v.optional(v.string()),
        publishError: v.optional(v.string()),
    }).index("by_project_id", ["projectId"])
      .index("by_created_at", ["createdAt"])
      .index("by_user_id", ["userId"])
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_source_output", ["sourceOutputId"])
      .index("by_parent_post", ["parentPostId"])
      .index("by_scheduled_for", ["scheduledFor"])
      .index("by_scheduling_status", ["schedulingStatus"]),

    // Reference images uploaded by user for generation
    reference_images: defineTable({
        projectId: v.id("projects"),
        storageId: v.id("_storage"),
        filename: v.string(),
        mimeType: v.string(),
        // Vision LLM analysis of the image
        analysis: v.optional(v.object({
            description: v.string(),
            dominantColors: v.array(v.string()),
            style: v.string(),
            mood: v.string(),
            elements: v.array(v.string()), // Objects/elements detected
        })),
        createdAt: v.number(),
    }).index("by_project_id", ["projectId"]),

    // Generation history - tracks all versions/iterations of a generated post
    // DEPRECATED: Use chat_messages instead for new posts
    generation_history: defineTable({
        generatedPostId: v.id("generated_posts"),
        version: v.number(), // 1, 2, 3, etc.
        // What was generated in this version
        caption: v.string(),
        imageStorageId: v.optional(v.id("_storage")),
        imagePrompt: v.optional(v.string()),
        // What triggered this version
        action: v.string(), // "initial" | "regenerate_image" | "regenerate_caption" | "edit_caption" | "regenerate_both"
        // User feedback that triggered regeneration (if any)
        feedback: v.optional(v.string()), // e.g., "Make the image brighter", "Less formal tone"
        // Metadata
        model: v.optional(v.string()),
        imageModel: v.optional(v.string()),
        createdAt: v.number(),
    }).index("by_generated_post_id", ["generatedPostId"])
      .index("by_version", ["generatedPostId", "version"]),

    // Chat messages for post generation conversations
    chat_messages: defineTable({
        generatedPostId: v.id("generated_posts"),
        role: v.string(), // "user" | "assistant" | "system"
        content: v.string(), // The message text

        // What action was taken (user messages only)
        action: v.optional(v.string()), // "initial" | "regenerate_caption" | "regenerate_image" | "regenerate_both"

        // State snapshot AFTER this message (assistant messages only)
        snapshot: v.optional(v.object({
            caption: v.string(),
            imageStorageId: v.optional(v.id("_storage")),
            imagePrompt: v.optional(v.string()),
        })),

        // Attachments for this message (user messages only)
        attachments: v.optional(v.object({
            // Reference images - URLs for external, storageIds for uploaded
            imageUrls: v.optional(v.array(v.string())),
            imageStorageIds: v.optional(v.array(v.id("_storage"))),
            // Instagram post reference
            instagramPostUrl: v.optional(v.string()),
            instagramPostCaption: v.optional(v.string()),
            // Text context
            referenceText: v.optional(v.string()),
        })),

        // Generation metadata (assistant messages only)
        model: v.optional(v.string()),
        imageModel: v.optional(v.string()),
        creditsUsed: v.optional(v.number()),

        createdAt: v.number(),
    }).index("by_generated_post_id", ["generatedPostId"])
      .index("by_created_at", ["generatedPostId", "createdAt"]),

    // Generated images - stores multiple images per post (one per model)
    generated_images: defineTable({
        generatedPostId: v.id("generated_posts"),
        storageId: v.id("_storage"),
        model: v.string(), // The model used to generate this image
        aspectRatio: v.optional(v.string()), // "1:1", "16:9", etc.
        resolution: v.optional(v.string()), // "standard", "high", "ultra"
        prompt: v.string(), // The prompt used to generate the image
        width: v.number(),
        height: v.number(),
        createdAt: v.number(),
    }).index("by_generated_post_id", ["generatedPostId"]),

    // ============================================================================
    // Media Library
    // ============================================================================

    // Reusable image assets (decoupled from posts)
    media_items: defineTable({
        userId: v.id("users"),
        projectId: v.optional(v.id("projects")),
        storageId: v.id("_storage"),
        thumbnailStorageId: v.optional(v.id("_storage")),
        thumbnailStatus: v.optional(v.string()), // "pending" | "ready" | "error"
        thumbnailUpdatedAt: v.optional(v.number()),
        mimeType: v.string(),
        width: v.number(),
        height: v.number(),
        sourceType: v.string(), // "generated" | "uploaded" | "edited" | "imported"
        model: v.optional(v.string()),
        prompt: v.optional(v.string()),
        userPrompt: v.optional(v.string()),
        generationDurationMs: v.optional(v.number()),
        aspectRatio: v.optional(v.string()),
        resolution: v.optional(v.string()),
        parentMediaId: v.optional(v.id("media_items")),
        sourceConversationId: v.optional(v.id("image_edit_conversations")),
        sourceTurnId: v.optional(v.id("image_edit_turns")),
        sourceOutputId: v.optional(v.id("image_edit_outputs")),
        batchId: v.optional(v.id("media_generation_batches")),
        // Legacy bridge (for migration lookups)
        legacyGeneratedImageId: v.optional(v.id("generated_images")),
        legacyPostId: v.optional(v.id("generated_posts")),
        deletedAt: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
    }).index("by_user_id", ["userId"])
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_project_id", ["projectId"])
      .index("by_legacy_image", ["legacyGeneratedImageId"])
      .index("by_source_output", ["sourceOutputId"])
      .index("by_batch", ["batchId"]),

    // Join table: posts <-> media items (multi-image carousel support)
    post_media_items: defineTable({
        postId: v.id("generated_posts"),
        mediaItemId: v.id("media_items"),
        position: v.number(), // 0, 1, 2... for ordering
        role: v.string(), // "cover" | "attachment"
    }).index("by_post", ["postId"])
      .index("by_media", ["mediaItemId"]),

    // Batch tracking for progressive image generation
    media_generation_batches: defineTable({
        userId: v.id("users"),
        projectId: v.optional(v.id("projects")),
        status: v.string(), // "generating" | "completed" | "error"
        pendingModels: v.optional(v.array(v.string())),
        lastProgressAt: v.optional(v.number()),
        lastErrorCode: v.optional(v.string()),
        lastErrorMessage: v.optional(v.string()),
        requestedModels: v.optional(v.array(v.string())),
        totalModels: v.number(),
        prompt: v.string(),
        aspectRatio: v.string(),
        resolution: v.string(),
        createdAt: v.number(),
    }).index("by_user_id", ["userId"])
      .index("by_user_created", ["userId", "createdAt"]),

    // ============================================================================
    // Image Editing Conversations
    // ============================================================================

    // Conversations for iteratively editing images
    image_edit_conversations: defineTable({
        // Owner
        userId: v.id("users"),

        // Source image that started this conversation
        sourceImageId: v.optional(v.id("generated_images")), // Legacy - optional for new media-based convos
        sourceMediaId: v.optional(v.id("media_items")), // New - media library source
        sourceStorageId: v.id("_storage"), // Denormalized for quick access

        // Metadata
        title: v.string(), // Auto-generated from first prompt

        // Settings (defaults for new turns, inherited from source)
        aspectRatio: v.optional(v.string()), // "1:1", "16:9", etc.
        resolution: v.optional(v.string()), // "standard", "high", "ultra"

        // Materialized summary fields for list/feed queries
        turnCount: v.optional(v.number()),
        latestTurnId: v.optional(v.id("image_edit_turns")),
        latestTurnIndex: v.optional(v.number()),
        latestUserMessage: v.optional(v.string()),
        latestAspectRatio: v.optional(v.string()),
        latestResolution: v.optional(v.string()),
        latestStatus: v.optional(v.string()),
        latestPendingModels: v.optional(v.array(v.string())),
        latestProgressAt: v.optional(v.number()),
        latestOutputCount: v.optional(v.number()),
        thumbnailStorageId: v.optional(v.id("_storage")),
        latestOutputs: v.optional(
            v.array(
                v.object({
                    outputId: v.id("image_edit_outputs"),
                    storageId: v.id("_storage"),
                    thumbnailStorageId: v.optional(v.id("_storage")),
                    model: v.string(),
                    width: v.number(),
                    height: v.number(),
                    createdAt: v.number(),
                })
            )
        ),

        // Timestamps
        createdAt: v.number(),
        updatedAt: v.number(),
        // Soft delete
        deletedAt: v.optional(v.number()), // Timestamp when soft-deleted (null = not deleted)
    }).index("by_user_id", ["userId"])
      .index("by_source_image", ["sourceImageId"])
      .index("by_source_media", ["sourceMediaId"])
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_user_updated", ["userId", "updatedAt"]),

    // Each turn in an image editing conversation
    image_edit_turns: defineTable({
        conversationId: v.id("image_edit_conversations"),
        turnIndex: v.number(), // 0, 1, 2, ...

        // User input
        userMessage: v.string(),
        selectedModels: v.array(v.string()), // Models chosen for this turn
        selectedOutputIds: v.optional(v.array(v.id("image_edit_outputs"))), // Selected outputs from the previous turn

        // Additional reference images (user-uploaded, not auto from previous turn)
        manualReferenceIds: v.optional(v.array(v.id("_storage"))),

        // Per-turn generation settings
        aspectRatio: v.optional(v.string()), // "1:1", "16:9", etc.
        resolution: v.optional(v.string()), // "standard", "high", "ultra"
        /** OpenRouter / image agent style preset prompt (omit for default photorealistic) */
        stylePreset: v.optional(v.string()),

        // Generation state (for progressive loading)
        status: v.string(), // "pending" | "generating" | "completed" | "error"
        pendingModels: v.optional(v.array(v.string())), // Models still generating
        lastProgressAt: v.optional(v.number()),

        createdAt: v.number(),
    }).index("by_conversation", ["conversationId"])
      .index("by_conversation_turn", ["conversationId", "turnIndex"]),

    // Output images for each turn (one per model)
    image_edit_outputs: defineTable({
        turnId: v.id("image_edit_turns"),
        conversationId: v.id("image_edit_conversations"), // Denormalized for queries

        // Image data
        storageId: v.id("_storage"),
        thumbnailStorageId: v.optional(v.id("_storage")),
        model: v.string(),
        prompt: v.string(), // The prompt used
        width: v.number(),
        height: v.number(),

        createdAt: v.number(),
    }).index("by_turn", ["turnId"])
      .index("by_conversation", ["conversationId"]),

    // ============================================================================
    // Calendar & Scheduling
    // ============================================================================

    // Google Calendar OAuth connections
    google_calendar_connections: defineTable({
        userId: v.id("users"),
        accessToken: v.string(),
        refreshToken: v.string(),
        expiresAt: v.number(), // Token expiration timestamp
        calendarId: v.string(), // Which Google Calendar to sync to (e.g., "primary")
        syncEnabled: v.boolean(),
        createdAt: v.number(),
        updatedAt: v.number(),
    }).index("by_user_id", ["userId"]),

    // Calendar events for tracking synced posts
    calendar_events: defineTable({
        userId: v.id("users"),
        postId: v.id("generated_posts"),
        googleEventId: v.optional(v.string()), // Google Calendar event ID (if synced)
        scheduledFor: v.number(),
        reminderMinutes: v.optional(v.number()), // e.g., 30 minutes before
        status: v.string(), // "pending" | "synced" | "reminded" | "completed" | "missed" | "sync_failed"
        lastSyncAt: v.optional(v.number()), // Last time synced with Google Calendar
        createdAt: v.number(),
        updatedAt: v.number(),
        // Retry tracking fields
        syncAttempts: v.optional(v.number()), // Number of sync attempts (for retry logic)
        nextRetryAt: v.optional(v.number()), // When to retry next (exponential backoff)
        lastErrorCode: v.optional(v.string()), // Last error code for debugging
    }).index("by_user_id", ["userId"])
      .index("by_post_id", ["postId"])
      .index("by_scheduled_for", ["scheduledFor"])
      .index("by_status", ["status"])
      .index("by_next_retry", ["nextRetryAt"]),

    // Sync error tracking for debugging
    sync_errors: defineTable({
        eventId: v.id("calendar_events"),
        postId: v.id("generated_posts"),
        userId: v.id("users"),
        errorCode: v.string(), // TOKEN_EXPIRED | RATE_LIMITED | API_ERROR | NETWORK_ERROR | INVALID_GRANT | UNKNOWN
        errorMessage: v.string(),
        httpStatus: v.optional(v.number()),
        retryable: v.boolean(),
        syncAttempt: v.number(), // Which attempt failed
        createdAt: v.number(),
    }).index("by_event_id", ["eventId"])
      .index("by_user_id", ["userId"])
      .index("by_error_code", ["errorCode"])
      .index("by_created_at", ["createdAt"]),

});
