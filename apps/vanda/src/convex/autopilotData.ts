import { v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  PRODUCE_AHEAD_MS,
  auditConfidences,
  auditFindingValidator,
  auditMetricsValidator,
  auditPostRefValidator,
  autopilotPostTypes,
  cadenceEntryValidator,
  rubricItemValidator,
  slotBriefFields,
  slotResultsValidator,
  FEEDBACK_WINDOW_DAYS,
  MIN_REJECTION_REASON,
  autopilotJobValidator,
  feedbackScopes,
  weekdayNames,
  type AutopilotJob,
  type FeedbackScope,
  type ApprovalMode,
  type AutopilotSlotStatus,
  type CadenceEntry,
} from "./autopilotModel";
import { brandFileContent, brandFileFacts } from "./brandFile";
import {
  DEFAULT_CADENCE,
  cadenceSummary,
  formatHour,
  isValidTime,
  localSlot,
  nextWeekStart,
  normalizeCadence,
  purposeLabels,
  slotTimestamp,
  weekStartOf,
} from "./pipeline/autopilot";
import { fitOutline } from "./pipeline/autopilotAgent";
import { cancelScheduleIn, schedulePostIn } from "./posts";
import { postPurposeValidator } from "./postPurposes";

/**
 * Autopilot state: the slot lifecycle, plan persistence and the overview the
 * Posts automáticos view, the chat card and the agents all read. Every change
 * the owner can make goes through `applySlotChange` / `applyCadence` here, so
 * the UI and Vanda/Caetano's tools can never disagree.
 *
 * Slot lifecycle: planned → generating → scheduled → published, with skipped
 * (owner veto) and failed (retried once) on the side.
 */

const MINUTE = 60 * 1000;

/** Production needs this margin before the publish time. */
const PRODUCE_MIN_LEAD_MS = 15 * MINUTE;

/** A generating slot older than this crashed mid-production. */
/** A work turn (diagnosis, plan, post) is given up after this; matches caetano.ts. */
const JOB_TIMEOUT_MS = 30 * MINUTE;

export const MAX_ATTEMPTS = 2;

const RESULTS_AFTER_MS = 48 * 60 * MINUTE;

// --------------------------------------------------------------------- config

export const getConfig = (ctx: QueryCtx, accountId: Id<"accounts">) =>
  ctx.db
    .query("autopilotConfigs")
    .withIndex("by_account", (q) => q.eq("accountId", accountId))
    .unique();

export const ensureConfig = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
): Promise<Doc<"autopilotConfigs">> => {
  const existing = await getConfig(ctx, accountId);

  if (existing) return existing;

  const now = Date.now();

  const id = await ctx.db.insert("autopilotConfigs", {
    accountId,
    enabled: false,
    cadence: [...DEFAULT_CADENCE],
    cadenceSource: "agent",
    cadenceRationale: `Ponto de partida: ${cadenceSummary(DEFAULT_CADENCE)}. O diagnóstico da conta ajusta a cadência.`,
    createdAt: now,
    updatedAt: now,
  });

  const created = await ctx.db.get(id);

  if (!created) throw new Error("configuração dos posts automáticos não foi criada");

  return created;
};

export const latestAudit = (ctx: QueryCtx, accountId: Id<"accounts">) =>
  ctx.db
    .query("accountAudits")
    .withIndex("by_account_created", (q) => q.eq("accountId", accountId))
    .order("desc")
    .first();

export const latestReadyAudit = async (ctx: QueryCtx, accountId: Id<"accounts">) => {
  for await (const audit of ctx.db
    .query("accountAudits")
    .withIndex("by_account_created", (q) => q.eq("accountId", accountId))
    .order("desc")) {
    if (audit.status === "ready") return audit;
  }

  return null;
};

const weekFor = (ctx: QueryCtx, accountId: Id<"accounts">, weekStart: number) =>
  ctx.db
    .query("autopilotWeeks")
    .withIndex("by_account_week", (q) => q.eq("accountId", accountId).eq("weekStart", weekStart))
    .unique();

const slotsOf = (ctx: QueryCtx, weekId: Id<"autopilotWeeks">) =>
  ctx.db
    .query("autopilotSlots")
    .withIndex("by_week", (q) => q.eq("weekId", weekId))
    .collect();

// ------------------------------------------------------------------- overview

const coverUrlOf = async (ctx: QueryCtx, post: Doc<"posts"> | null): Promise<string | null> => {
  const imageId = post?.imageIds[0];
  const image = imageId ? await ctx.db.get(imageId) : null;

  if (!image) return null;

  return image.externalUrl ?? (image.storageId ? await ctx.storage.getUrl(image.storageId) : null);
};

export /** Every slide of the produced post, in order, for the post viewer. */
const imageUrlsOf = async (ctx: QueryCtx, post: Doc<"posts">): Promise<string[]> => {
  const urls = await Promise.all(
    post.imageIds.map(async (imageId) => {
      const image = await ctx.db.get(imageId);

      if (!image) return null;

      return (
        image.externalUrl ?? (image.storageId ? await ctx.storage.getUrl(image.storageId) : null)
      );
    }),
  );

  return urls.filter((url): url is string => url !== null);
};

export const slotView = async (ctx: QueryCtx, slot: Doc<"autopilotSlots">) => {
  const post = slot.postId ? await ctx.db.get(slot.postId) : null;

  const scheduled = post
    ? await ctx.db
        .query("scheduledPosts")
        .withIndex("by_post", (q) => q.eq("postId", post._id))
        .first()
    : null;

  const { weekday, time } = localSlot(slot.scheduledFor);

  return {
    slotId: slot._id,
    scheduledFor: slot.scheduledFor,
    weekday,
    time,
    type: slot.type,
    slideCount: slot.slideCount,
    purpose: slot.purpose,
    purposeLabel: purposeLabels[slot.purpose],
    theme: slot.theme,
    angle: slot.angle,
    hook: slot.hook,
    slideOutline: slot.slideOutline,
    captionBrief: slot.captionBrief,
    status: slot.status,
    ownerEdited: slot.ownerEdited,
    postId: slot.postId ?? null,
    caption: post?.caption ?? null,
    coverUrl: await coverUrlOf(ctx, post),
    imageUrls: post ? await imageUrlsOf(ctx, post) : [],
    permalink: scheduled?.permalink ?? null,
    lastError: slot.lastError ?? null,
    revisionNote: slot.revisionNote ?? null,
    results: slot.results ?? null,
  };
};

export type AutopilotSlotView = Awaited<ReturnType<typeof slotView>>;

const weekLabel = (weekStart: number): string => {
  const local = new Date(weekStart - 3 * 60 * MINUTE);

  return `${String(local.getUTCDate()).padStart(2, "0")}/${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
};

const weekView = async (ctx: QueryCtx, accountId: Id<"accounts">, weekStart: number) => {
  const week = await weekFor(ctx, accountId, weekStart);
  const slots = week ? await slotsOf(ctx, week._id) : [];

  return {
    weekStart,
    label: weekLabel(weekStart),
    status: week?.status ?? null,
    strategy: week?.strategy ?? null,
    lastError: week?.status === "failed" ? (week.lastError ?? "o planejamento não terminou") : null,
    slots: await Promise.all(
      slots.toSorted((a, b) => a.scheduledFor - b.scheduledFor).map((slot) => slotView(ctx, slot)),
    ),
  };
};

export type AutopilotWeekView = Awaited<ReturnType<typeof weekView>>;

const auditView = (audit: Doc<"accountAudits"> | null) =>
  audit && {
    auditId: audit._id,
    status: audit.status,
    createdAt: audit.createdAt,
    completedAt: audit.completedAt ?? null,
    confidence: audit.confidence ?? null,
    profileScore: audit.profileScore ?? null,
    summary: audit.summary ?? null,
    rubric: audit.rubric ?? [],
    findings: audit.findings ?? [],
    stop: audit.stop ?? [],
    doMore: audit.doMore ?? [],
    needs: audit.needs ?? [],
    metrics: audit.metrics ?? null,
    top: audit.top ?? [],
    bottom: audit.bottom ?? [],
    lastError: audit.lastError ?? null,
  };

/** Everything the view, the chat card and the agents show, in one read. */
export const overviewOf = async (ctx: QueryCtx, accountId: Id<"accounts">, now: number) => {
  const account = await ctx.db.get(accountId);
  const config = await getConfig(ctx, accountId);
  const cadence = config?.cadence ?? [...DEFAULT_CADENCE];
  const latest = await latestAudit(ctx, accountId);
  const ready = latest?.status === "ready" ? latest : await latestReadyAudit(ctx, accountId);
  const current = weekStartOf(now);

  return {
    accountId,
    handle: account?.handle ?? null,
    connected: account?.publisherConnectedAt !== undefined,
    enabled: config?.enabled ?? false,
    cadence,
    cadenceSource: config?.cadenceSource ?? "agent",
    cadenceRationale: config?.cadenceRationale ?? null,
    cadenceSummary: cadenceSummary(cadence),
    approval: config?.approval ?? "required",
    feedbackStats: {
      ...(await feedbackStatsOf(ctx, accountId, now)),
      windowDays: FEEDBACK_WINDOW_DAYS,
    },
    // What the owner taught lives in the brand file, the business's only memory.
    learned: brandFileFacts(await brandFileContent(ctx, accountId))
      .filter((fact) => LEARNED_SECTIONS.has(fact.kind))
      .map((fact) => ({ section: fact.kind, text: fact.text })),
    auditRunning: latest?.status === "running",
    // The newest diagnosis failed: what the page shows next to "Tentar de novo".
    auditError:
      latest?.status === "failed" ? (latest.lastError ?? "a análise da conta não terminou") : null,
    audit: auditView(ready),
    weeks: [
      await weekView(ctx, accountId, current),
      await weekView(ctx, accountId, nextWeekStart(now)),
    ],
  };
};

export type AutopilotOverview = Awaited<ReturnType<typeof overviewOf>>;

export const overviewInternal = internalQuery({
  args: { accountId: v.id("accounts"), now: v.number() },
  handler: (ctx, { accountId, now }): Promise<AutopilotOverview> => overviewOf(ctx, accountId, now),
});

/** Past weeks with per-slot results, newest first. */
export const historyOf = async (ctx: QueryCtx, accountId: Id<"accounts">, now: number) => {
  const weeks = await ctx.db
    .query("autopilotWeeks")
    .withIndex("by_account_week", (q) =>
      q.eq("accountId", accountId).lt("weekStart", weekStartOf(now)),
    )
    .order("desc")
    .take(8);

  return Promise.all(weeks.map((week) => weekView(ctx, accountId, week.weekStart)));
};

// ------------------------------------------------------------ owner changes

const assertOwnedSlot = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  slotId: Id<"autopilotSlots">,
): Promise<Doc<"autopilotSlots">> => {
  const slot = await ctx.db.get(slotId);

  if (!slot || slot.accountId !== accountId) throw new Error("post automático não encontrado");

  return slot;
};

/**
 * Disarms a scheduled autopilot post; the draft stays linked to its slot. A
 * schedule that is already gone (deleted or cancelled elsewhere) is fine; one
 * already publishing cannot be stopped and says so.
 */
const disarm = async (ctx: MutationCtx, slot: Doc<"autopilotSlots">): Promise<void> => {
  if (!slot.postId || slot.status !== "scheduled") return;

  const post = await ctx.db.get(slot.postId);

  const scheduled = post
    ? await ctx.db
        .query("scheduledPosts")
        .withIndex("by_post", (q) => q.eq("postId", post._id))
        .first()
    : null;

  if (!scheduled) return;

  if (scheduled.status !== "scheduled")
    throw new Error("esse post já está sendo publicado; não dá mais para segurar");

  await cancelScheduleIn(ctx, { accountId: slot.accountId, postId: slot.postId, autopilot: true });
};

/** Whether the owner approved this slot's current post (approval mode on). */
const ownerApproved = async (ctx: QueryCtx, slot: Doc<"autopilotSlots">): Promise<boolean> => {
  const decisions = await ctx.db
    .query("autopilotFeedback")
    .withIndex("by_slot", (q) => q.eq("slotId", slot._id))
    .collect();

  return decisions.some(
    (decision) => decision.decision === "approved" && decision.postId === slot.postId,
  );
};

/** Starts production right away when the slot is already inside the 24h window. */
const produceIfDue = async (
  ctx: MutationCtx,
  slotId: Id<"autopilotSlots">,
  scheduledFor: number,
) => {
  const now = Date.now();

  if (scheduledFor - now <= PRODUCE_AHEAD_MS && scheduledFor - now > PRODUCE_MIN_LEAD_MS) {
    await ctx.scheduler.runAfter(0, internal.autopilotData.startProduction, { slotId });
  }
};

/**
 * The owner just discarded a produced version (refused it or changed its brief):
 * they are waiting for the new one, so it is produced now, not at the 24h mark.
 */
const produceAgainNow = async (
  ctx: MutationCtx,
  slotId: Id<"autopilotSlots">,
  scheduledFor: number,
) => {
  if (scheduledFor - Date.now() > PRODUCE_MIN_LEAD_MS)
    await ctx.scheduler.runAfter(0, internal.autopilotData.startProduction, { slotId });
};

export const slotChangeValidator = v.object({
  weekday: v.optional(v.number()),
  time: v.optional(v.string()),
  type: v.optional(v.union(...autopilotPostTypes.map((type) => v.literal(type)))),
  slideCount: v.optional(v.number()),
  purpose: v.optional(postPurposeValidator),
  theme: v.optional(v.string()),
  angle: v.optional(v.string()),
  hook: v.optional(v.string()),
  slideOutline: v.optional(v.array(v.string())),
  captionBrief: v.optional(v.string()),
});

export type SlotChange = Infer<typeof slotChangeValidator>;

const CONTENT_FIELDS = [
  "type",
  "slideCount",
  "purpose",
  "theme",
  "angle",
  "hook",
  "slideOutline",
  "captionBrief",
] as const;

/**
 * The owner's edit of one slot. A new time re-aims an already scheduled post;
 * a content change discards the produced post (it stays a hidden draft) and
 * produces again.
 */
export const applySlotChange = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  slotId: Id<"autopilotSlots">,
  change: SlotChange,
): Promise<AutopilotSlotStatus> => {
  const slot = await assertOwnedSlot(ctx, accountId, slotId);

  if (slot.status === "published") throw new Error("esse post já foi publicado");

  if (slot.status === "generating")
    throw new Error("esse post está sendo gerado agora; tente de novo em alguns minutos");

  const current = localSlot(slot.scheduledFor);
  const weekday = change.weekday ?? current.weekday;
  const time = change.time ?? current.time;

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("dia inválido");

  if (!isValidTime(time)) throw new Error("horário inválido; use HH:mm");

  const scheduledFor = slotTimestamp(weekStartOf(slot.scheduledFor), weekday, time);

  if (scheduledFor !== slot.scheduledFor && scheduledFor <= Date.now() + 5 * MINUTE)
    throw new Error("o novo horário já passou");

  const type = change.type ?? slot.type;

  const [entry] = normalizeCadence([
    { weekday, time, type, slideCount: change.slideCount ?? slot.slideCount },
  ]);

  const slideCount = entry?.slideCount ?? 1;

  const contentChanged =
    CONTENT_FIELDS.some(
      (field) =>
        change[field] !== undefined &&
        JSON.stringify(change[field]) !== JSON.stringify(slot[field]),
    ) || slideCount !== slot.slideCount;

  // A new subject without a new outline leaves the slides to Caetano (the old outline is stale).
  const subjectChanged = (["purpose", "theme", "angle", "hook"] as const).some(
    (field) => change[field] !== undefined && change[field] !== slot[field],
  );

  const outline = (change.slideOutline ?? (subjectChanged ? [] : slot.slideOutline)).slice(
    0,
    slideCount,
  );

  await ctx.db.patch(slotId, {
    scheduledFor,
    type,
    slideCount,
    purpose: change.purpose ?? slot.purpose,
    theme: change.theme ?? slot.theme,
    angle: change.angle ?? slot.angle,
    hook: change.hook ?? slot.hook,
    slideOutline: outline,
    captionBrief: change.captionBrief ?? slot.captionBrief,
    ownerEdited: true,
    updatedAt: Date.now(),
  });

  let status = slot.status;

  if (contentChanged && slot.postId) {
    // The produced post no longer matches the brief: keep it as a hidden draft, produce again now.
    await disarm(ctx, slot);
    status = slot.status === "skipped" ? "skipped" : "planned";
    await ctx.db.patch(slotId, { status, postId: undefined, attempts: 0, lastError: undefined });

    if (status === "planned") {
      await produceAgainNow(ctx, slotId, scheduledFor);

      return status;
    }
  } else if (scheduledFor !== slot.scheduledFor && slot.postId && slot.status === "scheduled") {
    await schedulePostIn(ctx, { accountId, postId: slot.postId, scheduledFor, autopilot: true });
  } else if (slot.status === "failed") {
    status = "planned";
    await ctx.db.patch(slotId, { status, attempts: 0, lastError: undefined });
  }

  if (status === "planned") await produceIfDue(ctx, slotId, scheduledFor);

  return status;
};

/** Owner veto: the post will not publish; its draft stays for a later restore. */
export const applySkip = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  slotId: Id<"autopilotSlots">,
): Promise<void> => {
  const slot = await assertOwnedSlot(ctx, accountId, slotId);

  if (slot.status === "published") throw new Error("esse post já foi publicado");

  await disarm(ctx, slot);
  await ctx.db.patch(slotId, { status: "skipped", ownerEdited: true, updatedAt: Date.now() });
};

export const applyRestore = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  slotId: Id<"autopilotSlots">,
): Promise<AutopilotSlotStatus> => {
  const slot = await assertOwnedSlot(ctx, accountId, slotId);

  if (slot.status !== "skipped") return slot.status;

  if (slot.scheduledFor <= Date.now() + 5 * MINUTE)
    throw new Error("o horário desse post já passou");

  if (slot.postId) {
    // Restoring is not approving: an unapproved post goes back to waiting for the owner.
    if ((await approvalRequired(ctx, accountId)) && !(await ownerApproved(ctx, slot))) {
      await ctx.db.patch(slotId, { status: "awaiting_approval", updatedAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.autopilotChat.notifyProduced, { slotId });

      return "awaiting_approval";
    }

    await schedulePostIn(ctx, {
      accountId,
      postId: slot.postId,
      scheduledFor: slot.scheduledFor,
      autopilot: true,
    });
    await ctx.db.patch(slotId, { status: "scheduled", updatedAt: Date.now() });

    return "scheduled";
  }

  await ctx.db.patch(slotId, { status: "planned", attempts: 0, updatedAt: Date.now() });
  await produceIfDue(ctx, slotId, slot.scheduledFor);

  return "planned";
};

/** Throws the produced post away (kept as a hidden draft) and produces again now. */
export const applyRegenerate = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  slotId: Id<"autopilotSlots">,
): Promise<void> => {
  const slot = await assertOwnedSlot(ctx, accountId, slotId);

  if (slot.status === "published") throw new Error("esse post já foi publicado");

  if (slot.status === "generating") throw new Error("esse post já está sendo gerado");

  if (!(await getConfig(ctx, accountId))?.enabled)
    throw new Error("os posts automáticos estão pausados; ligue para gerar");

  if (slot.scheduledFor <= Date.now() + PRODUCE_MIN_LEAD_MS)
    throw new Error("não há tempo para gerar de novo antes do horário");

  await disarm(ctx, slot);
  await ctx.db.patch(slotId, {
    status: "planned",
    postId: undefined,
    attempts: 0,
    lastError: undefined,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.autopilotData.startProduction, { slotId });
};

/** Replans the current and next week; `audit` refreshes the diagnosis first. */
export const requestRefresh = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  audit: boolean,
): Promise<void> => {
  const now = Date.now();

  if (audit) await requestAudit(ctx, accountId);

  // A paused autopilot can be diagnosed, but nothing gets planned for it.
  if (!(await getConfig(ctx, accountId))?.enabled) return;

  for (const weekStart of [weekStartOf(now), nextWeekStart(now)])
    await requestPlan(ctx, accountId, weekStart);
};

/** Sunday cron: a fresh diagnosis and next week's plan for every enabled account. */
export const planAllAccounts = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const configs = await ctx.db
      .query("autopilotConfigs")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();

    const weekStart = nextWeekStart(Date.now());

    for (const config of configs) {
      await requestAudit(ctx, config.accountId);
      await requestPlan(ctx, config.accountId, weekStart);
    }
  },
});

export const applyCadence = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  entries: readonly CadenceEntry[],
): Promise<CadenceEntry[]> => {
  const cadence = normalizeCadence(entries);

  if (cadence.length === 0) throw new Error("a cadência precisa de pelo menos um post válido");

  const config = await ensureConfig(ctx, accountId);

  await ctx.db.patch(config._id, {
    cadence,
    cadenceSource: "owner",
    cadenceRationale: "Definida por você.",
    updatedAt: Date.now(),
  });

  if (config.enabled) await requestRefresh(ctx, accountId, false);

  return cadence;
};

export const applyResetCadence = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
): Promise<void> => {
  const config = await ensureConfig(ctx, accountId);
  const audit = await latestReadyAudit(ctx, accountId);

  const recommended = audit?.recommendedCadence?.length
    ? audit.recommendedCadence
    : DEFAULT_CADENCE;

  await ctx.db.patch(config._id, {
    cadence: normalizeCadence(recommended),
    cadenceSource: "agent",
    cadenceRationale: audit?.cadenceRationale ?? config.cadenceRationale,
    updatedAt: Date.now(),
  });

  if (config.enabled) await requestRefresh(ctx, accountId, false);
};

export const applyEnabled = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  enabled: boolean,
): Promise<void> => {
  const config = await ensureConfig(ctx, accountId);

  if (config.enabled === enabled) return;

  await ctx.db.patch(config._id, { enabled, updatedAt: Date.now() });

  if (enabled) {
    await restorePaused(ctx, accountId);
    await requestRefresh(ctx, accountId, true);

    return;
  }

  // Turning it off stops every pending publication; published history stays.
  const pending = await ctx.db
    .query("autopilotSlots")
    .withIndex("by_account_scheduledFor", (q) =>
      q.eq("accountId", accountId).gte("scheduledFor", Date.now()),
    )
    .collect();

  for (const slot of pending) {
    if (!PAUSABLE.has(slot.status)) continue;

    await disarm(ctx, slot);
    await ctx.db.patch(slot._id, { status: "skipped", lastError: PAUSED, updatedAt: Date.now() });
  }
};

const PAUSED = "posts automáticos pausados";

const PAUSABLE: ReadonlySet<AutopilotSlotStatus> = new Set([
  "scheduled",
  "planned",
  "failed",
  "awaiting_approval",
]);

/** Turning back on brings back what the pause skipped, so the week is not left empty. */
const restorePaused = async (ctx: MutationCtx, accountId: Id<"accounts">): Promise<void> => {
  const now = Date.now();

  const paused = (
    await ctx.db
      .query("autopilotSlots")
      .withIndex("by_account_scheduledFor", (q) =>
        q.eq("accountId", accountId).gte("scheduledFor", now + PRODUCE_MIN_LEAD_MS),
      )
      .collect()
  ).filter((slot) => slot.status === "skipped" && slot.lastError === PAUSED);

  for (const slot of paused) {
    if (slot.postId) {
      await ctx.db.patch(slot._id, { status: "generating", lastError: undefined, updatedAt: now });
      await finishProduction(ctx, slot._id, slot.postId);
    } else {
      await ctx.db.patch(slot._id, { status: "planned", lastError: undefined, updatedAt: now });
      await produceIfDue(ctx, slot._id, slot.scheduledFor);
    }
  }
};

// Internal entry points for the agents' tools (they run in actions).

export const setEnabledInternal = internalMutation({
  args: { accountId: v.id("accounts"), enabled: v.boolean() },
  handler: (ctx, { accountId, enabled }) => applyEnabled(ctx, accountId, enabled),
});

export const updateSlotInternal = internalMutation({
  args: {
    accountId: v.id("accounts"),
    slotId: v.id("autopilotSlots"),
    change: slotChangeValidator,
  },
  handler: (ctx, { accountId, slotId, change }) => applySlotChange(ctx, accountId, slotId, change),
});

export const skipSlotInternal = internalMutation({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots") },
  handler: (ctx, { accountId, slotId }) => applySkip(ctx, accountId, slotId),
});

export const restoreSlotInternal = internalMutation({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots") },
  handler: (ctx, { accountId, slotId }) => applyRestore(ctx, accountId, slotId),
});

export const regenerateSlotInternal = internalMutation({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots") },
  handler: (ctx, { accountId, slotId }) => applyRegenerate(ctx, accountId, slotId),
});

export const reanalyzeInternal = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: (ctx, { accountId }) => requestRefresh(ctx, accountId, true),
});

// ------------------------------------------------------------------- feedback

/** Unset counts as "required": nothing publishes without the owner's approval. */
export const approvalRequired = async (ctx: QueryCtx, accountId: Id<"accounts">) =>
  (await getConfig(ctx, accountId))?.approval !== "auto";

export const applyApprovalMode = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  approval: ApprovalMode,
): Promise<void> => {
  const config = await ensureConfig(ctx, accountId);

  await ctx.db.patch(config._id, { approval, updatedAt: Date.now() });

  if (approval !== "required") return;

  // Turning approval on holds what was armed without it: those posts wait for the owner too.
  const armed = await ctx.db
    .query("autopilotSlots")
    .withIndex("by_account_scheduledFor", (q) =>
      q.eq("accountId", accountId).gt("scheduledFor", Date.now()),
    )
    .collect();

  for (const slot of armed) {
    if (slot.status !== "scheduled" || (await ownerApproved(ctx, slot))) continue;

    await disarm(ctx, slot);
    await ctx.db.patch(slot._id, { status: "awaiting_approval", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.autopilotChat.notifyProduced, { slotId: slot._id });
  }
};

/** Brand file sections where the owner's taste is written (marca.md). */
const LEARNED_SECTIONS = new Set(["Preferências", "Nunca fazer"]);

/** Approvals vs rejections over the last 30 days: how close Caetano is to the owner's taste. */
const feedbackStatsOf = async (ctx: QueryCtx, accountId: Id<"accounts">, now: number) => {
  const rows = await ctx.db
    .query("autopilotFeedback")
    .withIndex("by_account_created", (q) =>
      q.eq("accountId", accountId).gte("createdAt", now - FEEDBACK_WINDOW_DAYS * 24 * 60 * MINUTE),
    )
    .collect();

  return {
    approved: rows.filter((row) => row.decision === "approved").length,
    rejected: rows.filter((row) => row.decision === "rejected").length,
  };
};

/** The owner accepts the produced post: it is armed for its time. */
export const applyApprove = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  slotId: Id<"autopilotSlots">,
): Promise<void> => {
  const slot = await assertOwnedSlot(ctx, accountId, slotId);

  if (slot.status !== "awaiting_approval" || !slot.postId)
    throw new Error("esse post não está aguardando aceite");

  if (slot.scheduledFor <= Date.now() + MINUTE) throw new Error("o horário desse post já passou");

  await schedulePostIn(ctx, {
    accountId,
    postId: slot.postId,
    scheduledFor: slot.scheduledFor,
    autopilot: true,
  });
  await ctx.db.patch(slotId, { status: "scheduled", lastError: undefined, updatedAt: Date.now() });
  await ctx.db.insert("autopilotFeedback", {
    accountId,
    slotId,
    postId: slot.postId,
    decision: "approved",
    createdAt: Date.now(),
  });
};

/**
 * The owner refuses the produced post and says why, and whether it holds for
 * every post or only this one. The decision is recorded; a general one is
 * written to the brand file by the agent. The post is produced again with the
 * reason as its revision note while there is time.
 */
export const applyReject = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  slotId: Id<"autopilotSlots">,
  reason: string,
  scope: FeedbackScope,
): Promise<AutopilotSlotStatus> => {
  const slot = await assertOwnedSlot(ctx, accountId, slotId);
  const why = reason.trim();

  if (why.length < MIN_REJECTION_REASON)
    throw new Error("diga o motivo da recusa: é ele que ensina o Caetano");

  if (slot.status !== "awaiting_approval" && slot.status !== "scheduled")
    throw new Error("só dá para recusar um post já gerado e ainda não publicado");

  await disarm(ctx, slot);

  const feedbackId = await ctx.db.insert("autopilotFeedback", {
    accountId,
    slotId,
    decision: "rejected",
    reason: why,
    scope,
    createdAt: Date.now(),
  });

  if (slot.postId) await ctx.db.patch(feedbackId, { postId: slot.postId });

  const time = slot.scheduledFor > Date.now() + PRODUCE_MIN_LEAD_MS;
  const status: AutopilotSlotStatus = time ? "planned" : "skipped";

  await ctx.db.patch(slotId, {
    status,
    postId: undefined,
    revisionNote: why,
    attempts: 0,
    lastError: time ? undefined : "recusado sem tempo para refazer antes do horário",
    updatedAt: Date.now(),
  });

  if (time) await produceAgainNow(ctx, slotId, slot.scheduledFor);

  return status;
};

export const approveSlotInternal = internalMutation({
  args: { accountId: v.id("accounts"), slotId: v.id("autopilotSlots") },
  handler: (ctx, { accountId, slotId }) => applyApprove(ctx, accountId, slotId),
});

export const rejectSlotInternal = internalMutation({
  args: {
    accountId: v.id("accounts"),
    slotId: v.id("autopilotSlots"),
    reason: v.string(),
    scope: v.union(...feedbackScopes.map((scope) => v.literal(scope))),
  },
  handler: (ctx, { accountId, slotId, reason, scope }) =>
    applyReject(ctx, accountId, slotId, reason, scope),
});

// ---------------------------------------------------------------------- audit

export const auditInputs = internalQuery({
  args: { accountId: v.id("accounts"), now: v.number() },
  handler: async (ctx, { accountId, now }) => {
    const account = await ctx.db.get(accountId);
    const previousAudit = await latestReadyAudit(ctx, accountId);

    const recent = await ctx.db
      .query("autopilotSlots")
      .withIndex("by_account_scheduledFor", (q) =>
        q
          .eq("accountId", accountId)
          .gte("scheduledFor", now - 28 * 24 * 60 * MINUTE)
          .lt("scheduledFor", now),
      )
      .collect();

    return {
      handle: account?.handle ?? null,
      connected: account?.publisherConnectedAt !== undefined,
      previousSummary: previousAudit?.summary ?? null,
      previous: recent
        .filter((slot) => slot.status === "published")
        .map((slot) => ({
          scheduledFor: slot.scheduledFor,
          type: slot.type,
          slideCount: slot.slideCount,
          purpose: slot.purpose,
          hook: slot.hook,
          outlier: slot.results?.outlier,
          reach: slot.results?.reach,
          shares: slot.results?.shares,
          saves: slot.results?.saves,
        })),
    };
  },
});

/** A diagnosis is ready; an agent-owned cadence follows it. */
const finishAudit = async (
  ctx: MutationCtx,
  audit: Doc<"accountAudits">,
  fields: Omit<Partial<Doc<"accountAudits">>, "_id" | "_creationTime" | "accountId">,
): Promise<void> => {
  await ctx.db.patch(audit._id, { ...fields, status: "ready", completedAt: Date.now() });

  const config = await getConfig(ctx, audit.accountId);
  const cadence = fields.recommendedCadence ?? [];

  if (config?.cadenceSource === "agent" && cadence.length > 0) {
    await ctx.db.patch(config._id, {
      cadence: normalizeCadence(cadence),
      cadenceRationale: fields.cadenceRationale,
      updatedAt: Date.now(),
    });
  }
};

// ----------------------------------------------------------------------- plan

const KEPT_STATUSES: ReadonlySet<AutopilotSlotStatus> = new Set([
  "generating",
  "awaiting_approval",
  "scheduled",
  "published",
  "skipped",
]);

/** Slots a replan must not touch: owner-edited, already produced, or vetoed. */
const isKept = (slot: Doc<"autopilotSlots">): boolean =>
  slot.ownerEdited || slot.postId !== undefined || KEPT_STATUSES.has(slot.status);

const sameSlot = (slot: Doc<"autopilotSlots">, entry: CadenceEntry): boolean => {
  const local = localSlot(slot.scheduledFor);

  return local.weekday === entry.weekday && local.time === entry.time;
};

export const planInputs = internalQuery({
  args: { accountId: v.id("accounts"), weekStart: v.number() },
  handler: (ctx, { accountId, weekStart }) => planInputsOf(ctx, accountId, weekStart),
});

/** What a week's plan starts from: cadence, owner-fixed briefs, diagnosis, recent themes. */
const planInputsOf = async (ctx: QueryCtx, accountId: Id<"accounts">, weekStart: number) => {
  const config = await getConfig(ctx, accountId);
  const audit = await latestReadyAudit(ctx, accountId);
  const week = await weekFor(ctx, accountId, weekStart);
  const slots = week ? await slotsOf(ctx, week._id) : [];

  const recent = await ctx.db
    .query("autopilotSlots")
    .withIndex("by_account_scheduledFor", (q) =>
      q
        .eq("accountId", accountId)
        .gte("scheduledFor", weekStart - 14 * 24 * 60 * MINUTE)
        .lt("scheduledFor", weekStart),
    )
    .collect();

  const cadence = config?.cadence ?? [...DEFAULT_CADENCE];

  return {
    enabled: config?.enabled ?? false,
    cadence,
    auditId: audit?._id ?? null,
    audit: audit && {
      summary: audit.summary,
      profileScore: audit.profileScore,
      findings: audit.findings,
      stop: audit.stop,
      doMore: audit.doMore,
      needs: audit.needs,
    },
    fixed: cadence.flatMap((entry, index) => {
      const kept = slots.find((slot) => isKept(slot) && sameSlot(slot, entry));

      return kept
        ? [
            {
              index,
              brief: {
                purpose: kept.purpose,
                theme: kept.theme,
                angle: kept.angle,
                hook: kept.hook,
                slideOutline: kept.slideOutline,
                captionBrief: kept.captionBrief,
              },
            },
          ]
        : [];
    }),
    recentThemes: recent.map((slot) => `${slot.theme} — ${slot.angle}`),
  };
};

const planEntryValidator = v.object({
  weekday: v.number(),
  time: v.string(),
  type: v.union(...autopilotPostTypes.map((type) => v.literal(type))),
  slideCount: v.number(),
  ...slotBriefFields,
});

export const savePlan = internalMutation({
  args: {
    accountId: v.id("accounts"),
    weekStart: v.number(),
    auditId: v.union(v.id("accountAudits"), v.null()),
    strategy: v.string(),
    entries: v.array(planEntryValidator),
  },
  handler: (ctx, args) => applyPlan(ctx, args),
});

const applyPlan = async (
  ctx: MutationCtx,
  {
    accountId,
    weekStart,
    auditId,
    strategy,
    entries,
  }: {
    accountId: Id<"accounts">;
    weekStart: number;
    auditId: Id<"accountAudits"> | null;
    strategy: string;
    entries: Infer<typeof planEntryValidator>[];
  },
) => {
  const now = Date.now();
  let week = await weekFor(ctx, accountId, weekStart);

  if (week) {
    await ctx.db.patch(week._id, {
      status: "planned",
      strategy,
      lastError: undefined,
      updatedAt: now,
    });
  } else {
    const weekId = await ctx.db.insert("autopilotWeeks", {
      accountId,
      weekStart,
      status: "planned",
      strategy,
      createdAt: now,
      updatedAt: now,
    });

    week = await ctx.db.get(weekId);
  }

  if (week && auditId) await ctx.db.patch(week._id, { auditId });

  if (!week) throw new Error("semana não foi criada");

  const existing = await slotsOf(ctx, week._id);
  const kept = existing.filter(isKept);

  for (const slot of existing) {
    if (!isKept(slot)) await ctx.db.delete(slot._id);
  }

  // A produced slot the new cadence no longer has would publish off-plan.
  for (const slot of kept) {
    if (slot.ownerEdited || slot.status !== "scheduled") continue;

    if (entries.some((entry) => sameSlot(slot, entry))) continue;

    await disarm(ctx, slot);
    await ctx.db.patch(slot._id, {
      status: "skipped",
      lastError: "fora da nova cadência",
      updatedAt: now,
    });
  }

  let created = 0;

  for (const entry of entries) {
    if (kept.some((slot) => sameSlot(slot, entry))) continue;

    const scheduledFor = slotTimestamp(weekStart, entry.weekday, entry.time);

    if (scheduledFor <= now + PRODUCE_MIN_LEAD_MS) continue;

    const slotId = await ctx.db.insert("autopilotSlots", {
      accountId,
      weekId: week._id,
      scheduledFor,
      type: entry.type,
      slideCount: entry.slideCount,
      purpose: entry.purpose,
      theme: entry.theme,
      angle: entry.angle,
      hook: entry.hook,
      slideOutline: entry.slideOutline,
      captionBrief: entry.captionBrief,
      status: "planned",
      ownerEdited: false,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });

    created += 1;
    await produceIfDue(ctx, slotId, scheduledFor);
  }

  return { weekId: week._id, created };
};

// ----------------------------------------------------------------- production

/** Claims a due slot and asks Caetano to make its post, in his thread. */
export const startProduction = internalMutation({
  args: { slotId: v.id("autopilotSlots") },
  handler: async (ctx, { slotId }): Promise<void> => {
    const slot = await ctx.db.get(slotId);

    if (!slot || (slot.status !== "planned" && slot.status !== "failed")) return;

    const config = await getConfig(ctx, slot.accountId);

    if (!config?.enabled) return;

    const account = await ctx.db.get(slot.accountId);

    if (account?.publisherConnectedAt === undefined) {
      await ctx.db.patch(slotId, {
        status: "failed",
        attempts: MAX_ATTEMPTS,
        lastError: "Conecte o Instagram em Perfil › Conexões para o Caetano publicar.",
        updatedAt: Date.now(),
      });

      return;
    }

    await ctx.db.patch(slotId, {
      status: "generating",
      attempts: slot.attempts + 1,
      lastError: undefined,
      productionStartedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await enqueueJob(
      ctx,
      {
        kind: "post",
        accountId: slot.accountId,
        slotId,
        weekStart: weekStartOf(slot.scheduledFor),
      },
      postJobPrompt(slot, account),
    );
  },
});

/** The post exists: it waits for the owner's approval, or is armed for its time. */
const finishProduction = async (
  ctx: MutationCtx,
  slotId: Id<"autopilotSlots">,
  postId: Id<"posts">,
): Promise<AutopilotSlotStatus | null> => {
  const slot = await ctx.db.get(slotId);

  if (!slot) return null;

  if (slot.status !== "generating") {
    // Skipped mid-production: keep the draft so a restore can publish it.
    if (slot.status === "skipped" && !slot.postId)
      await ctx.db.patch(slotId, { postId, updatedAt: Date.now() });

    return slot.status;
  }

  // Paused while it was being made: the post is kept for when it comes back on.
  if (!(await getConfig(ctx, slot.accountId))?.enabled) {
    await ctx.db.patch(slotId, {
      status: "skipped",
      postId,
      lastError: PAUSED,
      updatedAt: Date.now(),
    });

    return "skipped";
  }

  if (slot.scheduledFor <= Date.now() + MINUTE) {
    await ctx.db.patch(slotId, {
      status: "failed",
      postId,
      lastError: "o post ficou pronto depois do horário; ele ficou salvo como rascunho",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.autopilotChat.notifyFailed, { slotId });

    return "failed";
  }

  // The rejection reason did its job in this production; the post now waits for its verdict.
  if (await approvalRequired(ctx, slot.accountId)) {
    await ctx.db.patch(slotId, {
      status: "awaiting_approval",
      postId,
      revisionNote: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.autopilotChat.notifyProduced, { slotId });

    return "awaiting_approval";
  }

  await schedulePostIn(ctx, {
    accountId: slot.accountId,
    postId,
    scheduledFor: slot.scheduledFor,
    autopilot: true,
  });
  await ctx.db.patch(slotId, {
    status: "scheduled",
    postId,
    revisionNote: undefined,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.autopilotChat.notifyProduced, { slotId });

  return "scheduled";
};

const failProduction = async (ctx: MutationCtx, slotId: Id<"autopilotSlots">, error: string) => {
  const slot = await ctx.db.get(slotId);

  if (!slot || slot.status !== "generating") return;

  await ctx.db.patch(slotId, {
    status: "failed",
    lastError: error.slice(0, 500),
    updatedAt: Date.now(),
  });

  // The hourly tick retries once; only the final failure reaches the owner.
  const noRetry =
    slot.attempts >= MAX_ATTEMPTS || slot.scheduledFor <= Date.now() + PRODUCE_MIN_LEAD_MS;

  if (noRetry) await ctx.scheduler.runAfter(0, internal.autopilotChat.notifyFailed, { slotId });
};

// ----------------------------------------------------------------------- jobs

/** autopilot_measure_account: the numbers land on the running diagnosis. */
export const saveMeasurement = internalMutation({
  args: {
    accountId: v.id("accounts"),
    confidence: v.union(...auditConfidences.map((c) => v.literal(c))),
    metrics: auditMetricsValidator,
    top: v.array(auditPostRefValidator),
    bottom: v.array(auditPostRefValidator),
  },
  handler: async (ctx, { accountId, ...measured }): Promise<void> => {
    const audit = await latestAudit(ctx, accountId);

    if (audit?.status !== "running")
      throw new Error("não há diagnóstico em andamento; peça um com autopilot_reanalyze");

    await ctx.db.patch(audit._id, measured);
  },
});

/**
 * autopilot_save_audit: Caetano's judgement completes the measured diagnosis.
 * The profile score comes from his rubric; the numbers stay the measured ones.
 */
export const saveAuditJudgement = internalMutation({
  args: {
    accountId: v.id("accounts"),
    rubric: v.array(rubricItemValidator),
    postNotes: v.array(v.object({ postId: v.string(), why: v.string() })),
    findings: v.array(auditFindingValidator),
    stop: v.array(v.string()),
    doMore: v.array(v.string()),
    needs: v.array(v.string()),
    summary: v.string(),
    recommendedCadence: v.array(cadenceEntryValidator),
    cadenceRationale: v.string(),
  },
  handler: async (ctx, { accountId, rubric, postNotes, ...judgement }): Promise<number> => {
    const audit = await latestAudit(ctx, accountId);

    if (audit?.status !== "running")
      throw new Error("não há diagnóstico em andamento; peça um com autopilot_reanalyze");

    if (!audit.metrics || !audit.confidence)
      throw new Error("meça a conta antes com autopilot_measure_account");

    // Only what was actually seen counts: missing data is not a low score.
    const scored = rubric.filter((item) => item.max > 0 && item.observed !== false);
    const max = scored.reduce((sum, item) => sum + item.max, 0);
    const got = scored.reduce((sum, item) => sum + Math.min(item.max, Math.max(0, item.score)), 0);
    const profileScore = max > 0 ? Math.round((got / max) * 100) : 0;
    const notes = new Map(postNotes.map((note) => [note.postId, note.why]));

    const withWhy = (refs: Doc<"accountAudits">["top"]) =>
      (refs ?? []).map((ref) => {
        const why = notes.get(ref.externalPostId);

        return why ? { ...ref, why } : ref;
      });

    await finishAudit(ctx, audit, {
      profileScore,
      rubric,
      top: withWhy(audit.top),
      bottom: withWhy(audit.bottom),
      ...judgement,
      recommendedCadence: normalizeCadence(judgement.recommendedCadence),
    });

    return profileScore;
  },
});

/**
 * autopilot_save_plan: Caetano's briefs, one per cadence slot of the job's
 * week. Owner-fixed slots keep their brief whatever he sends.
 */
export const savePlanFromJob = internalMutation({
  args: {
    accountId: v.id("accounts"),
    weekStart: v.number(),
    strategy: v.string(),
    slots: v.array(
      v.object({
        index: v.number(),
        purpose: postPurposeValidator,
        theme: v.string(),
        angle: v.string(),
        hook: v.string(),
        slideOutline: v.array(v.string()),
        captionBrief: v.string(),
      }),
    ),
  },
  handler: async (ctx, { accountId, weekStart, strategy, slots }): Promise<number> => {
    const inputs = await planInputsOf(ctx, accountId, weekStart);
    const fixed = new Map(inputs.fixed.map((item) => [item.index, item.brief]));
    const byIndex = new Map(slots.map((slot) => [slot.index, slot]));

    const missing = inputs.cadence
      .map((_, index) => index)
      .filter((index) => !fixed.has(index) && !byIndex.has(index));

    if (missing.length > 0)
      throw new Error(
        `faltam os slots ${missing.join(", ")} da cadência (${cadenceSummary(inputs.cadence)})`,
      );

    const entries = inputs.cadence.map((entry, index) => {
      const fixedBrief = fixed.get(index);
      const sent = byIndex.get(index)!;
      const brief = fixedBrief ?? sent;

      return {
        ...entry,
        purpose: brief.purpose,
        theme: brief.theme,
        angle: brief.angle,
        hook: brief.hook,
        captionBrief: brief.captionBrief,
        slideOutline: fitOutline(brief.slideOutline, entry.slideCount, brief.hook),
      };
    });

    const saved = await applyPlan(ctx, {
      accountId,
      weekStart,
      auditId: inputs.auditId,
      strategy,
      entries,
    });

    if (saved.created > 0)
      await ctx.scheduler.runAfter(0, internal.autopilotChat.announcePlan, {
        accountId,
        weekStart,
      });

    return saved.created;
  },
});

/** Whether this slot's post is still queued or running in Caetano's thread. */
const jobPending = async (ctx: QueryCtx, slot: Doc<"autopilotSlots">): Promise<boolean> => {
  const account = await ctx.db.get(slot.accountId);

  if (!account?.ownerUserId) return false;

  const ownerId = account.ownerUserId;

  for (const status of ["queued", "running"] as const) {
    const rows = await ctx.db
      .query("caetanoInbox")
      .withIndex("by_user_status", (q) => q.eq("userId", ownerId).eq("status", status))
      .collect();

    if (rows.some((row) => row.autopilotJob?.slotId === slot._id)) return true;
  }

  return false;
};

/** Caetano works on the posts automáticos in the owner's thread, like any turn. */
const enqueueJob = async (ctx: MutationCtx, job: AutopilotJob, prompt: string) => {
  const account = await ctx.db.get(job.accountId);

  if (!account?.ownerUserId) {
    await settleJob(ctx, job, "Este negócio não tem dono para o Caetano trabalhar.");

    return;
  }

  await ctx.runMutation(internal.caetano.submitJob, {
    userId: account.ownerUserId,
    job,
    prompt,
  });
};

const JOB_LABELS = { audit: "Diagnóstico", plan: "Plano da semana", post: "Post" } as const;

/** Hidden marker the chat groups by week (see components/caetano/work-group.tsx). */
const jobRef = (job: AutopilotJob, label: string = JOB_LABELS[job.kind]): string =>
  `<caetano_ref>autopilot tarefa=${job.kind}${
    job.weekStart === undefined ? "" : ` semana=${weekLabel(job.weekStart)}`
  }${job.slotId ? ` slotId=${job.slotId}` : ""} rótulo="${label}"</caetano_ref>`;

const accountName = (account: Doc<"accounts"> | null): string =>
  account?.handle ? `@${account.handle}` : (account?.name ?? "o negócio");

const auditJobPrompt = (job: AutopilotJob, account: Doc<"accounts"> | null): string =>
  [
    `Faça o diagnóstico da conta ${accountName(account)} para os posts automáticos.`,
    "Meça com autopilot_measure_account, siga a habilidade instagram-account-audit e grave com autopilot_save_audit.",
    jobRef(job),
  ].join("\n");

const planJobPrompt = (
  job: AutopilotJob,
  weekStart: number,
  account: Doc<"accounts"> | null,
): string =>
  [
    `Planeje os posts automáticos da semana de ${weekLabel(weekStart)} (${accountName(account)}).`,
    "Veja a cadência, os posts fixados pelo dono, o diagnóstico e os temas recentes com autopilot_read, siga a habilidade instagram-weekly-plan e grave com autopilot_save_plan.",
    jobRef(job),
  ].join("\n");

const postJobPrompt = (slot: Doc<"autopilotSlots">, account: Doc<"accounts"> | null): string => {
  const { weekday, time } = localSlot(slot.scheduledFor);
  const outline = slot.slideOutline.filter((line) => line.trim() !== "");

  return [
    `Crie o post automático de ${weekdayNames[weekday]} ${formatHour(time)} (${accountName(account)}).`,
    "É uma versão nova: pinte cada slide com paint e termine com create_post neste turno. Rascunhos anteriores deste post foram descartados e não contam.",
    `- Formato: ${slot.type === "carousel" ? `carrossel de ${slot.slideCount} slides` : "imagem única"}, 4:5`,
    `- Propósito: ${slot.purpose} (${purposeLabels[slot.purpose]})`,
    `- Tema: ${slot.theme}`,
    `- Ângulo: ${slot.angle}`,
    `- Gancho da capa: ${slot.hook}`,
    outline.length > 0
      ? `- Roteiro sugerido (se divergir do tema e do ângulo, siga o tema):\n${outline.map((line, index) => `  ${index + 1}. ${line}`).join("\n")}`
      : "- Roteiro: livre, decida pelas habilidades a partir do tema e do ângulo.",
    `- Legenda: ${slot.captionBrief}`,
    ...(slot.revisionNote
      ? [`- O dono recusou a versão anterior: "${slot.revisionNote}". Resolva exatamente isso.`]
      : []),
    jobRef(
      {
        kind: "post",
        accountId: slot.accountId,
        slotId: slot._id,
        weekStart: weekStartOf(slot.scheduledFor),
      },
      `${weekdayNames[weekday]} ${formatHour(time)}`,
    ),
  ].join("\n");
};

/** Asks Caetano for a fresh diagnosis; one at a time per account. */
const requestAudit = async (ctx: MutationCtx, accountId: Id<"accounts">): Promise<void> => {
  const latest = await latestAudit(ctx, accountId);

  // One at a time; a crashed one stops blocking once its turn would have expired.
  if (latest?.status === "running" && Date.now() - latest.createdAt < JOB_TIMEOUT_MS) return;

  await ctx.db.insert("accountAudits", { accountId, status: "running", createdAt: Date.now() });

  const job: AutopilotJob = { kind: "audit", accountId };

  await enqueueJob(ctx, job, auditJobPrompt(job, await ctx.db.get(accountId)));
};

/** Asks Caetano to plan a week; the week shows "planning" until he saves it. */
const requestPlan = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  weekStart: number,
): Promise<void> => {
  const now = Date.now();
  const week = await weekFor(ctx, accountId, weekStart);

  // Already asked and still within its turn: one plan per week at a time.
  if (week?.status === "planning" && now - week.updatedAt < JOB_TIMEOUT_MS) return;

  if (week) await ctx.db.patch(week._id, { status: "planning", updatedAt: now });
  else
    await ctx.db.insert("autopilotWeeks", {
      accountId,
      weekStart,
      status: "planning",
      createdAt: now,
      updatedAt: now,
    });

  const job: AutopilotJob = { kind: "plan", accountId, weekStart };

  await enqueueJob(ctx, job, planJobPrompt(job, weekStart, await ctx.db.get(accountId)));
};

/**
 * The work turn ended (done, stopped or expired). Whatever Caetano did not
 * save is settled here, so nothing stays "generating" or "planning".
 */
export const completeJob = internalMutation({
  args: { job: autopilotJobValidator, error: v.optional(v.string()) },
  handler: (ctx, { job, error }) => settleJob(ctx, job, error),
});

const settleJob = async (ctx: MutationCtx, job: AutopilotJob, error?: string): Promise<void> => {
  const now = Date.now();

  if (job.kind === "audit") {
    const latest = await latestAudit(ctx, job.accountId);

    if (latest?.status === "running")
      await ctx.db.patch(latest._id, {
        status: "failed",
        lastError: error ?? "O Caetano não concluiu o diagnóstico.",
        completedAt: now,
      });

    return;
  }

  if (job.kind === "plan") {
    const week =
      job.weekStart === undefined ? null : await weekFor(ctx, job.accountId, job.weekStart);

    if (week?.status === "planning") {
      const planned = (await slotsOf(ctx, week._id)).length > 0;

      await ctx.db.patch(week._id, {
        status: planned ? "planned" : "failed",
        lastError: error ?? "O Caetano não concluiu o plano da semana.",
        updatedAt: now,
      });
    }

    return;
  }

  const slot = job.slotId ? await ctx.db.get(job.slotId) : null;

  if (!slot) return;

  // The post Caetano made in this turn (create_post links it to the slot).
  const post = await ctx.db
    .query("posts")
    .withIndex("by_autopilot_slot", (q) => q.eq("autopilotSlotId", slot._id))
    .order("desc")
    .first();

  if (post && post._creationTime >= (slot.productionStartedAt ?? Infinity))
    await finishProduction(ctx, slot._id, post._id);
  else await failProduction(ctx, slot._id, error ?? "O Caetano não concluiu o post.");
};

// ----------------------------------------------------------------------- tick

/** Slots inside the production window, plus one retry of failed ones. */
export const dueSlots = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }): Promise<Id<"autopilotSlots">[]> => {
    const window = (status: "planned" | "failed") =>
      ctx.db
        .query("autopilotSlots")
        .withIndex("by_status_scheduledFor", (q) =>
          q
            .eq("status", status)
            .gt("scheduledFor", now + PRODUCE_MIN_LEAD_MS)
            .lte("scheduledFor", now + PRODUCE_AHEAD_MS),
        )
        .collect();

    const candidates = [
      ...(await window("planned")),
      ...(await window("failed")).filter((slot) => slot.attempts < MAX_ATTEMPTS),
    ];

    const due: Id<"autopilotSlots">[] = [];

    for (const slot of candidates) {
      if ((await getConfig(ctx, slot.accountId))?.enabled) due.push(slot._id);
    }

    return due;
  },
});

/** Planned slots whose time came without production, and crashed productions. */
export const expireStale = internalMutation({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    // No approval by the publish time: nothing goes out without the owner.
    const unanswered = await ctx.db
      .query("autopilotSlots")
      .withIndex("by_status_scheduledFor", (q) =>
        q.eq("status", "awaiting_approval").lte("scheduledFor", now + MINUTE),
      )
      .collect();

    for (const slot of unanswered) {
      await ctx.db.patch(slot._id, {
        status: "skipped",
        lastError: "não publicado: ficou sem aceite até o horário",
        updatedAt: now,
      });
    }

    const missed = await ctx.db
      .query("autopilotSlots")
      .withIndex("by_status_scheduledFor", (q) =>
        q
          .eq("status", "planned")
          .gt("scheduledFor", now - 7 * 24 * 60 * MINUTE)
          .lte("scheduledFor", now + PRODUCE_MIN_LEAD_MS),
      )
      .collect();

    for (const slot of missed) {
      await ctx.db.patch(slot._id, {
        status: "failed",
        attempts: MAX_ATTEMPTS,
        lastError: "não deu tempo de gerar antes do horário",
        updatedAt: now,
      });
    }

    const generating = await ctx.db
      .query("autopilotSlots")
      .withIndex("by_status_scheduledFor", (q) => q.eq("status", "generating"))
      .collect();

    for (const slot of generating) {
      // Still waiting in Caetano's queue, or within its turn: leave it.
      if (now - (slot.productionStartedAt ?? slot.updatedAt) < JOB_TIMEOUT_MS) continue;

      if (await jobPending(ctx, slot)) continue;

      await ctx.db.patch(slot._id, {
        status: "failed",
        lastError: "a geração foi interrompida",
        updatedAt: now,
      });
    }
  },
});

// -------------------------------------------------------------------- results

export const resultsDue = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const published = await ctx.db
      .query("autopilotSlots")
      .withIndex("by_status_scheduledFor", (q) =>
        q
          .eq("status", "published")
          .gt("scheduledFor", now - 30 * 24 * 60 * MINUTE)
          .lte("scheduledFor", now - RESULTS_AFTER_MS),
      )
      .collect();

    const due = [];

    for (const slot of published) {
      if (slot.results || !slot.postId) continue;

      const scheduled = await ctx.db
        .query("scheduledPosts")
        .withIndex("by_post", (q) => q.eq("postId", slot.postId!))
        .first();

      const account = await ctx.db.get(slot.accountId);
      const audit = await latestReadyAudit(ctx, slot.accountId);

      if (!scheduled?.externalPostId || !account?.handle) continue;

      due.push({
        slotId: slot._id,
        accountId: slot.accountId,
        handle: account.handle,
        externalPostId: scheduled.externalPostId,
        medianReach: audit?.metrics?.medianReach ?? null,
      });

      if (due.length >= 10) break;
    }

    return due;
  },
});

export const saveResults = internalMutation({
  args: { slotId: v.id("autopilotSlots"), results: slotResultsValidator },
  handler: async (ctx, { slotId, results }) => {
    await ctx.db.patch(slotId, { results, updatedAt: Date.now() });
  },
});
