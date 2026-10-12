import { categoryOfKind } from "./usageCategories";
import { v } from "convex/values";
import type { FunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { brandFileContent, brandGuide, ensureBrandFile } from "./brandFile";
import { currentPostType } from "./pipeline/constants";
import { referenceLabelsOf } from "./references";

/**
 * Data migrations. Each one is a mutation that migrates one page and returns
 * the cursor of the next (null once the table is scanned), so it stays inside
 * a mutation's limits. `runAll` runs every registered migration that has not
 * completed in this deployment; CI calls it after every Convex deploy.
 *
 * To add one: write the page mutation here (idempotent: a crash mid-run
 * repeats pages) and append it to MIGRATIONS. Once it has run in every
 * deployment, delete it and its entry.
 */

const BATCH = 100;

// Composing reads each account's facts and notes, so fewer per page.
const BRAND_FILE_BATCH = 25;

// Each period re-reads its events, so few per page.
const USAGE_BATCH = 10;

type MigrationPage = FunctionReference<
  "mutation",
  "internal",
  { cursor: string | null },
  { migrated: number; cursor: string | null }
>;

const MIGRATIONS: ReadonlyArray<{ name: string; page: MigrationPage }> = [
  { name: "feedToCarousel", page: internal.migrations.feedToCarousel },
  { name: "brandFiles", page: internal.migrations.brandFiles },
  { name: "usageCategories", page: internal.migrations.usageCategories },
  { name: "referenceLabels", page: internal.migrations.referenceLabels },
  { name: "brandGuideDone", page: internal.migrations.brandGuideDone },
];

/** Legacy `feed` meant carousel: rewrite it to `carousel` (2+ images) or `image` (1 image). */
export const feedToCarousel = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<{ migrated: number; cursor: string | null }> => {
    const page = await ctx.db.query("posts").paginate({ cursor, numItems: BATCH });
    let migrated = 0;

    for (const post of page.page) {
      if (post.type !== "feed") continue;
      await ctx.db.patch(post._id, { type: currentPostType(post.type, post.imageIds.length) });
      migrated++;
    }

    return { migrated, cursor: page.isDone ? null : page.continueCursor };
  },
});

/**
 * Store a brand file for every account that has none, built from its confirmed
 * facts and legacy notes. Reads already compose it on the fly; this makes it a
 * document the owner and the agents edit.
 */
/** Spend per category on existing periods, summed from their events (usageCategories.ts). */
export const usageCategories = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<{ migrated: number; cursor: string | null }> => {
    const page = await ctx.db.query("usagePeriods").paginate({ cursor, numItems: USAGE_BATCH });
    let migrated = 0;

    for (const period of page.page) {
      if (period.byCategory) continue;

      const events = await ctx.db
        .query("usageEvents")
        .withIndex("by_user_period", (q) =>
          q.eq("userId", period.userId).eq("periodKey", period.periodKey),
        )
        .collect();

      const byCategory: Record<string, number> = {};

      for (const event of events) {
        const category = categoryOfKind(event.kind);
        byCategory[category] = (byCategory[category] ?? 0) + event.microUsd;
      }

      await ctx.db.patch(period._id, { byCategory });
      migrated++;
    }

    return { migrated, cursor: page.isDone ? null : page.continueCursor };
  },
});

/**
 * Perfil reference photos predate labels: give each its old kind as a label and
 * a save time, so the reference index (and every search) finds it.
 */
export const referenceLabels = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<{ migrated: number; cursor: string | null }> => {
    const page = await ctx.db.query("images").paginate({ cursor, numItems: BATCH });
    let migrated = 0;

    for (const image of page.page) {
      if (image.purpose !== "reference" || image.referenceAddedAt !== undefined) continue;
      await ctx.db.patch(image._id, {
        referenceLabels: referenceLabelsOf(image),
        referenceAddedAt: image.createdAt,
        referenceAddedBy: "owner",
        referenceSource: "enviada",
      });
      migrated++;
    }

    return { migrated, cursor: page.isDone ? null : page.continueCursor };
  },
});

/**
 * The guide used to end once every section had an item; now it ends when the
 * owner approves. Accounts whose file was already complete keep it ended, so
 * reconnecting never sends them back to the guide.
 */
export const brandGuideDone = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<{ migrated: number; cursor: string | null }> => {
    const page = await ctx.db.query("accounts").paginate({ cursor, numItems: BRAND_FILE_BATCH });
    let migrated = 0;

    for (const account of page.page) {
      if (account.brandGuideDoneAt !== undefined || account.onboardedAt === undefined) continue;

      const sections = brandGuide(await brandFileContent(ctx, account._id));

      if (!sections.every((section) => section.filled)) continue;
      await ctx.db.patch(account._id, { brandGuideDoneAt: account.onboardedAt });
      migrated++;
    }

    return { migrated, cursor: page.isDone ? null : page.continueCursor };
  },
});

export const brandFiles = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<{ migrated: number; cursor: string | null }> => {
    const page = await ctx.db.query("accounts").paginate({ cursor, numItems: BRAND_FILE_BATCH });
    let migrated = 0;

    for (const account of page.page) if (await ensureBrandFile(ctx, account._id)) migrated++;

    return { migrated, cursor: page.isDone ? null : page.continueCursor };
  },
});

export const completed = internalQuery({
  args: {},
  handler: async (ctx): Promise<string[]> =>
    (await ctx.db.query("migrationRuns").collect()).map((run) => run.name),
});

export const markCompleted = internalMutation({
  args: { name: v.string(), migrated: v.number() },
  handler: async (ctx, { name, migrated }): Promise<void> => {
    await ctx.db.insert("migrationRuns", { name, migrated, completedAt: Date.now() });
  },
});

/** Run every pending migration to completion, in order; a no-op once all have run. */
export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ran: Record<string, number>; skipped: string[] }> => {
    const done = new Set(await ctx.runQuery(internal.migrations.completed, {}));
    const ran: Record<string, number> = {};
    const skipped: string[] = [];

    for (const { name, page } of MIGRATIONS) {
      if (done.has(name)) {
        skipped.push(name);
        continue;
      }

      let cursor: string | null = null;
      let migrated = 0;

      do {
        const result: { migrated: number; cursor: string | null } = await ctx.runMutation(page, {
          cursor,
        });

        migrated += result.migrated;
        cursor = result.cursor;
      } while (cursor !== null);

      await ctx.runMutation(internal.migrations.markCompleted, { name, migrated });
      ran[name] = migrated;
    }

    return { ran, skipped };
  },
});
