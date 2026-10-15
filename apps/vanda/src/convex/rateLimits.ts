import { HOUR, MINUTE, RateLimiter, type RateLimitConfig } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { publicError } from "../errors";

/**
 * Every rate limit in the backend, in one place. Keys are the Clerk subject
 * of the signed-in owner (`subjectOf`), except the WhatsApp limits (keyed by
 * connection).
 *
 * Sizing: a normal owner never gets near these. Each limit is the ceiling of
 * one realistic burst (a few taps in a row) plus a sustained rate well above
 * what a person can do by hand. Counts are per owner, not per account, since
 * the usage budget is per owner too.
 * Rationale for each row is on the row itself.
 */
export const LIMITS = {
  // Vanda and Caetano turns, from the app and from WhatsApp. One turn runs several paid model steps.
  agentTurn: { kind: "token bucket", rate: 10, period: MINUTE, capacity: 5 },
  // Image generation, counted per image: burst of 20, then 20 a minute.
  imageGeneration: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 20 },
  // The same images, capped per hour.
  imageGenerationHourly: { kind: "fixed window", rate: 200, period: HOUR },
  // Autopilot retry or regenerate: re-plans or re-paints a post (several paid calls each).
  autopilotRun: { kind: "token bucket", rate: 6, period: HOUR, capacity: 3 },
  // Market radar scan: Apify research plus model steps, about $0.12 each.
  marketScan: { kind: "token bucket", rate: 6, period: HOUR, capacity: 3 },
  // Creative brief for one opportunity (model steps).
  marketAdapt: { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  // Autumn billing calls: checkout, plan preview and change, portal link, sync.
  billingCall: { kind: "token bucket", rate: 20, period: MINUTE, capacity: 10 },
  // Connection set-up: Instagram connect and sync, WhatsApp link, ChatGPT device-login polling (every few seconds).
  connectionCall: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 15 },
  // Re-sending a failed WhatsApp message: a paid Kapso send.
  whatsappResend: { kind: "fixed window", rate: 20, period: HOUR },
  // Image uploads and reference photos (stored in Convex storage).
  upload: { kind: "token bucket", rate: 30, period: MINUTE, capacity: 15 },
  // Inbound WhatsApp messages per connection. Each one can start a paid turn.
  whatsappInbound: { kind: "token bucket", rate: 12, period: MINUTE, capacity: 6 },
  // Tells the sender once in a while that inbound is limited, so a flood cannot also flood replies.
  whatsappNotice: { kind: "fixed window", rate: 3, period: HOUR },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitName = keyof typeof LIMITS;

export const rateLimiter = new RateLimiter(components.rateLimiter, LIMITS);

// SAFETY: LIMITS is the only source of keys, so every key is a RateLimitName.
const rateLimitNames = Object.keys(LIMITS) as RateLimitName[];

/** The Clerk subject of the caller, or UNAUTHENTICATED. The key for per-owner limits. */
export const subjectOf = async (ctx: Pick<MutationCtx, "auth">): Promise<string> => {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) throw publicError("UNAUTHENTICATED");

  return identity.subject;
};

/**
 * Spend `count` from a limit inside a mutation, or throw RATE_LIMITED with
 * how long to wait. The consumption rolls back if the mutation later throws.
 */
export const enforce = async (
  ctx: MutationCtx,
  name: RateLimitName,
  key: string,
  count = 1,
): Promise<void> => {
  const status = await rateLimiter.limit(ctx, name, { key, count, throws: false });

  if (!status.ok) {
    console.warn(`rate limited: ${name}`, { retryAfterMs: status.retryAfter });
    throw publicError("RATE_LIMITED", status.retryAfter);
  }
};

/** The same check for actions, which cannot write the limiter tables themselves. */
export const enforceAction = async (
  ctx: ActionCtx,
  name: RateLimitName,
  key: string,
  count = 1,
): Promise<void> => {
  const status = await ctx.runMutation(internal.rateLimits.take, { name, key, count });

  if (!status.ok) {
    console.warn(`rate limited: ${name}`, { retryAfterMs: status.retryAfterMs });
    throw publicError("RATE_LIMITED", status.retryAfterMs);
  }
};

/**
 * Spend from a limit without throwing, for callers that need their own
 * response instead of an exception.
 */
export const take = internalMutation({
  args: {
    name: v.union(...rateLimitNames.map((name) => v.literal(name))),
    key: v.string(),
    count: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { name, key, count = 1 },
  ): Promise<{ ok: boolean; retryAfterMs: number }> => {
    const status = await rateLimiter.limit(ctx, name, { key, count, throws: false });

    return { ok: status.ok, retryAfterMs: status.retryAfter ?? 0 };
  },
});
