"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { BrandAnalysis, BrandGroup, BrandText, CorpusStats } from "./pipeline/brand";
import { analysisFacts, proposeBrandProfile } from "./pipeline/brandProfile";
import { fetchBrandCorpus, uploadPostInstagramReaderLayer } from "./pipeline/liveBrand";
import { languageModelLayer, PIPELINE_MODELS, PROMPT_VERSIONS } from "./pipeline/liveModel";
import { runTracked } from "./pipeline/liveTelemetry";

/**
 * Caetano's evidence from the read, saved as /notes/leitura-instagram.md: the summary,
 * themes, opportunities, the low-confidence cards to confirm, and recent captions.
 */
const leituraNote = (analysis: BrandAnalysis, captions: readonly string[]): string => {
  const cards: [string, BrandText | BrandGroup][] = [
    ["Identidade", analysis.identity],
    ["Onde", analysis.location],
    ["Posicionamento", analysis.positioning],
    ["Ofertas", analysis.offers],
    ["Público", analysis.audience],
    ["Voz", analysis.voice],
    ["Personagens", analysis.characters],
    ["Provas", analysis.proof],
    ["Restrições", analysis.restrictions],
    ["Temas", analysis.themes],
    ["Oportunidades", analysis.opportunities],
  ];

  const guesses = cards.filter(([, card]) => card.confidence < 0.5);

  const text = (card: BrandText | BrandGroup) =>
    "text" in card ? card.text : card.items.join("; ");

  return [
    "# Leitura do Instagram",
    "",
    "## Resumo",
    analysis.summary.text,
    `(${analysis.summary.evidence})`,
    "",
    "## Temas",
    ...analysis.themes.items.map((item) => `- ${item}`),
    "",
    "## Oportunidades",
    ...analysis.opportunities.items.map((item) => `- ${item}`),
    "",
    "## Palpites (confirmar com o dono)",
    ...(guesses.length > 0
      ? guesses.map(([label, card]) => `- ${label}: ${text(card)} (${card.evidence})`)
      : ["- nenhum"]),
    "",
    "## Legendas recentes",
    ...captions
      .slice(0, 8)
      .map((caption) => `- ${caption.replace(/\s+/g, " ").trim().slice(0, 200)}`),
    "",
  ].join("\n");
};

/**
 * Onboarding's "Vanda is reading your account" step: read the caller's
 * connected Instagram, run one structured pass into a `BrandAnalysis`, and
 * finish onboarding with it (the brand file opens with the confident cards,
 * and Caetano's brand guide thread asks for the rest). A failed read still finishes:
 * Vanda then asks everything in the conversation. Safe to retry. A business already
 * onboarded is read again only when its brand file is empty (a cleared file reconnected).
 */
export const onboard = action({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) throw new Error("Not authenticated");

    const { handle, onboarded, guideEmpty } = await ctx.runQuery(
      internal.brandProfile.resolveOwnedHandle,
      { accountId, clerkId: identity.subject },
    );

    if (onboarded && !guideEmpty) return;

    const apiKey = process.env.OPENROUTER_API_KEY;
    const publisherUsername = String(accountId);

    let read: { analysis: BrandAnalysis; stats: CorpusStats; captions: readonly string[] } | null =
      null;

    // Without a handle or a model key there is nothing to read: Caetano asks instead.
    if (handle !== null && apiKey) {
      try {
        read = await runTracked(
          ctx,
          {
            accountId,
            stage: "brand_profile",
            model: PIPELINE_MODELS.brandProfile,
            promptVersion: PROMPT_VERSIONS.brandProfile,
            inputIds: [handle],
          },
          () =>
            Effect.runPromise(
              Effect.gen(function* () {
                const { corpus, stats } = yield* fetchBrandCorpus(publisherUsername, handle);
                const analysis = yield* proposeBrandProfile(corpus);

                return { analysis, stats, captions: corpus.captions };
              }).pipe(
                Effect.provide(
                  Layer.mergeAll(
                    languageModelLayer(apiKey, PIPELINE_MODELS.brandProfile),
                    uploadPostInstagramReaderLayer,
                  ),
                ),
              ),
            ),
          ({ stats }) => `${stats.posts} posts; ${stats.comments} comentários`,
        );
      } catch (error) {
        // Onboarding still finishes: Caetano asks everything in the brand guide.
        console.warn("onboarding: Instagram read failed", { accountId, error: String(error) });
      }
    } else {
      console.warn("onboarding: Instagram read skipped", {
        accountId,
        hasHandle: handle !== null,
        hasModelKey: Boolean(apiKey),
      });
    }

    await ctx.runMutation(internal.brandProfile.completeOnboarding, {
      accountId,
      kind: read?.analysis.kind.value ?? null,
      facts: read ? analysisFacts(read.analysis, Date.now()) : [],
      opener: read?.analysis.opener ?? null,
      note: read ? leituraNote(read.analysis, read.captions) : null,
    });
  },
});
