import {
  MAX_AUTOPILOT_SLIDES,
  auditConfidences,
  MAX_WEEKLY_POSTS,
  autopilotPostTypes,
  weekdayNames,
  weekdayShortNames,
  type AuditMetrics,
  type AutopilotSlotStatus,
  type CadenceEntry,
} from "../autopilotModel";
import { z } from "zod";
import type { PostPurpose } from "../postPurposes";
import type { InstagramPost } from "../instagram/types";

/**
 * Pure autopilot logic: São Paulo week math, cadence normalization, account
 * metrics for the audit, and the PT-BR schedule text the chat, WhatsApp and
 * the Piloto automático view share.
 */

const HOUR = 60 * 60 * 1000;

const DAY = 24 * HOUR;

const WEEK = 7 * DAY;

/** America/Sao_Paulo has been fixed at UTC−3 since DST ended in 2019. */
const SAO_PAULO_OFFSET_MS = -3 * HOUR;

const toLocal = (timestamp: number): Date => new Date(timestamp + SAO_PAULO_OFFSET_MS);

/** Monday 00:00 (São Paulo) of the week containing `timestamp`, as epoch ms. */
export const weekStartOf = (timestamp: number): number => {
  const local = toLocal(timestamp);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());

  return midnight - daysSinceMonday * DAY - SAO_PAULO_OFFSET_MS;
};

export const nextWeekStart = (timestamp: number): number => weekStartOf(timestamp) + WEEK;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidTime = (time: string): boolean => TIME_PATTERN.test(time);

/** Epoch ms of `weekday` (0 = Sunday) at "HH:mm" São Paulo inside the Monday-start week. */
export const slotTimestamp = (weekStart: number, weekday: number, time: string): number => {
  const match = TIME_PATTERN.exec(time);

  if (!match) throw new Error(`horário inválido: ${time}`);
  const dayOffset = (weekday + 6) % 7;

  return weekStart + dayOffset * DAY + Number(match[1]) * HOUR + Number(match[2]) * 60 * 1000;
};

/** Weekday (0 = Sunday) and "HH:mm" of a timestamp in São Paulo. */
export interface LocalSlot {
  readonly weekday: number;
  readonly time: string;
}

export const localSlot = (timestamp: number): LocalSlot => {
  const local = toLocal(timestamp);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");

  return { weekday: local.getUTCDay(), time: `${hh}:${mm}` };
};

/** Monday-first order, matching the Seg … Dom strip. */
const mondayFirst = (weekday: number): number => (weekday + 6) % 7;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

/**
 * Makes any proposed cadence safe to schedule: feed types only, an image is
 * one slide, a carousel 2–10, valid weekday and time, no duplicate slot, at
 * most MAX_WEEKLY_POSTS, Monday-first order.
 */
export const normalizeCadence = (entries: readonly CadenceEntry[]): CadenceEntry[] => {
  const seen = new Set<string>();
  const result: CadenceEntry[] = [];

  for (const entry of entries) {
    if (!Number.isInteger(entry.weekday) || entry.weekday < 0 || entry.weekday > 6) continue;

    if (!isValidTime(entry.time)) continue;

    if (!autopilotPostTypes.includes(entry.type)) continue;
    const key = `${entry.weekday}-${entry.time}`;

    if (seen.has(key)) continue;
    seen.add(key);

    const slideCount =
      entry.type === "image" ? 1 : clamp(entry.slideCount, 2, MAX_AUTOPILOT_SLIDES);

    result.push({ weekday: entry.weekday, time: entry.time, type: entry.type, slideCount });
  }

  return result
    .toSorted(
      (a, b) => mondayFirst(a.weekday) - mondayFirst(b.weekday) || a.time.localeCompare(b.time),
    )
    .slice(0, MAX_WEEKLY_POSTS);
};

/** The account-agency default: Tue & Thu 18h, Sat 12h; 2, 1 and 3 slides. */
export const DEFAULT_CADENCE: readonly CadenceEntry[] = [
  { weekday: 2, time: "18:00", type: "carousel", slideCount: 2 },
  { weekday: 4, time: "18:00", type: "image", slideCount: 1 },
  { weekday: 6, time: "12:00", type: "carousel", slideCount: 3 },
];

// ------------------------------------------------------------ cadence input

const WEEKDAY_WORDS = new Map([
  ["dom", 0],
  ["seg", 1],
  ["ter", 2],
  ["qua", 3],
  ["qui", 4],
  ["sex", 5],
  ["sab", 6],
]);

const CadenceJson = z.array(
  z.object({
    weekday: z.number(),
    time: z.string(),
    type: z.enum(autopilotPostTypes),
    slideCount: z.number(),
  }),
);

const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const ENTRY_PATTERN =
  /\b(dom(?:ingo)?|seg(?:unda)?|ter(?:ca)?|qua(?:rta)?|qui(?:nta)?|sex(?:ta)?|sab(?:ado)?)\w*\b[^\d]*?(\d{1,2})(?:\s*(?:h|:)\s*(\d{2})?)?/;

/**
 * Reads a cadence the way an owner or an agent writes it: "ter 18h carrossel 2;
 * qui 18h imagem; sab 12h carrossel 3" (one post per `;`, `,` or line), or the
 * JSON array of entries. Unknown pieces are rejected, never guessed.
 */
export const parseCadenceText = (value: string): CadenceEntry[] => {
  const trimmed = value.trim();

  if (trimmed.startsWith("[")) return CadenceJson.parse(JSON.parse(trimmed));

  return trimmed
    .split(/[;,\n]+/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const text = fold(piece);
      const match = ENTRY_PATTERN.exec(text);

      if (!match) throw new Error(`não entendi "${piece}"; use por exemplo "ter 18h carrossel 2"`);

      const weekday = WEEKDAY_WORDS.get(match[1]!.slice(0, 3)) ?? Number.NaN;
      const time = `${match[2]!.padStart(2, "0")}:${match[3] ?? "00"}`;
      const carousel = /carross|carousel/.test(text);

      const slides =
        /(\d+)\s*(?:slides?|imagens|fotos)/.exec(text) ??
        /(?:carrossel|carousel)\D*(\d+)/.exec(text);

      return {
        weekday,
        time,
        type: carousel ? ("carousel" as const) : ("image" as const),
        slideCount: carousel ? Number(slides?.[1] ?? 2) : 1,
      };
    });
};

// ---------------------------------------------------------------- PT-BR text

/** "18h" or "18h30". */
export const formatHour = (time: string): string => {
  const [hh, mm] = time.split(":");

  return mm === "00" ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
};

export const slidesLabel = (count: number): string => (count === 1 ? "1 slide" : `${count} slides`);

/** "3 por semana · Ter e Qui 18h · Sáb 12h" — days grouped by shared time. */
export const cadenceSummary = (cadence: readonly CadenceEntry[]): string => {
  if (cadence.length === 0) return "Sem posts definidos";
  const sorted = normalizeCadence(cadence);
  const groups: { time: string; days: string[] }[] = [];

  for (const entry of sorted) {
    const day = weekdayShortNames[entry.weekday] ?? "";
    const last = groups.at(-1);

    if (last && last.time === entry.time) last.days.push(day);
    else groups.push({ time: entry.time, days: [day] });
  }

  const parts = groups.map(({ time, days }) => {
    const joined = days.length > 1 ? `${days.slice(0, -1).join(", ")} e ${days.at(-1)}` : days[0];

    return `${joined} ${formatHour(time)}`;
  });

  return [`${sorted.length} por semana`, ...parts].join(" · ");
};

export const purposeLabels: Record<PostPurpose, string> = {
  institucional: "Institucional",
  educacional: "Educacional",
  informativo: "Informativo",
  produto: "Produto",
  promocional: "Promocional",
  prova_social: "Prova social",
  editorial: "Editorial",
  storytelling: "Storytelling",
  bastidores: "Bastidores",
  comunidade: "Comunidade",
  anuncio: "Anúncio",
  dados: "Dados",
  expressao_cultural: "Expressão cultural",
  employer_branding: "Employer branding",
};

export const slotStatusLabels: Record<AutopilotSlotStatus, string> = {
  planned: "planejado",
  generating: "gerando",
  scheduled: "agendado",
  published: "publicado",
  skipped: "pulado",
  failed: "falhou",
};

export interface ScheduleTextSlot {
  readonly scheduledFor: number;
  readonly slideCount: number;
  readonly purpose: PostPurpose;
  readonly hook: string;
  readonly status: AutopilotSlotStatus;
}

/** Plain-text schedule for WhatsApp and agent replies, in the agency's style. */
export const formatScheduleText = (
  slots: readonly ScheduleTextSlot[],
  heading = "Programação da semana",
): string => {
  const active = slots.filter((slot) => slot.status !== "skipped");
  const lines = [`📅 ${heading} — ${active.length} ${active.length === 1 ? "post" : "posts"}`];

  for (const slot of slots.toSorted((a, b) => a.scheduledFor - b.scheduledFor)) {
    const { weekday, time } = localSlot(slot.scheduledFor);
    const status = slot.status === "planned" ? "" : ` (${slotStatusLabels[slot.status]})`;
    lines.push(
      `${weekdayNames[weekday]} ${formatHour(time)} · ${slidesLabel(slot.slideCount)} · ${purposeLabels[slot.purpose]} — "${slot.hook}"${status}`,
    );
  }

  return lines.join("\n");
};

// ------------------------------------------------------------- audit metrics

const median = (values: readonly number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

const ratio = (num: number, den: number): number | undefined =>
  den > 0 ? Math.round((num / den) * 10000) / 10000 : undefined;

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Drops undefined keys so optional Convex fields stay absent, not undefined. */
export const definedOnly = <T extends Record<string, unknown>>(
  value: T,
): { [K in keyof T]: Exclude<T[K], undefined> } =>
  // SAFETY: only entries whose value is undefined are removed, so every kept key
  // still holds its original (now non-undefined) type.
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };

/**
 * The yardstick per post: private reach when the connection gives it, else
 * public interactions (likes + comments). Mixing the two inside one ranking
 * would compare different things, so the whole sample uses one basis.
 */
export type MetricBasis = "reach" | "interactions";

export interface ScoredPost {
  readonly post: InstagramPost;
  readonly value: number;
  readonly outlier: number;
  readonly sharesPerReach?: number | undefined;
  readonly savesPerReach?: number | undefined;
}

export interface AccountMetricsResult {
  readonly basis: MetricBasis;
  readonly metrics: AuditMetrics;
  readonly ranked: readonly ScoredPost[];
}

const feedFormatLabels: Record<InstagramPost["mediaType"], string> = {
  carousel: "carrossel",
  image: "imagem",
  video: "vídeo",
  unknown: "outro",
};

const feedFormat = (post: InstagramPost): string => feedFormatLabels[post.mediaType];

const bucketMeans = (
  scored: readonly ScoredPost[],
  keyOf: (item: ScoredPost) => string | undefined,
): AuditMetrics["byFormat"] => {
  const buckets = new Map<string, number[]>();

  for (const item of scored) {
    const key = keyOf(item);

    if (key === undefined) continue;
    buckets.set(key, [...(buckets.get(key) ?? []), item.outlier]);
  }

  return [...buckets.entries()]
    .map(([key, values]) => ({
      key,
      n: values.length,
      meanOutlier: round2(values.reduce((sum, value) => sum + value, 0) / values.length),
    }))
    .toSorted((a, b) => b.meanOutlier - a.meanOutlier);
};

/**
 * Deterministic account metrics for the audit: outlier multiple against the
 * account's own median, per-reach ratios with explicit denominators, cadence
 * and format/hour buckets. Missing fields stay unknown, never zero.
 */
export const computeAccountMetrics = (
  posts: readonly InstagramPost[],
  options: { readonly followers?: number | undefined; readonly now: number },
): AccountMetricsResult => {
  const withReach = posts.filter((post) => post.privateInsights?.reach !== undefined);

  const basis: MetricBasis =
    withReach.length >= Math.max(1, posts.length / 2) ? "reach" : "interactions";

  const valueOf = (post: InstagramPost): number | undefined =>
    basis === "reach"
      ? post.privateInsights?.reach
      : (post.publicEngagement.likes ?? 0) + (post.publicEngagement.comments ?? 0);

  const valued = posts.flatMap((post) => {
    const value = valueOf(post);

    return value === undefined ? [] : [{ post, value }];
  });

  const mid = median(valued.map((item) => item.value));

  const ranked: ScoredPost[] = valued
    .map(({ post, value }) => {
      const reach = post.privateInsights?.reach;

      return {
        post,
        value,
        outlier: mid && mid > 0 ? round2(value / mid) : 0,
        sharesPerReach:
          reach !== undefined && post.publicEngagement.shares !== undefined
            ? ratio(post.publicEngagement.shares, reach)
            : undefined,
        savesPerReach:
          reach !== undefined && post.privateInsights?.saves !== undefined
            ? ratio(post.privateInsights.saves, reach)
            : undefined,
      };
    })
    .toSorted((a, b) => b.outlier - a.outlier || (b.sharesPerReach ?? 0) - (a.sharesPerReach ?? 0));

  const dated = posts
    .flatMap((post) => (post.publishedAt === undefined ? [] : [post.publishedAt]))
    .toSorted((a, b) => a - b);

  const windowStart = dated[0];
  const windowEnd = dated.at(-1);

  const spanWeeks =
    windowStart !== undefined ? Math.max(1, (options.now - windowStart) / WEEK) : undefined;

  const reachTotal = withReach.reduce((sum, post) => sum + (post.privateInsights?.reach ?? 0), 0);
  const savesTotal = withReach.reduce((sum, post) => sum + (post.privateInsights?.saves ?? 0), 0);
  const sharesTotal = withReach.reduce((sum, post) => sum + (post.publicEngagement.shares ?? 0), 0);
  const hasSaves = withReach.some((post) => post.privateInsights?.saves !== undefined);
  const hasShares = withReach.some((post) => post.publicEngagement.shares !== undefined);

  return {
    basis,
    ranked,
    metrics: definedOnly({
      sampleSize: posts.length,
      windowStart,
      windowEnd,
      followers: options.followers,
      medianReach: basis === "reach" ? mid : undefined,
      savesPerReach: hasSaves ? ratio(savesTotal, reachTotal) : undefined,
      sharesPerReach: hasShares ? ratio(sharesTotal, reachTotal) : undefined,
      followsPerReach: undefined,
      postsPerWeek: spanWeeks ? round2(dated.length / spanWeeks) : undefined,
      daysSinceLastPost:
        windowEnd !== undefined ? Math.floor((options.now - windowEnd) / DAY) : undefined,
      byFormat: bucketMeans(ranked, (item) => feedFormat(item.post)),
      byHour: bucketMeans(ranked, (item) => {
        if (item.post.publishedAt === undefined) return undefined;
        const { weekday, time } = localSlot(item.post.publishedAt);

        return `${weekdayShortNames[weekday]} ${time.slice(0, 2)}h`;
      }),
    }),
  };
};

/** Audit confidence by sample size: 6 posts make no pattern, 30 do. */
export const confidenceFor = (sampleSize: number): (typeof auditConfidences)[number] => {
  if (sampleSize >= 25) return "alta";

  if (sampleSize >= 10) return "media";

  return "baixa";
};
