import { internalMutation } from "./_generated/server";

/**
 * Prod bootstrap sweep: the production deployment carries domain rows from
 * two schema eras ago (pre-Upload-Post accounts with connectionId/mode,
 * pre-pivot pipeline artifacts). Real signups are preserved — `users` rows
 * are Clerk mirrors and stay — while every domain table is cleared so the
 * strict schema can turn back on. Delete this file after it runs.
 */
export const wipeLegacyDomain = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tables = [
      "usageEvents",
      "usagePeriods",
      "accounts",
      "chatThreadActivity",
      "brandCanon",
      "modelRuns",
      "marketCreators",
      "marketPosts",
      "brandVisualProfiles",
      "brandSnapshots",
      "sourceDossiers",
      "creativeAnalyses",
      "creativeDirections",
      "creativeBriefs",
      "inputAssessments",
      "metricSnapshots",
      "opportunities",
      "marketRuns",
      "images",
      "codeRuns",
      "workspaceFiles",
      "workspaceFileRevisions",
      "posts",
      "scheduledPosts",
    ] as const;
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
      if (rows.length > 0) counts[table] = rows.length;
    }
    return counts;
  },
});
