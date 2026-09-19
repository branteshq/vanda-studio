import type { LanguageModelUsage, ProviderMetadata } from "ai";
import { v, type Infer } from "convex/values";
import { z } from "zod";

export const modelUsageValidator = v.object({
  model: v.string(),
  provider: v.string(),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  cacheReadTokens: v.optional(v.number()),
  cacheWriteTokens: v.optional(v.number()),
  costSource: v.union(
    v.literal("reported"),
    v.literal("estimated"),
    v.literal("subscription"),
    v.literal("unknown"),
  ),
});

const reportedUsage = z.object({
  usage: z.object({ cost: z.number().nonnegative().optional() }).optional(),
});

/** Keep missing counts unknown, not zero; preserve reported zero-dollar responses. */
export function modelCharge(
  model: string,
  provider: string,
  usage: LanguageModelUsage,
  metadata: ProviderMetadata | undefined,
) {
  const reported = reportedUsage.safeParse(metadata?.openrouter);
  const details = reported.success ? reported.data.usage : undefined;
  const subscription = !provider.includes("openrouter");

  const modelUsage: Infer<typeof modelUsageValidator> = {
    model,
    provider,
    costSource: subscription
      ? "subscription"
      : details?.cost !== undefined
        ? "reported"
        : "estimated",
  };

  const read = usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens;
  const write = usage.inputTokenDetails?.cacheWriteTokens;

  if (usage.inputTokens !== undefined) modelUsage.inputTokens = usage.inputTokens;

  if (usage.outputTokens !== undefined) modelUsage.outputTokens = usage.outputTokens;

  if (read !== undefined) modelUsage.cacheReadTokens = read;

  if (write !== undefined) modelUsage.cacheWriteTokens = write;

  // Retain the existing billing fallback, now explicitly identified as an estimate.
  const usd = subscription
    ? 0
    : (details?.cost ?? (usage.inputTokens ?? 0) * 2e-6 + (usage.outputTokens ?? 0) * 8e-6);

  return { usd, modelUsage };
}
