import { v } from "convex/values";
import type { FunctionReference } from "convex/server";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { currentPostType } from "./pipeline/constants";

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

type MigrationPage = FunctionReference<
  "mutation",
  "internal",
  { cursor: string | null },
  { migrated: number; cursor: string | null }
>;

const MIGRATIONS: ReadonlyArray<{ name: string; page: MigrationPage }> = [
  { name: "feedToCarousel", page: internal.migrations.feedToCarousel },
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
