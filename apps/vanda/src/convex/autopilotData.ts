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
  type AutopilotSlotStatus,
  type CadenceEntry,
} from "./autopilotModel";
import {
  DEFAULT_CADENCE,
  cadenceSummary,
  isValidTime,
  localSlot,
  nextWeekStart,
  normalizeCadence,
  purposeLabels,
  slotTimestamp,
  weekStartOf,
} from "./pipeline/autopilot";
import { cancelScheduleIn, schedulePostIn } from "./posts";
import { postPurposeValidator } from "./postPurposes";

/**
 * Autopilot state: the slot lifecycle, plan persistence and the overview the
 * Piloto automático view, the chat card and the agents all read. Every change
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
const GENERATING_TIMEOUT_MS = 30 * MINUTE;

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
    cadenceRationale:
      "Ponto de partida: terça e quinta à noite e sábado ao meio-dia. O diagnóstico da conta ajusta a cadência.",
    createdAt: now,
    updatedAt: now,
  });

  const created = await ctx.db.get(id);

  if (!created) throw new Error("configuração do piloto não foi criada");

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

const slotView = async (ctx: QueryCtx, slot: Doc<"autopilotSlots">) => {
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
    permalink: scheduled?.permalink ?? null,
    lastError: slot.lastError ?? null,
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
    auditRunning: latest?.status === "running",
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

  if (!slot || slot.accountId !== accountId) throw new Error("post do piloto não encontrado");

  return slot;
};

/** Disarms a scheduled autopilot post; the draft stays linked to its slot. */
const disarm = async (ctx: MutationCtx, slot: Doc<"autopilotSlots">): Promise<void> => {
  if (!slot.postId || slot.status !== "scheduled") return;

  await cancelScheduleIn(ctx, { accountId: slot.accountId, postId: slot.postId });
};

/** Starts production right away when the slot is already inside the 24h window. */
const produceIfDue = async (
  ctx: MutationCtx,
  slotId: Id<"autopilotSlots">,
  scheduledFor: number,
) => {
  const now = Date.now();

  if (scheduledFor - now <= PRODUCE_AHEAD_MS && scheduledFor - now > PRODUCE_MIN_LEAD_MS) {
    await ctx.scheduler.runAfter(0, internal.autopilotNode.produceSlot, { slotId });
  }
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

  const outline = (change.slideOutline ?? slot.slideOutline).slice(0, slideCount);

  while (outline.length < slideCount) outline.push(change.hook ?? slot.hook);

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
    // The produced post no longer matches the brief: keep it as a hidden draft, produce again.
    await disarm(ctx, slot);
    status = slot.status === "skipped" ? "skipped" : "planned";
    await ctx.db.patch(slotId, { status, postId: undefined, attempts: 0, lastError: undefined });
  } else if (scheduledFor !== slot.scheduledFor && slot.postId && slot.status === "scheduled") {
    await schedulePostIn(ctx, { accountId, postId: slot.postId, scheduledFor });
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
    await schedulePostIn(ctx, { accountId, postId: slot.postId, scheduledFor: slot.scheduledFor });
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
  await ctx.scheduler.runAfter(0, internal.autopilotNode.produceSlot, { slotId });
};

/** Replans the current and next week; `audit` refreshes the diagnosis first. */
export const requestRefresh = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  audit: boolean,
): Promise<void> => {
  const now = Date.now();

  await ctx.scheduler.runAfter(0, internal.autopilotNode.refresh, {
    accountId,
    weekStarts: [weekStartOf(now), nextWeekStart(now)],
    audit,
  });
};

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
    if (slot.status !== "scheduled" && slot.status !== "planned" && slot.status !== "failed")
      continue;

    await disarm(ctx, slot);
    await ctx.db.patch(slot._id, {
      status: "skipped",
      lastError: "piloto automático desligado",
      updatedAt: Date.now(),
    });
  }
};

// Internal entry points for the agents' tools (they run in actions).

export const setEnabledInternal = internalMutation({
  args: { accountId: v.id("accounts"), enabled: v.boolean() },
  handler: (ctx, { accountId, enabled }) => applyEnabled(ctx, accountId, enabled),
});

export const updateCadenceInternal = internalMutation({
  args: { accountId: v.id("accounts"), cadence: v.array(cadenceEntryValidator) },
  handler: (ctx, { accountId, cadence }) => applyCadence(ctx, accountId, cadence),
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

// ---------------------------------------------------------------------- audit

export const startAudit = internalMutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<Id<"accountAudits"> | null> => {
    const latest = await latestAudit(ctx, accountId);

    // One audit at a time; a crashed one stops blocking after 10 minutes.
    if (latest?.status === "running" && Date.now() - latest.createdAt < 10 * MINUTE) return null;

    return ctx.db.insert("accountAudits", {
      accountId,
      status: "running",
      createdAt: Date.now(),
    });
  },
});

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

export const finishAudit = internalMutation({
  args: {
    auditId: v.id("accountAudits"),
    confidence: v.union(...auditConfidences.map((c) => v.literal(c))),
    metrics: auditMetricsValidator,
    profileScore: v.number(),
    rubric: v.array(rubricItemValidator),
    top: v.array(auditPostRefValidator),
    bottom: v.array(auditPostRefValidator),
    findings: v.array(auditFindingValidator),
    stop: v.array(v.string()),
    doMore: v.array(v.string()),
    needs: v.array(v.string()),
    summary: v.string(),
    recommendedCadence: v.array(cadenceEntryValidator),
    cadenceRationale: v.string(),
  },
  handler: async (ctx, { auditId, ...fields }) => {
    const audit = await ctx.db.get(auditId);

    if (!audit) return;

    await ctx.db.patch(auditId, { ...fields, status: "ready", completedAt: Date.now() });

    // An agent-owned cadence follows the newest diagnosis.
    const config = await getConfig(ctx, audit.accountId);

    if (config?.cadenceSource === "agent" && fields.recommendedCadence.length > 0) {
      await ctx.db.patch(config._id, {
        cadence: normalizeCadence(fields.recommendedCadence),
        cadenceRationale: fields.cadenceRationale,
        updatedAt: Date.now(),
      });
    }
  },
});

export const failAudit = internalMutation({
  args: { auditId: v.id("accountAudits"), error: v.string() },
  handler: async (ctx, { auditId, error }) => {
    await ctx.db.patch(auditId, {
      status: "failed",
      lastError: error.slice(0, 500),
      completedAt: Date.now(),
    });
  },
});

// ----------------------------------------------------------------------- plan

const KEPT_STATUSES: ReadonlySet<AutopilotSlotStatus> = new Set([
  "generating",
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
  handler: async (ctx, { accountId, weekStart }) => {
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
  },
});

export const savePlan = internalMutation({
  args: {
    accountId: v.id("accounts"),
    weekStart: v.number(),
    auditId: v.union(v.id("accountAudits"), v.null()),
    strategy: v.string(),
    entries: v.array(
      v.object({
        weekday: v.number(),
        time: v.string(),
        type: v.union(...autopilotPostTypes.map((type) => v.literal(type))),
        slideCount: v.number(),
        ...slotBriefFields,
      }),
    ),
  },
  handler: async (ctx, { accountId, weekStart, auditId, strategy, entries }) => {
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
  },
});

export const failPlan = internalMutation({
  args: { accountId: v.id("accounts"), weekStart: v.number(), error: v.string() },
  handler: async (ctx, { accountId, weekStart, error }) => {
    const week = await weekFor(ctx, accountId, weekStart);
    const now = Date.now();

    if (week) {
      await ctx.db.patch(week._id, { lastError: error.slice(0, 500), updatedAt: now });

      return;
    }

    await ctx.db.insert("autopilotWeeks", {
      accountId,
      weekStart,
      status: "failed",
      lastError: error.slice(0, 500),
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ----------------------------------------------------------------- production

export const claimSlot = internalMutation({
  args: { slotId: v.id("autopilotSlots") },
  handler: async (ctx, { slotId }) => {
    const slot = await ctx.db.get(slotId);

    if (!slot || (slot.status !== "planned" && slot.status !== "failed")) return null;

    const config = await getConfig(ctx, slot.accountId);

    if (!config?.enabled) return null;

    const account = await ctx.db.get(slot.accountId);

    if (account?.publisherConnectedAt === undefined) {
      await ctx.db.patch(slotId, {
        status: "failed",
        attempts: MAX_ATTEMPTS,
        lastError: "Conecte o Instagram em Perfil › Conexões para o piloto publicar.",
        updatedAt: Date.now(),
      });

      return null;
    }

    await ctx.db.patch(slotId, {
      status: "generating",
      attempts: slot.attempts + 1,
      lastError: undefined,
      updatedAt: Date.now(),
    });

    const { weekday, time } = localSlot(slot.scheduledFor);

    return { ...slot, weekday, time };
  },
});

export const referenceImages = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    const images = await ctx.db
      .query("images")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();

    // Faces depict the owner and need an explicit request; autopilot never uses them.
    const roles = { product: "produto/logo", place: "lugar", style: "direção de arte" } as const;

    return images
      .flatMap((image) => {
        if (image.purpose !== "reference" || image.safeForBrandUse === false) return [];

        if (!image.referenceKind || image.referenceKind === "face") return [];

        return [{ id: image._id, role: roles[image.referenceKind] }];
      })
      .slice(0, 3);
  },
});

/** Schedules the produced post — unless the owner vetoed or moved on meanwhile. */
export const finishProduction = internalMutation({
  args: { slotId: v.id("autopilotSlots"), postId: v.id("posts") },
  handler: async (ctx, { slotId, postId }): Promise<AutopilotSlotStatus | null> => {
    const slot = await ctx.db.get(slotId);

    if (!slot) return null;

    if (slot.status !== "generating") {
      // Skipped mid-production: keep the draft so a restore can publish it.
      if (slot.status === "skipped" && !slot.postId)
        await ctx.db.patch(slotId, { postId, updatedAt: Date.now() });

      return slot.status;
    }

    if (slot.scheduledFor <= Date.now() + MINUTE) {
      await ctx.db.patch(slotId, {
        status: "failed",
        postId,
        lastError: "o post ficou pronto depois do horário; ele ficou salvo como rascunho",
        updatedAt: Date.now(),
      });

      return "failed";
    }

    await schedulePostIn(ctx, {
      accountId: slot.accountId,
      postId,
      scheduledFor: slot.scheduledFor,
    });
    await ctx.db.patch(slotId, { status: "scheduled", postId, updatedAt: Date.now() });

    return "scheduled";
  },
});

export const failProduction = internalMutation({
  args: { slotId: v.id("autopilotSlots"), error: v.string() },
  handler: async (ctx, { slotId, error }) => {
    const slot = await ctx.db.get(slotId);

    if (!slot || slot.status !== "generating") return;

    await ctx.db.patch(slotId, {
      status: "failed",
      lastError: error.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});

// ----------------------------------------------------------------------- tick

export const enabledAccounts = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"accounts">[]> =>
    (
      await ctx.db
        .query("autopilotConfigs")
        .withIndex("by_enabled", (q) => q.eq("enabled", true))
        .collect()
    ).map((config) => config.accountId),
});

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
      if (now - slot.updatedAt < GENERATING_TIMEOUT_MS) continue;

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
