import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// ============================================================================
// Scheduling Mutations
// ============================================================================

// Schedule a post for a future date
export const schedulePost = mutation({
    args: {
        postId: v.id("generated_posts"),
        scheduledFor: v.number(), // Unix timestamp
        reminderMinutes: v.optional(v.number()), // e.g., 30 minutes before
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.postId);
        if (!post) {
            throw new Error("Post not found");
        }

        // Verify user has access
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        // Check ownership
        let hasAccess = post.userId === user._id;
        if (!hasAccess && post.projectId) {
            const project = await ctx.db.get(post.projectId);
            hasAccess = project?.userId === user._id;
        }

        if (!hasAccess) {
            throw new Error("Not authorized");
        }

        // Validate scheduled time is in the future
        if (args.scheduledFor <= Date.now()) {
            throw new Error("Scheduled time must be in the future");
        }

        // Update post with scheduling info
        await ctx.db.patch(args.postId, {
            scheduledFor: args.scheduledFor,
            schedulingStatus: "scheduled",
            reminderMinutes: args.reminderMinutes,
            updatedAt: Date.now(),
        });

        // Create calendar event for tracking
        await ctx.db.insert("calendar_events", {
            userId: user._id,
            postId: args.postId,
            scheduledFor: args.scheduledFor,
            ...(args.reminderMinutes !== undefined && { reminderMinutes: args.reminderMinutes }),
            status: "pending",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        return { success: true };
    },
});

// Reschedule a post to a different time
export const reschedulePost = mutation({
    args: {
        postId: v.id("generated_posts"),
        scheduledFor: v.number(),
        reminderMinutes: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.postId);
        if (!post) {
            throw new Error("Post not found");
        }

        // Verify user has access
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        // Check ownership
        let hasAccess = post.userId === user._id;
        if (!hasAccess && post.projectId) {
            const project = await ctx.db.get(post.projectId);
            hasAccess = project?.userId === user._id;
        }

        if (!hasAccess) {
            throw new Error("Not authorized");
        }

        // Validate scheduled time is in the future
        if (args.scheduledFor <= Date.now()) {
            throw new Error("Scheduled time must be in the future");
        }

        // Update post
        await ctx.db.patch(args.postId, {
            scheduledFor: args.scheduledFor,
            schedulingStatus: "scheduled",
            reminderMinutes: args.reminderMinutes,
            updatedAt: Date.now(),
        });

        // Update associated calendar event
        const calendarEvent = await ctx.db
            .query("calendar_events")
            .withIndex("by_post_id", (q) => q.eq("postId", args.postId))
            .first();

        if (calendarEvent) {
            await ctx.db.patch(calendarEvent._id, {
                scheduledFor: args.scheduledFor,
                reminderMinutes: args.reminderMinutes,
                status: "pending", // Reset status if it was synced
                updatedAt: Date.now(),
            });
        }

        return { success: true };
    },
});

// Remove scheduling from a post
export const unschedulePost = mutation({
    args: {
        postId: v.id("generated_posts"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.postId);
        if (!post) {
            throw new Error("Post not found");
        }

        // Verify user has access
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        // Check ownership
        let hasAccess = post.userId === user._id;
        if (!hasAccess && post.projectId) {
            const project = await ctx.db.get(post.projectId);
            hasAccess = project?.userId === user._id;
        }

        if (!hasAccess) {
            throw new Error("Not authorized");
        }

        // Remove scheduling fields
        await ctx.db.patch(args.postId, {
            scheduledFor: undefined,
            schedulingStatus: undefined,
            reminderMinutes: undefined,
            updatedAt: Date.now(),
        });

        // Delete associated calendar event
        const calendarEvent = await ctx.db
            .query("calendar_events")
            .withIndex("by_post_id", (q) => q.eq("postId", args.postId))
            .first();

        if (calendarEvent) {
            await ctx.db.delete(calendarEvent._id);
        }

        return { success: true };
    },
});

// Mark a post as posted (manual action by user)
export const markAsPosted = mutation({
    args: {
        postId: v.id("generated_posts"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        const post = await ctx.db.get(args.postId);
        if (!post) {
            throw new Error("Post not found");
        }

        // Verify user has access
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            throw new Error("User not found");
        }

        // Check ownership
        let hasAccess = post.userId === user._id;
        if (!hasAccess && post.projectId) {
            const project = await ctx.db.get(post.projectId);
            hasAccess = project?.userId === user._id;
        }

        if (!hasAccess) {
            throw new Error("Not authorized");
        }

        // Update post status
        await ctx.db.patch(args.postId, {
            schedulingStatus: "posted",
            updatedAt: Date.now(),
        });

        // Update calendar event status
        const calendarEvent = await ctx.db
            .query("calendar_events")
            .withIndex("by_post_id", (q) => q.eq("postId", args.postId))
            .first();

        if (calendarEvent) {
            await ctx.db.patch(calendarEvent._id, {
                status: "completed",
                updatedAt: Date.now(),
            });
        }

        return { success: true };
    },
});

// ============================================================================
// Scheduling Queries
// ============================================================================

// Get all scheduled posts for current user within a date range
export const getScheduledPosts = query({
    args: {
        startDate: v.number(), // Unix timestamp for start of range
        endDate: v.number(), // Unix timestamp for end of range
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            return [];
        }

        // Get all user's posts with scheduling
        const posts = await ctx.db
            .query("generated_posts")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        // Filter by date range and scheduled status
        const scheduledPosts = posts.filter(
            (post) =>
                post.scheduledFor &&
                post.scheduledFor >= args.startDate &&
                post.scheduledFor <= args.endDate &&
                !post.deletedAt
        );

        // Sort by scheduled time
        scheduledPosts.sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));

        // Resolve image URLs
        return Promise.all(
            scheduledPosts.map(async (post) => {
                // Get first image
                const images = await ctx.db
                    .query("generated_images")
                    .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", post._id))
                    .take(1);

                let imageUrl: string | null = null;
                const firstImage = images[0];
                if (firstImage) {
                    imageUrl = await ctx.storage.getUrl(firstImage.storageId);
                } else if (post.imageStorageId) {
                    imageUrl = await ctx.storage.getUrl(post.imageStorageId);
                }

                // Get project info if available
                let projectName: string | undefined;
                let projectProfilePicture: string | null = null;
                if (post.projectId) {
                    const project = await ctx.db.get(post.projectId);
                    if (project) {
                        projectName = project.name;
                        if (project.profilePictureStorageId) {
                            projectProfilePicture = await ctx.storage.getUrl(project.profilePictureStorageId);
                        } else if (project.profilePictureUrl) {
                            projectProfilePicture = project.profilePictureUrl;
                        }
                    }
                }

                return {
                    ...post,
                    imageUrl,
                    projectName,
                    projectProfilePicture,
                };
            })
        );
    },
});

// Get upcoming scheduled posts (next N posts)
export const getUpcomingPosts = query({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            return [];
        }

        const limit = args.limit ?? 10;
        const now = Date.now();

        // Get all user's posts with scheduling
        const posts = await ctx.db
            .query("generated_posts")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        // Filter future scheduled posts
        const upcomingPosts = posts
            .filter(
                (post) =>
                    post.scheduledFor &&
                    post.scheduledFor > now &&
                    post.schedulingStatus === "scheduled" &&
                    !post.deletedAt
            )
            .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0))
            .slice(0, limit);

        // Resolve image URLs
        return Promise.all(
            upcomingPosts.map(async (post) => {
                const images = await ctx.db
                    .query("generated_images")
                    .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", post._id))
                    .take(1);

                let imageUrl: string | null = null;
                const firstImage = images[0];
                if (firstImage) {
                    imageUrl = await ctx.storage.getUrl(firstImage.storageId);
                } else if (post.imageStorageId) {
                    imageUrl = await ctx.storage.getUrl(post.imageStorageId);
                }

                return {
                    ...post,
                    imageUrl,
                };
            })
        );
    },
});

export const getProjectPosts = query({
    args: {
        projectId: v.id("projects"),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const project = await ctx.db.get(args.projectId);
        if (!project) {
            return [];
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user || project.userId !== user._id) {
            return [];
        }

        const limit = Math.min(100, Math.max(1, args.limit ?? 30));
        const posts = await ctx.db
            .query("generated_posts")
            .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
            .collect();

        const visiblePosts = posts
            .filter((post) => !post.deletedAt)
            .sort((a, b) => {
                const aTime = a.scheduledFor ?? a.publishedAt ?? a.createdAt;
                const bTime = b.scheduledFor ?? b.publishedAt ?? b.createdAt;
                return bTime - aTime;
            })
            .slice(0, limit);

        return await Promise.all(
            visiblePosts.map(async (post) => {
                const images = await ctx.db
                    .query("generated_images")
                    .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", post._id))
                    .take(1);
                const firstImage = images[0];
                const imageUrl = firstImage
                    ? await ctx.storage.getUrl(firstImage.storageId)
                    : post.imageStorageId
                      ? await ctx.storage.getUrl(post.imageStorageId)
                      : null;

                return {
                    ...post,
                    imageUrl,
                };
            })
        );
    },
});

// Get posts scheduled for a specific day
export const getPostsForDay = query({
    args: {
        date: v.number(), // Unix timestamp for any time on the target day
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return [];
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            return [];
        }

        // Calculate start and end of day
        const date = new Date(args.date);
        const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
        const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;

        // Get all user's posts with scheduling
        const posts = await ctx.db
            .query("generated_posts")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        // Filter for this day
        const dayPosts = posts.filter(
            (post) =>
                post.scheduledFor &&
                post.scheduledFor >= startOfDay &&
                post.scheduledFor <= endOfDay &&
                !post.deletedAt
        );

        // Sort by time
        dayPosts.sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0));

        // Resolve image URLs
        return Promise.all(
            dayPosts.map(async (post) => {
                const images = await ctx.db
                    .query("generated_images")
                    .withIndex("by_generated_post_id", (q) => q.eq("generatedPostId", post._id))
                    .take(1);

                let imageUrl: string | null = null;
                const firstImage = images[0];
                if (firstImage) {
                    imageUrl = await ctx.storage.getUrl(firstImage.storageId);
                } else if (post.imageStorageId) {
                    imageUrl = await ctx.storage.getUrl(post.imageStorageId);
                }

                // Get project info
                let projectName: string | undefined;
                if (post.projectId) {
                    const project = await ctx.db.get(post.projectId);
                    projectName = project?.name;
                }

                return {
                    ...post,
                    imageUrl,
                    projectName,
                };
            })
        );
    },
});

// Get scheduling stats for current user
export const getSchedulingStats = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            return { scheduled: 0, posted: 0, missed: 0 };
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (!user) {
            return { scheduled: 0, posted: 0, missed: 0 };
        }

        const posts = await ctx.db
            .query("generated_posts")
            .withIndex("by_user_id", (q) => q.eq("userId", user._id))
            .collect();

        const scheduledPosts = posts.filter((p) => p.scheduledFor && !p.deletedAt);

        return {
            scheduled: scheduledPosts.filter((p) => p.schedulingStatus === "scheduled").length,
            posted: scheduledPosts.filter((p) => p.schedulingStatus === "posted").length,
            missed: scheduledPosts.filter((p) => p.schedulingStatus === "missed").length,
        };
    },
});

// ============================================================================
// Internal: Mark missed posts (to be called by cron job)
// ============================================================================

export const markMissedPosts = internalMutation({
    args: {},
    handler: async (ctx) => {
        const now = Date.now();
        const missedGraceMs = 30 * 60 * 1000;

        // Find all scheduled posts that are past due
        const allPosts = await ctx.db.query("generated_posts").collect();

        const missedPosts = allPosts.filter(
            (post) =>
                post.scheduledFor &&
                post.scheduledFor < now - missedGraceMs &&
                post.schedulingStatus === "scheduled" &&
                !post.deletedAt
        );

        let markedCount = 0;
        for (const post of missedPosts) {
            await ctx.db.patch(post._id, {
                schedulingStatus: "missed",
                updatedAt: now,
            });

            // Update calendar event
            const calendarEvent = await ctx.db
                .query("calendar_events")
                .withIndex("by_post_id", (q) => q.eq("postId", post._id))
                .first();

            if (calendarEvent) {
                await ctx.db.patch(calendarEvent._id, {
                    status: "missed",
                    updatedAt: now,
                });
            }

            markedCount++;
        }

        return { markedCount };
    },
});

export const listDueInstagramPublishJobsInternal = internalQuery({
    args: {
        now: v.number(),
        limit: v.number(),
    },
    handler: async (ctx, args) => {
        const posts = await ctx.db
            .query("generated_posts")
            .withIndex("by_scheduling_status", (q) => q.eq("schedulingStatus", "scheduled"))
            .collect();

        const due = posts
            .filter((post) =>
                post.platform === "instagram" &&
                post.projectId &&
                post.scheduledFor &&
                post.scheduledFor <= args.now &&
                !post.deletedAt
            )
            .sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0))
            .slice(0, Math.max(1, args.limit));

        return await Promise.all(
            due.map(async (post) => {
                const project = post.projectId ? await ctx.db.get(post.projectId) : null;
                if (!project) return null;

                const connection = await ctx.db
                    .query("social_connections")
                    .withIndex("by_project_platform", (q) =>
                        q.eq("projectId", project._id).eq("platform", "instagram")
                    )
                    .first();
                if (
                    !connection ||
                    connection.status !== "connected" ||
                    !connection.tokenCiphertext ||
                    !connection.tokenIv ||
                    !connection.tokenAuthTag
                ) {
                    return null;
                }

                const mediaRows = await ctx.db
                    .query("post_media_items")
                    .withIndex("by_post", (q) => q.eq("postId", post._id))
                    .collect();
                mediaRows.sort((a, b) => a.position - b.position);

                const firstMediaId = mediaRows[0]?.mediaItemId;
                const mediaItem = firstMediaId ? await ctx.db.get(firstMediaId) : null;
                const imageUrl = mediaItem
                    ? await ctx.storage.getUrl(mediaItem.storageId)
                    : post.imageStorageId
                      ? await ctx.storage.getUrl(post.imageStorageId)
                      : null;

                return {
                    postId: post._id,
                    userId: project.userId,
                    projectId: project._id,
                    connectionId: connection._id,
                    externalAccountId: connection.externalAccountId,
                    caption: post.caption,
                    imageUrl,
                    tokenCiphertext: connection.tokenCiphertext,
                    tokenIv: connection.tokenIv,
                    tokenAuthTag: connection.tokenAuthTag,
                };
            })
        ).then((jobs) => jobs.filter((job): job is NonNullable<typeof job> => Boolean(job)));
    },
});

export const markPublishingInternal = internalMutation({
    args: {
        postId: v.id("generated_posts"),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.postId, {
            schedulingStatus: "publishing",
            publishError: undefined,
            updatedAt: Date.now(),
        });
    },
});

export const markPublishFailedInternal = internalMutation({
    args: {
        postId: v.id("generated_posts"),
        error: v.string(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        await ctx.db.patch(args.postId, {
            schedulingStatus: "publish_failed",
            publishError: args.error.slice(0, 1000),
            updatedAt: now,
        });

        const calendarEvent = await ctx.db
            .query("calendar_events")
            .withIndex("by_post_id", (q) => q.eq("postId", args.postId))
            .first();
        if (calendarEvent) {
            await ctx.db.patch(calendarEvent._id, {
                status: "sync_failed",
                updatedAt: now,
                lastErrorCode: "INSTAGRAM_PUBLISH_FAILED",
            });
        }
    },
});

export const markPublishedInternal = internalMutation({
    args: {
        postId: v.id("generated_posts"),
        connectionId: v.id("social_connections"),
        socialPostId: v.id("social_posts"),
        containerId: v.string(),
        mediaId: v.string(),
        publishedAt: v.number(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        await ctx.db.patch(args.postId, {
            schedulingStatus: "posted",
            publishedAt: args.publishedAt,
            publishedConnectionId: args.connectionId,
            publishedSocialPostId: args.socialPostId,
            instagramContainerId: args.containerId,
            instagramPublishedMediaId: args.mediaId,
            publishError: undefined,
            updatedAt: now,
        });

        const calendarEvent = await ctx.db
            .query("calendar_events")
            .withIndex("by_post_id", (q) => q.eq("postId", args.postId))
            .first();
        if (calendarEvent) {
            await ctx.db.patch(calendarEvent._id, {
                status: "completed",
                updatedAt: now,
            });
        }
    },
});
