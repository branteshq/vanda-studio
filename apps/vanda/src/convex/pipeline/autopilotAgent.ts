import * as Effect from "effect/Effect";
import type { auditConfidences, AuditMetrics } from "../autopilotModel";
import { ConnectedInstagramProvider } from "../instagram/service";
import type { InstagramPost, InstagramProfile, InstagramTarget } from "../instagram/types";
import {
  computeAccountMetrics,
  confidenceFor,
  type MetricBasis,
  type ScoredPost,
} from "./autopilot";

/**
 * What the platform measures for the posts automáticos, deterministically:
 * the connected account's evidence and metrics. Caetano does the judging in
 * his own turns (skills instagram-account-audit and instagram-weekly-plan,
 * tools autopilot_measure_account / autopilot_save_audit / autopilot_save_plan);
 * nothing here calls a model, so numbers are never invented.
 */

const AUDIT_SAMPLE = 30;

const INSIGHT_CONCURRENCY = 4;

// ------------------------------------------------------------------ evidence

type ConnectedTarget = Extract<InstagramTarget, { scope: "connected" }>;

export interface AccountEvidence {
  readonly profile: InstagramProfile | null;
  readonly followers: number | undefined;
  readonly posts: readonly InstagramPost[];
  readonly feedPosts: readonly InstagramPost[];
}

const isFeed = (post: InstagramPost): boolean =>
  post.mediaType === "image" || post.mediaType === "carousel";

/**
 * Reads the connected account: recent posts with their private insights.
 * Per-post insight failures leave that post without insights (unknown, not
 * zero); a failed post list fails the audit.
 */
export const collectAccountEvidence = Effect.fn("autopilot.collectAccountEvidence")(function* (
  target: ConnectedTarget,
) {
  const provider = yield* ConnectedInstagramProvider;
  const page = yield* provider.listPosts(target, { limit: AUDIT_SAMPLE });

  const [profile, account] = yield* Effect.all(
    [
      provider.readProfile(target).pipe(
        Effect.map((result) => result.data),
        Effect.orElseSucceed(() => null),
      ),
      provider.readInsights(target).pipe(
        Effect.map((result) => result.data),
        Effect.orElseSucceed(() => null),
      ),
    ] as const,
    { concurrency: 2 },
  );

  const posts = yield* Effect.forEach(
    page.data,
    (post) =>
      provider.readInsights(target, post.id).pipe(
        Effect.map(
          (result): InstagramPost => ({
            ...post,
            publicEngagement: { ...post.publicEngagement, ...result.data.publicEngagement },
            privateInsights: { ...post.privateInsights, ...result.data.privateInsights },
          }),
        ),
        Effect.orElseSucceed(() => post),
      ),
    { concurrency: INSIGHT_CONCURRENCY },
  );

  const followers =
    profile?.followers ?? (account?.kind === "account" ? account.followers : undefined);

  return {
    profile,
    followers,
    posts,
    feedPosts: posts.filter(isFeed),
  } satisfies AccountEvidence;
});

// ------------------------------------------------------------------ measure

export interface AccountMeasurement {
  readonly basis: MetricBasis;
  readonly metrics: AuditMetrics;
  readonly confidence: (typeof auditConfidences)[number];
  readonly top: readonly ScoredPost[];
  readonly bottom: readonly ScoredPost[];
}

/** Metrics, confidence and the best and worst posts by multiple of the median. */
export const measureAccount = (evidence: AccountEvidence, now: number): AccountMeasurement => {
  const computed = computeAccountMetrics(evidence.feedPosts, {
    followers: evidence.followers,
    now,
  });

  return {
    basis: computed.basis,
    metrics: computed.metrics,
    confidence: confidenceFor(evidence.feedPosts.length),
    top: computed.ranked.slice(0, 5),
    bottom: computed.ranked.slice(-5).toReversed(),
  };
};

// ---------------------------------------------------------------------- plan

/** Exactly one outline line per slide: cut, or padded with the hook and a closing. */
export const fitOutline = (
  outline: readonly string[],
  slideCount: number,
  hook: string,
): string[] => {
  const trimmed = outline.filter((line) => line.trim() !== "").slice(0, slideCount);

  while (trimmed.length < slideCount)
    trimmed.push(trimmed.length === 0 ? hook : "Resumo e chamada");

  return trimmed;
};

export const renderAuditSummary = (audit: {
  readonly profileScore?: number | undefined;
  readonly summary?: string | undefined;
  readonly stop?: readonly string[] | undefined;
  readonly doMore?: readonly string[] | undefined;
  readonly needs?: readonly string[] | undefined;
  readonly findings?:
    | readonly { claim: string; evidence: string; n?: number | undefined }[]
    | undefined;
}): string =>
  [
    audit.summary ?? "",
    audit.profileScore === undefined ? "" : `Nota do perfil: ${audit.profileScore}/100`,
    ...(audit.findings ?? []).map(
      (finding) => `- ${finding.claim} (${finding.evidence}${finding.n ? `, n=${finding.n}` : ""})`,
    ),
    audit.stop?.length ? `PARE: ${audit.stop.join("; ")}` : "",
    audit.doMore?.length ? `FAÇA MAIS: ${audit.doMore.join("; ")}` : "",
    audit.needs?.length ? `A CONTA PRECISA: ${audit.needs.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
