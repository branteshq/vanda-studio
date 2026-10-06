"use node";

import { v, type Infer } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { uploadPostInstagramProviderLayer } from "./instagram/providers/uploadpost";
import { ConnectedInstagramProvider } from "./instagram/service";
import type { AuditMetrics, auditPostRefValidator } from "./autopilotModel";
import { definedOnly } from "./pipeline/autopilot";
import { collectAccountEvidence, measureAccount } from "./pipeline/autopilotAgent";

/**
 * The posts automáticos' Instagram reads, which need Node: measuring the
 * account for a diagnosis and collecting each published post's results. The
 * diagnosis, the plan and the posts themselves are Caetano's turns.
 */

type PostRef = Infer<typeof auditPostRefValidator>;

/** What Caetano judges the account from (autopilot_measure_account's result). */
export interface AccountMeasurementReport {
  readonly handle: string;
  readonly name: string | null;
  readonly followers: number | null;
  readonly postsRead: number;
  readonly feedPosts: number;
  readonly basis: string;
  readonly confidence: string;
  readonly metrics: AuditMetrics;
  readonly best: readonly PostRef[];
  readonly worst: readonly PostRef[];
  readonly previousAutopilotPosts: readonly unknown[];
  readonly previousSummary: string | null;
}

/**
 * Measures the connected account and stores the numbers on the running
 * diagnosis (autopilot_measure_account). Returns what Caetano judges from.
 */
export const measureForAudit = internalAction({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<AccountMeasurementReport> => {
    const now = Date.now();
    const inputs = await ctx.runQuery(internal.autopilotData.auditInputs, { accountId, now });

    if (!inputs.connected || !inputs.handle)
      throw new Error("Conecte o Instagram em Perfil › Conexões para analisar a conta.");

    const evidence = await Effect.runPromise(
      collectAccountEvidence({
        scope: "connected",
        publisherUsername: String(accountId),
        handle: inputs.handle,
      }).pipe(Effect.provide(uploadPostInstagramProviderLayer)),
    );

    const measured = measureAccount(evidence, now);

    const ref = (item: (typeof measured.top)[number]) =>
      definedOnly({
        externalPostId: item.post.id,
        url: item.post.url,
        caption: (item.post.caption ?? "").slice(0, 300),
        format: item.post.mediaType,
        publishedAt: item.post.publishedAt,
        reach: measured.basis === "reach" ? item.value : undefined,
        outlier: item.outlier,
      });

    const top = measured.top.map(ref);
    const bottom = measured.bottom.map(ref);

    await ctx.runMutation(internal.autopilotData.saveMeasurement, {
      accountId,
      confidence: measured.confidence,
      metrics: {
        ...measured.metrics,
        byFormat: [...measured.metrics.byFormat],
        byHour: [...measured.metrics.byHour],
      },
      top,
      bottom,
    });

    return {
      handle: inputs.handle,
      name: evidence.profile?.name ?? null,
      followers: evidence.followers ?? null,
      postsRead: evidence.posts.length,
      feedPosts: evidence.feedPosts.length,
      basis: measured.basis === "reach" ? "alcance privado" : "interações públicas",
      confidence: measured.confidence,
      metrics: measured.metrics,
      best: top,
      worst: bottom,
      previousAutopilotPosts: inputs.previous,
      previousSummary: inputs.previousSummary,
    };
  },
});

// ----------------------------------------------------------------------- tick

const collectResults = async (ctx: ActionCtx, now: number): Promise<void> => {
  const due = await ctx.runQuery(internal.autopilotData.resultsDue, { now });

  for (const item of due) {
    const target = {
      scope: "connected" as const,
      publisherUsername: String(item.accountId),
      handle: item.handle,
    };

    const insights = await Effect.runPromise(
      Effect.flatMap(ConnectedInstagramProvider, (provider) =>
        provider.readInsights(target, item.externalPostId),
      ).pipe(
        Effect.map((result) => result.data),
        Effect.provide(uploadPostInstagramProviderLayer),
        Effect.orElseSucceed(() => null),
      ),
    );

    if (!insights) continue;

    const reach = insights.privateInsights.reach;

    await ctx.runMutation(internal.autopilotData.saveResults, {
      slotId: item.slotId,
      results: definedOnly({
        observedAt: now,
        reach,
        likes: insights.publicEngagement.likes,
        comments: insights.publicEngagement.comments,
        saves: insights.privateInsights.saves,
        shares: insights.publicEngagement.shares,
        outlier:
          reach !== undefined && item.medianReach
            ? Math.round((reach / item.medianReach) * 100) / 100
            : undefined,
      }),
    });
  }
};

/** Hourly: expire stale slots, ask Caetano for what is due, collect results. */
export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const now = Date.now();

    await ctx.runMutation(internal.autopilotData.expireStale, { now });

    const due = await ctx.runQuery(internal.autopilotData.dueSlots, { now });

    for (const [index, slotId] of due.entries()) {
      await ctx.scheduler.runAfter(index * 5_000, internal.autopilotData.startProduction, {
        slotId,
      });
    }

    await collectResults(ctx, now);
  },
});
