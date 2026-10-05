"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { uploadPostInstagramProviderLayer } from "./instagram/providers/uploadpost";
import { ConnectedInstagramProvider } from "./instagram/service";
import { definedOnly, nextWeekStart } from "./pipeline/autopilot";
import {
  auditAccount,
  classifyRejection,
  collectAccountEvidence,
  composeSlot,
  planWeek,
  renderAuditSummary,
  repairCaption,
  type PlannedSlotBrief,
} from "./pipeline/autopilotAgent";
import { renderBrandContext } from "./pipeline/brandContext";
import { lintCaption, lintProblems } from "./pipeline/captionLint";
import { languageModelLayer, PIPELINE_MODELS, PROMPT_VERSIONS } from "./pipeline/liveModel";
import { runTracked } from "./pipeline/liveTelemetry";
import { weekdayNames } from "./autopilotModel";
import { errorMessage } from "../errors";

/**
 * The autopilot's background work: diagnose the account, plan a week, and
 * produce each slot ~24h before it publishes. Production is deterministic —
 * one structured composition (copy, visual briefs, caption) then `paint` per
 * slide — so it never needs a conversation and can't schedule by itself:
 * scheduling happens in `finishProduction`, after the owner's veto check.
 */

const FORMAT = "4:5";

/** A failure whose message is written for the owner; anything else shows catalogued copy. */
class AutopilotStop extends Error {}

const openRouterKey = (): string => {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");

  return apiKey;
};

const brandText = async (ctx: ActionCtx, accountId: Id<"accounts">): Promise<string> =>
  renderBrandContext(await ctx.runQuery(internal.brandContext.load, { accountId }));

// ---------------------------------------------------------------------- audit

const runAudit = async (ctx: ActionCtx, accountId: Id<"accounts">): Promise<void> => {
  const auditId = await ctx.runMutation(internal.autopilotData.startAudit, { accountId });

  if (!auditId) return;

  try {
    const now = Date.now();
    const inputs = await ctx.runQuery(internal.autopilotData.auditInputs, { accountId, now });

    if (!inputs.connected || !inputs.handle)
      throw new AutopilotStop("Conecte o Instagram para a Vanda analisar a conta.");

    const brand = await brandText(ctx, accountId);

    const target = {
      scope: "connected" as const,
      publisherUsername: String(accountId),
      handle: inputs.handle,
    };

    const result = await runTracked(
      ctx,
      {
        accountId,
        stage: "autopilot_audit",
        model: PIPELINE_MODELS.autopilotAudit,
        promptVersion: PROMPT_VERSIONS.autopilotAudit,
        inputIds: [inputs.handle],
      },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const evidence = yield* collectAccountEvidence(target);

            return yield* auditAccount({
              brand,
              evidence,
              previous: inputs.previous,
              previousSummary: inputs.previousSummary ?? undefined,
              now,
            });
          }).pipe(
            Effect.provide(languageModelLayer(openRouterKey(), PIPELINE_MODELS.autopilotAudit)),
            Effect.provide(uploadPostInstagramProviderLayer),
          ),
        ),
      (audit) => `${audit.metrics.sampleSize} posts; nota ${audit.profileScore}`,
    );

    const notes = new Map(result.output.postNotes.map((note) => [note.postId, note.why]));

    const ref = (item: (typeof result.top)[number]) =>
      definedOnly({
        externalPostId: item.post.id,
        url: item.post.url,
        caption: (item.post.caption ?? "").slice(0, 300),
        format: item.post.mediaType,
        publishedAt: item.post.publishedAt,
        reach: result.basis === "reach" ? item.value : undefined,
        outlier: item.outlier,
        why: notes.get(item.post.id),
      });

    await ctx.runMutation(internal.autopilotData.finishAudit, {
      auditId,
      confidence: result.confidence,
      metrics: {
        ...result.metrics,
        byFormat: [...result.metrics.byFormat],
        byHour: [...result.metrics.byHour],
      },
      profileScore: result.profileScore,
      rubric: result.output.rubric.map((item) => ({ ...item })),
      top: result.top.map(ref),
      bottom: result.bottom.map(ref),
      findings: result.output.findings.map((finding) => ({ ...finding })),
      stop: [...result.output.stop],
      doMore: [...result.output.doMore],
      needs: [...result.output.needs],
      summary: result.output.summary,
      recommendedCadence: [...result.recommendedCadence],
      cadenceRationale: result.output.cadenceRationale,
    });
  } catch (error) {
    console.error("Autopilot audit failed", { accountId, error });
    await ctx.runMutation(internal.autopilotData.failAudit, {
      auditId,
      error: error instanceof AutopilotStop ? error.message : errorMessage(error),
    });
  }
};

// ----------------------------------------------------------------------- plan

const weekLabelOf = (weekStart: number): string => {
  const local = new Date(weekStart - 3 * 60 * 60 * 1000);

  return `semana de ${String(local.getUTCDate()).padStart(2, "0")}/${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
};

const runPlan = async (
  ctx: ActionCtx,
  accountId: Id<"accounts">,
  weekStart: number,
): Promise<number> => {
  try {
    const inputs = await ctx.runQuery(internal.autopilotData.planInputs, { accountId, weekStart });

    if (!inputs.enabled) return 0;

    const brand = await brandText(ctx, accountId);

    const fixed = new Map<number, PlannedSlotBrief>(
      inputs.fixed.map((item) => [item.index, item.brief]),
    );

    const plan = await runTracked(
      ctx,
      {
        accountId,
        stage: "autopilot_plan",
        model: PIPELINE_MODELS.autopilotPlan,
        promptVersion: PROMPT_VERSIONS.autopilotPlan,
        inputIds: [String(weekStart)],
      },
      () =>
        Effect.runPromise(
          planWeek({
            brand,
            auditSummary: inputs.audit ? renderAuditSummary(inputs.audit) : "",
            cadence: inputs.cadence,
            fixed,
            recentThemes: inputs.recentThemes,
            weekLabel: weekLabelOf(weekStart),
            rules: inputs.rules,
          }).pipe(
            Effect.provide(languageModelLayer(openRouterKey(), PIPELINE_MODELS.autopilotPlan)),
          ),
        ),
      (result) => `${result.briefs.length} posts`,
    );

    const saved = await ctx.runMutation(internal.autopilotData.savePlan, {
      accountId,
      weekStart,
      auditId: inputs.auditId,
      strategy: plan.strategy,
      entries: inputs.cadence.map((entry, index) => {
        const brief = plan.briefs[index]!;

        return { ...entry, ...brief, slideOutline: [...brief.slideOutline] };
      }),
    });

    return saved.created;
  } catch (error) {
    console.error("Autopilot plan failed", { accountId, weekStart, error });
    await ctx.runMutation(internal.autopilotData.failPlan, {
      accountId,
      weekStart,
      error: error instanceof AutopilotStop ? error.message : errorMessage(error),
    });

    return 0;
  }
};

/** Diagnose (optionally) then plan the given weeks, then tell the owner. */
export const refresh = internalAction({
  args: { accountId: v.id("accounts"), weekStarts: v.array(v.number()), audit: v.boolean() },
  handler: async (ctx, { accountId, weekStarts, audit }): Promise<void> => {
    if (audit) await runAudit(ctx, accountId);

    let announced: number | null = null;

    for (const weekStart of weekStarts) {
      if ((await runPlan(ctx, accountId, weekStart)) > 0) announced = weekStart;
    }

    if (announced !== null)
      await ctx.runMutation(internal.autopilotChat.announcePlan, {
        accountId,
        weekStart: announced,
      });
  },
});

/** Sunday cron: diagnose every enabled account and plan its next week. */
export const planAllAccounts = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const accounts = await ctx.runQuery(internal.autopilotData.enabledAccounts, {});
    const weekStart = nextWeekStart(Date.now());

    // Staggered so a large fleet doesn't hit the providers at once.
    for (const [index, accountId] of accounts.entries()) {
      await ctx.scheduler.runAfter(index * 15_000, internal.autopilotNode.refresh, {
        accountId,
        weekStarts: [weekStart],
        audit: true,
      });
    }
  },
});

// ----------------------------------------------------------------- production

export const produceSlot = internalAction({
  args: { slotId: v.id("autopilotSlots") },
  handler: async (ctx, { slotId }): Promise<void> => {
    const slot = await ctx.runMutation(internal.autopilotData.claimSlot, { slotId });

    if (!slot) return;

    const { accountId } = slot;

    try {
      const [brand, brandKit, references] = await Promise.all([
        brandText(ctx, accountId),
        ctx.runQuery(internal.brandContext.kit, { accountId }),
        ctx.runQuery(internal.autopilotData.referenceImages, { accountId }),
      ]);

      const brief: PlannedSlotBrief = {
        purpose: slot.purpose,
        theme: slot.theme,
        angle: slot.angle,
        hook: slot.hook,
        slideOutline: slot.slideOutline,
        captionBrief: slot.captionBrief,
      };

      const model = languageModelLayer(openRouterKey(), PIPELINE_MODELS.studioCarouselPlan);

      const composed = await runTracked(
        ctx,
        {
          accountId,
          stage: "studio_carousel_plan",
          model: PIPELINE_MODELS.studioCarouselPlan,
          promptVersion: PROMPT_VERSIONS.studioCarouselPlan,
          inputIds: [slotId],
        },
        () =>
          Effect.runPromise(
            composeSlot({
              brand,
              brandKit: brandKit ? JSON.stringify(brandKit) : null,
              type: slot.type,
              slideCount: slot.slideCount,
              format: FORMAT,
              brief,
              references,
              whenLabel: `${weekdayNames[slot.weekday]} ${slot.time}`,
              rules: slot.rules,
              revisionNote: slot.revisionNote,
            }).pipe(Effect.provide(model)),
          ),
        (result) => `${result.slides.length} slides`,
      );

      let caption = composed.caption.trim();
      const lint = lintCaption(caption);

      if (lint.verdict === "FIX") {
        caption = (
          await Effect.runPromise(
            repairCaption(caption, lintProblems(lint)).pipe(Effect.provide(model)),
          )
        ).trim();

        const second = lintCaption(caption);

        if (second.verdict === "FIX")
          throw new AutopilotStop(`legenda reprovada: ${lintProblems(second)}`);
      }

      const referenceIds = references.map((reference) => reference.id);
      const imageIds: Id<"images">[] = [];

      // Slide 1 sets the look; every later slide takes it as style reference.
      for (const [index, slide] of composed.slides.entries()) {
        const painted = await ctx.runAction(internal.images.paint, {
          accountId,
          prompt: slide.prompt,
          aspectRatio: FORMAT,
          referenceImageIds: index === 0 ? referenceIds : [imageIds[0]!, ...referenceIds],
          name: `Piloto · ${slot.hook} · ${index + 1}/${slot.slideCount}`,
          promptAuthor: "vanda",
        });

        imageIds.push(painted.imageId);
      }

      const postId = await ctx.runMutation(internal.posts.createPostInternal, {
        accountId,
        imageIds,
        caption,
        type: slot.type,
        format: FORMAT,
        purpose: slot.purpose,
        rationale: composed.rationale,
        autopilotSlotId: slotId,
      });

      await ctx.runMutation(internal.autopilotData.finishProduction, { slotId, postId });
    } catch (error) {
      console.error("Autopilot production failed", { slotId, error });
      await ctx.runMutation(internal.autopilotData.failProduction, {
        slotId,
        error: error instanceof AutopilotStop ? error.message : errorMessage(error),
      });
    }
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

/** Hourly: expire stale slots, produce what is due, collect results. */
export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const now = Date.now();

    await ctx.runMutation(internal.autopilotData.expireStale, { now });

    const due = await ctx.runQuery(internal.autopilotData.dueSlots, { now });

    for (const [index, slotId] of due.entries()) {
      await ctx.scheduler.runAfter(index * 5_000, internal.autopilotNode.produceSlot, { slotId });
    }

    await collectResults(ctx, now);
  },
});

// ------------------------------------------------------------------- feedback

/** Decides whether a rejection teaches a general rule or only concerns that post. */
export const classifyFeedback = internalAction({
  args: { feedbackId: v.id("autopilotFeedback") },
  handler: async (ctx, { feedbackId }): Promise<void> => {
    const inputs = await ctx.runQuery(internal.autopilotData.feedbackInputs, { feedbackId });

    if (!inputs) return;

    try {
      const result = await runTracked(
        ctx,
        {
          accountId: inputs.accountId,
          stage: "autopilot_feedback",
          model: PIPELINE_MODELS.autopilotFeedback,
          promptVersion: PROMPT_VERSIONS.autopilotFeedback,
          inputIds: [feedbackId],
        },
        () =>
          Effect.runPromise(
            classifyRejection(inputs).pipe(
              Effect.provide(languageModelLayer(openRouterKey(), PIPELINE_MODELS.autopilotFeedback)),
            ),
          ),
        (scope) => `${scope.scope}: ${scope.rule || scope.why}`,
      );

      const rule = result.rule.trim();

      await ctx.runMutation(internal.autopilotData.setFeedbackScope, {
        feedbackId,
        scope: result.scope === "geral" && rule ? "geral" : "post",
        rule,
      });
    } catch (error) {
      // Unclassified stays "pending": it still shaped the redo of its own post.
      console.error("Autopilot feedback classification failed", { feedbackId, error });
    }
  },
});
