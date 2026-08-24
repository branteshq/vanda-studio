import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import { makeApifyPublicInstagramProvider } from "../instagram/providers/apify";
import type { InstagramPost, InstagramProfile } from "../instagram/types";
import { BREAKOUT_DETECTOR_VERSION, MAX_SOURCE_AGE_MS } from "./inputQuality";

export interface MarketProfile {
  readonly externalId?: string | undefined;
  readonly handle: string;
  readonly displayName?: string | undefined;
  readonly profileUrl: string;
  readonly biography?: string | undefined;
  readonly profileImageUrl?: string | undefined;
  readonly followers?: number | undefined;
  readonly following?: number | undefined;
  readonly postsCount?: number | undefined;
  readonly businessCategory?: string | undefined;
  readonly private: boolean;
  readonly verified: boolean;
  readonly latestPosts: ReadonlyArray<MarketPost>;
}

export interface MarketPost {
  readonly externalId: string;
  readonly shortCode?: string | undefined;
  readonly permalink: string;
  readonly caption?: string | undefined;
  readonly mediaType: string;
  readonly productType?: string | undefined;
  readonly thumbnailUrl?: string | undefined;
  readonly videoUrl?: string | undefined;
  readonly publishedAt: number;
  readonly views?: number | undefined;
  readonly plays?: number | undefined;
  readonly likes?: number | undefined;
  readonly comments?: number | undefined;
  readonly ownerHandle?: string | undefined;
}

export interface ReelDetail extends MarketPost {
  readonly transcript?: string | undefined;
}

export class MarketProviderFailed extends Data.TaggedError("MarketProviderFailed")<{
  readonly operation: string;
  readonly message: string;
}> {}

export interface MarketDataProviderShape {
  readonly searchProfiles: (
    queries: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<MarketProfile>, MarketProviderFailed>;
  readonly getProfiles: (
    handles: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<MarketProfile>, MarketProviderFailed>;
  readonly getReel: (permalink: string) => Effect.Effect<ReelDetail, MarketProviderFailed>;
}

export class MarketDataProvider extends Context.Service<
  MarketDataProvider,
  MarketDataProviderShape
>()("@vanda/market/MarketDataProvider") {}

export const parseProviderTimestamp = (value: string | null | undefined): number | undefined => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const marketPostOf = (post: InstagramPost): MarketPost | undefined => {
  if (post.publishedAt === undefined) return undefined;
  return {
    externalId: post.id,
    permalink: post.url,
    mediaType: post.mediaType,
    publishedAt: post.publishedAt,
    ...(post.shortcode !== undefined ? { shortCode: post.shortcode } : {}),
    ...(post.caption !== undefined ? { caption: post.caption } : {}),
    ...(post.thumbnailUrl !== undefined ? { thumbnailUrl: post.thumbnailUrl } : {}),
    ...(post.mediaUrl !== undefined && post.mediaType === "video"
      ? { videoUrl: post.mediaUrl }
      : {}),
    ...(post.publicEngagement.views !== undefined ? { views: post.publicEngagement.views } : {}),
    ...(post.publicEngagement.plays !== undefined ? { plays: post.publicEngagement.plays } : {}),
    ...(post.publicEngagement.likes !== undefined ? { likes: post.publicEngagement.likes } : {}),
    ...(post.publicEngagement.comments !== undefined
      ? { comments: post.publicEngagement.comments }
      : {}),
    ...(post.ownerHandle !== undefined ? { ownerHandle: post.ownerHandle } : {}),
  };
};

const marketProfileOf = (profile: InstagramProfile): MarketProfile => ({
  handle: profile.handle,
  profileUrl: `https://www.instagram.com/${profile.handle}/`,
  private: profile.private ?? false,
  verified: profile.verified ?? false,
  latestPosts: (profile.latestPosts ?? []).flatMap((post) => {
    const normalized = marketPostOf(post);
    return normalized ? [normalized] : [];
  }),
  ...(profile.id !== undefined ? { externalId: profile.id } : {}),
  ...(profile.name !== undefined ? { displayName: profile.name } : {}),
  ...(profile.biography !== undefined ? { biography: profile.biography } : {}),
  ...(profile.profileImageUrl !== undefined ? { profileImageUrl: profile.profileImageUrl } : {}),
  ...(profile.followers !== undefined ? { followers: profile.followers } : {}),
  ...(profile.following !== undefined ? { following: profile.following } : {}),
  ...(profile.postsCount !== undefined ? { postsCount: profile.postsCount } : {}),
  ...(profile.category !== undefined ? { businessCategory: profile.category } : {}),
});

const marketProviderError = (operation: string) =>
  Effect.mapError(
    (error: { readonly message: string }) =>
      new MarketProviderFailed({ operation, message: error.message }),
  );

/** Legacy scheduled radar adapted over the same primitive public reader Vanda uses. */
export const apifyMarketDataLayer = (token: string): Layer.Layer<MarketDataProvider> => {
  const instagram = makeApifyPublicInstagramProvider(token);
  return Layer.succeed(MarketDataProvider, {
    searchProfiles: (queries) =>
      Effect.forEach(
        queries.slice(0, 5),
        (query) =>
          instagram.searchProfiles(query, 20).pipe(
            Effect.map((result) => result.data.map(marketProfileOf)),
            marketProviderError(`profile_search:${query}`),
          ),
        { concurrency: 5 },
      ).pipe(
        Effect.map((groups) => {
          const byHandle = new Map<string, MarketProfile>();
          for (const profile of groups.flat()) {
            byHandle.set(profile.handle.toLocaleLowerCase(), profile);
          }
          return [...byHandle.values()];
        }),
      ),
    getProfiles: (handles) =>
      Effect.forEach(
        handles,
        (handle) =>
          instagram.readProfile(handle).pipe(
            Effect.map((result) => marketProfileOf(result.data)),
            marketProviderError(`profile:${handle}`),
          ),
        { concurrency: 5 },
      ),
    getReel: (permalink) =>
      instagram.readPost(permalink, true).pipe(
        marketProviderError("reel"),
        Effect.flatMap((result) => {
          const post = marketPostOf(result.data);
          if (!post) {
            return new MarketProviderFailed({
              operation: "reel",
              message: "missing reel timestamp",
            });
          }
          return Effect.succeed({
            ...post,
            ...(result.data.transcript !== undefined ? { transcript: result.data.transcript } : {}),
          });
        }),
      ),
  });
};

export const MarketSearchPlan = Schema.Struct({
  category: Schema.String,
  location: Schema.String,
  language: Schema.String,
  profileQueries: Schema.Array(Schema.String),
});
export type MarketSearchPlan = typeof MarketSearchPlan.Type;

export const CandidateRanking = Schema.Struct({
  candidates: Schema.Array(
    Schema.Struct({
      handle: Schema.String,
      topicalOverlap: Schema.Number,
      audienceOverlap: Schema.Number,
      offerOverlap: Schema.Number,
      geographicOverlap: Schema.Number,
      languageMatch: Schema.Number,
      contentActivity: Schema.Number,
      confidence: Schema.Number,
      vetoes: Schema.Array(Schema.String),
      reason: Schema.String,
    }),
  ),
});

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

export interface CandidateRelevanceDimensions {
  readonly topicalOverlap: number;
  readonly audienceOverlap: number;
  readonly offerOverlap: number;
  readonly geographicOverlap: number;
  readonly languageMatch: number;
  readonly contentActivity: number;
  readonly confidence: number;
  readonly vetoes: ReadonlyArray<string>;
}

export const scoreCandidateRelevance = (input: CandidateRelevanceDimensions): number => {
  return (
    clampUnit(input.topicalOverlap) * 0.3 +
    clampUnit(input.audienceOverlap) * 0.2 +
    clampUnit(input.offerOverlap) * 0.15 +
    clampUnit(input.geographicOverlap) * 0.1 +
    clampUnit(input.languageMatch) * 0.1 +
    clampUnit(input.contentActivity) * 0.15
  );
};

export const candidatePassesRelevanceGate = (input: CandidateRelevanceDimensions): boolean =>
  input.vetoes.length === 0 && input.confidence >= 0.55 && scoreCandidateRelevance(input) >= 0.65;

export interface RankedMarketProfile {
  readonly profile: MarketProfile;
  readonly relevanceScore: number;
  readonly relevanceReason: string;
  readonly topicalOverlap: number;
  readonly audienceOverlap: number;
  readonly offerOverlap: number;
  readonly geographicOverlap: number;
  readonly languageMatch: number;
  readonly contentActivity: number;
  readonly relevanceConfidence: number;
  readonly relevanceVetoes: ReadonlyArray<string>;
}

const brandPrompt = (brandContext: string): string =>
  `Você está preparando uma busca de alta cobertura por concorrentes e criadores para uma marca ` +
  `no Instagram. Identifique a categoria principal, localização/mercado e idioma. Gere exatamente ` +
  `5 consultas genéricas de 2 a 4 palavras que pessoas realmente colocam no nome ou bio. Inclua ` +
  `duas consultas de categoria ampla, duas de tipo de negócio/profissional e uma de criador da ` +
  `especialidade. Evite cargos técnicos que seriam compradores ou fornecedores da marca. Para um ` +
  `e-commerce de eletrônicos, exemplos válidos seriam "loja de eletrônicos", "gadgets brasil", ` +
  `"acessórios para celular", "eletrônicos online" e "criador de tecnologia" — não "técnico ` +
  `hardware". Nunca invente usernames, nunca use @ e não inclua perfil, Instagram ou pequena ` +
  `empresa. As buscas devem encontrar pares que publiquem no mesmo mercado, não apenas pessoas ` +
  `que prestam serviços para ele. Responda em português do Brasil.\n\nContexto confirmado da marca:\n${brandContext}`;

export const planMarketSearch = (brandContext: string) =>
  LanguageModel.generateObject({
    prompt: brandPrompt(brandContext),
    schema: MarketSearchPlan,
  }).pipe(
    Effect.map((response) => ({
      ...response.value,
      profileQueries: [
        ...new Set(
          response.value.profileQueries.map((query) =>
            query
              .replaceAll("@", "")
              .replace(/\b(perfil|instagram|pequena empresa)\b/gi, "")
              .replace(/\s+/g, " ")
              .trim(),
          ),
        ),
      ]
        .filter(Boolean)
        .slice(0, 5),
    })),
  );

const candidatePrompt = (
  brandContext: string,
  plan: MarketSearchPlan,
  profiles: ReadonlyArray<MarketProfile>,
): string => {
  const lines = profiles
    .map((profile) => {
      const captions = profile.latestPosts
        .slice(0, 3)
        .flatMap((post) => (post.caption ? [post.caption.slice(0, 180)] : []))
        .join(" | ");
      return `- @${profile.handle}; nome=${profile.displayName ?? "?"}; seguidores=${profile.followers ?? "?"}; categoria=${profile.businessCategory ?? "?"}; bio=${profile.biography ?? "?"}; posts=${captions || "?"}`;
    })
    .join("\n");
  return (
    `Você seleciona contas pequenas e relevantes para um radar competitivo. Avalie cada perfil ` +
    `somente pelo material fornecido. Dê notas independentes de 0 a 1 para sobreposição temática, ` +
    `público, oferta, geografia, idioma e atividade de conteúdo. confidence mede a suficiência da ` +
    `evidência. Use vetoes para agregadores, reposts, idioma/país incompatível ou campo claramente ` +
    `diferente. Não preencha uma cota: perfis fracos devem receber notas baixas. Dê uma razão ` +
    `factual e curta em português e preserve exatamente cada handle.\n\nMarca:\n${brandContext}\n\nMercado inferido: ` +
    `${plan.category}; ${plan.location}; ${plan.language}\n\nPerfis:\n${lines}`
  );
};

export const rankCandidates = (
  brandContext: string,
  plan: MarketSearchPlan,
  profiles: ReadonlyArray<MarketProfile>,
) =>
  LanguageModel.generateObject({
    prompt: candidatePrompt(brandContext, plan, profiles),
    schema: CandidateRanking,
  }).pipe(
    Effect.map((response) => {
      const byHandle = new Map(
        response.value.candidates.map((candidate) => [
          candidate.handle.trim().replace(/^@/, "").toLocaleLowerCase(),
          candidate,
        ]),
      );
      return profiles.flatMap((profile): ReadonlyArray<RankedMarketProfile> => {
        const ranking = byHandle.get(profile.handle.toLocaleLowerCase());
        if (!ranking) return [];
        const topicalOverlap = clampUnit(ranking.topicalOverlap);
        const audienceOverlap = clampUnit(ranking.audienceOverlap);
        const offerOverlap = clampUnit(ranking.offerOverlap);
        const geographicOverlap = clampUnit(ranking.geographicOverlap);
        const languageMatch = clampUnit(ranking.languageMatch);
        const contentActivity = clampUnit(ranking.contentActivity);
        const relevanceConfidence = clampUnit(ranking.confidence);
        const dimensions = {
          topicalOverlap,
          audienceOverlap,
          offerOverlap,
          geographicOverlap,
          languageMatch,
          contentActivity,
          confidence: relevanceConfidence,
          vetoes: ranking.vetoes,
        };
        const relevanceScore = scoreCandidateRelevance(dimensions);
        if (!candidatePassesRelevanceGate(dimensions)) return [];
        return [
          {
            profile,
            relevanceScore,
            relevanceReason: ranking.reason,
            topicalOverlap,
            audienceOverlap,
            offerOverlap,
            geographicOverlap,
            languageMatch,
            contentActivity,
            relevanceConfidence,
            relevanceVetoes: ranking.vetoes,
          },
        ];
      });
    }),
  );

export const OpportunityAdaptation = Schema.Struct({
  coreIdea: Schema.String,
  hook: Schema.String,
  structure: Schema.String,
  pacing: Schema.String,
  visualConcept: Schema.String,
  whyItWorks: Schema.String,
  creatorSpecificElements: Schema.Array(Schema.String),
  adaptedHook: Schema.String,
  adaptedSlides: Schema.Array(Schema.String),
  adaptedCaption: Schema.String,
  transformationNotes: Schema.String,
});
export type OpportunityAdaptation = typeof OpportunityAdaptation.Type;

export const adaptMarketOpportunity = (input: {
  readonly transcript?: string | undefined;
  readonly caption?: string | undefined;
  readonly triggerReason: string;
  readonly brandContext: string;
}) => {
  const source = input.transcript?.trim() || input.caption?.trim() || "(sem transcrição)";
  const prompt =
    `Você é uma estrategista e redatora transformando uma oportunidade de conteúdo para uma ` +
    `marca. Analise o mecanismo criativo da fonte e crie uma versão nova em formato carrossel ` +
    `Instagram. Preserve apenas a ideia abstrata e o mecanismo; não parafraseie linha por linha, ` +
    `não reutilize identidade, histórias, imagens ou frases distintivas do criador. Gere de 3 a 5 ` +
    `slides curtos, cada um com no máximo 110 caracteres. A legenda e todo conteúdo devem estar ` +
    `em português do Brasil e respeitar o contexto confirmado.\n\n` +
    `Evidência de tração: ${input.triggerReason}\n\nConteúdo fonte:\n${source.slice(0, 12_000)}\n\n` +
    `Contexto confirmado da marca:\n${input.brandContext}`;
  return LanguageModel.generateObject({ prompt, schema: OpportunityAdaptation }).pipe(
    Effect.map((response) => ({
      ...response.value,
      adaptedSlides: response.value.adaptedSlides.slice(0, 5),
    })),
  );
};

export interface SnapshotInput {
  readonly followers?: number | undefined;
  readonly views?: number | undefined;
  readonly plays?: number | undefined;
  readonly likes?: number | undefined;
  readonly comments?: number | undefined;
  readonly observedAt: number;
}

export interface BreakoutDecision {
  readonly score: number;
  readonly triggerType: "absolute_threshold" | "audience_ratio" | "velocity";
  readonly reason: string;
  readonly detectorVersion: typeof BREAKOUT_DETECTOR_VERSION;
}

export interface BreakoutContext {
  readonly now: number;
  readonly publishedAt: number;
}

const formatNumber = (value: number): string =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);

export const detectBreakout = (
  current: SnapshotInput,
  previous?: SnapshotInput | undefined,
  context?: BreakoutContext | undefined,
): BreakoutDecision | undefined => {
  if (context) {
    const age = context.now - context.publishedAt;
    if (!Number.isFinite(context.publishedAt) || age < -3_600_000 || age > MAX_SOURCE_AGE_MS)
      return undefined;
  }
  const followers = current.followers;
  const views = current.views ?? current.plays;
  if (views === undefined) return undefined;

  if (previous) {
    const previousViews = previous.views ?? previous.plays;
    const elapsedHours = (current.observedAt - previous.observedAt) / 3_600_000;
    if (previousViews !== undefined && elapsedHours > 0) {
      const velocity = (views - previousViews) / elapsedHours;
      if (velocity >= 500) {
        return {
          score: Math.min(100, 70 + velocity / 100),
          triggerType: "velocity",
          reason: `Ganhou ${formatNumber(velocity)} visualizações por hora desde a última leitura.`,
          detectorVersion: BREAKOUT_DETECTOR_VERSION,
        };
      }
    }
  }

  if (followers !== undefined && followers > 0 && views >= 1_000) {
    const ratio = views / followers;
    if (ratio >= 3) {
      return {
        score: Math.min(100, 60 + ratio * 4),
        triggerType: "audience_ratio",
        reason: `${formatNumber(views)} visualizações com ${formatNumber(followers)} seguidores — ${formatNumber(ratio)}× o tamanho da audiência.`,
        detectorVersion: BREAKOUT_DETECTOR_VERSION,
      };
    }
  }

  if (views >= 5_000) {
    return {
      score: Math.min(100, 50 + views / 1_000),
      triggerType: "absolute_threshold",
      reason: `A publicação passou de ${formatNumber(views)} visualizações.`,
      detectorVersion: BREAKOUT_DETECTOR_VERSION,
    };
  }

  return undefined;
};
