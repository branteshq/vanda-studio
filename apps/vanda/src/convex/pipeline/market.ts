import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { decodeUnknownEffect } from "effect/Schema";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";

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

const optionalString = Schema.optional(Schema.NullOr(Schema.String));
const optionalNumber = Schema.optional(Schema.NullOr(Schema.Number));

const ApifyPost = Schema.Struct({
  id: optionalString,
  shortCode: optionalString,
  url: optionalString,
  caption: optionalString,
  type: optionalString,
  productType: optionalString,
  displayUrl: optionalString,
  videoUrl: optionalString,
  timestamp: optionalString,
  videoViewCount: optionalNumber,
  videoPlayCount: optionalNumber,
  likesCount: optionalNumber,
  commentsCount: optionalNumber,
  ownerUsername: optionalString,
});

const ApifyProfile = Schema.Struct({
  id: optionalString,
  username: optionalString,
  url: optionalString,
  fullName: optionalString,
  biography: optionalString,
  profilePicUrl: optionalString,
  profilePicUrlHD: optionalString,
  followersCount: optionalNumber,
  followsCount: optionalNumber,
  postsCount: optionalNumber,
  businessCategoryName: optionalString,
  private: Schema.optional(Schema.Boolean),
  verified: Schema.optional(Schema.Boolean),
  latestPosts: Schema.optional(Schema.Array(ApifyPost)),
});

const ApifyProfiles = Schema.Array(ApifyProfile);

const ApifyReel = Schema.Struct({
  id: optionalString,
  shortCode: optionalString,
  url: optionalString,
  caption: optionalString,
  type: optionalString,
  productType: optionalString,
  displayUrl: optionalString,
  videoUrl: optionalString,
  timestamp: optionalString,
  videoViewCount: optionalNumber,
  videoPlayCount: optionalNumber,
  likesCount: optionalNumber,
  commentsCount: optionalNumber,
  ownerUsername: optionalString,
  transcript: optionalString,
});

const ApifyReels = Schema.Array(ApifyReel);

type ApifyPostValue = typeof ApifyPost.Type;
type ApifyProfileValue = typeof ApifyProfile.Type;
type ApifyReelValue = typeof ApifyReel.Type;

const nonEmpty = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const timestamp = (value: string | null | undefined): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const normalizePost = (post: ApifyPostValue): MarketPost | undefined => {
  const externalId = nonEmpty(post.id) ?? nonEmpty(post.shortCode);
  const permalink = nonEmpty(post.url);
  if (!externalId || !permalink) return undefined;
  return {
    externalId,
    permalink,
    mediaType: nonEmpty(post.type) ?? "Unknown",
    publishedAt: timestamp(post.timestamp),
    ...(nonEmpty(post.shortCode) ? { shortCode: nonEmpty(post.shortCode) } : {}),
    ...(nonEmpty(post.caption) ? { caption: nonEmpty(post.caption) } : {}),
    ...(nonEmpty(post.productType) ? { productType: nonEmpty(post.productType) } : {}),
    ...(nonEmpty(post.displayUrl) ? { thumbnailUrl: nonEmpty(post.displayUrl) } : {}),
    ...(nonEmpty(post.videoUrl) ? { videoUrl: nonEmpty(post.videoUrl) } : {}),
    ...(post.videoViewCount != null ? { views: post.videoViewCount } : {}),
    ...(post.videoPlayCount != null ? { plays: post.videoPlayCount } : {}),
    ...(post.likesCount != null ? { likes: post.likesCount } : {}),
    ...(post.commentsCount != null ? { comments: post.commentsCount } : {}),
    ...(nonEmpty(post.ownerUsername) ? { ownerHandle: nonEmpty(post.ownerUsername) } : {}),
  };
};

const normalizeProfile = (profile: ApifyProfileValue): MarketProfile | undefined => {
  const handle = nonEmpty(profile.username);
  if (!handle) return undefined;
  return {
    handle,
    profileUrl: nonEmpty(profile.url) ?? `https://www.instagram.com/${handle}/`,
    private: profile.private ?? false,
    verified: profile.verified ?? false,
    latestPosts: (profile.latestPosts ?? []).flatMap((post) => {
      const normalized = normalizePost(post);
      return normalized ? [normalized] : [];
    }),
    ...(nonEmpty(profile.id) ? { externalId: nonEmpty(profile.id) } : {}),
    ...(nonEmpty(profile.fullName) ? { displayName: nonEmpty(profile.fullName) } : {}),
    ...(nonEmpty(profile.biography) ? { biography: nonEmpty(profile.biography) } : {}),
    ...((nonEmpty(profile.profilePicUrlHD) ?? nonEmpty(profile.profilePicUrl))
      ? { profileImageUrl: nonEmpty(profile.profilePicUrlHD) ?? nonEmpty(profile.profilePicUrl) }
      : {}),
    ...(profile.followersCount != null ? { followers: profile.followersCount } : {}),
    ...(profile.followsCount != null ? { following: profile.followsCount } : {}),
    ...(profile.postsCount != null ? { postsCount: profile.postsCount } : {}),
    ...(nonEmpty(profile.businessCategoryName)
      ? { businessCategory: nonEmpty(profile.businessCategoryName) }
      : {}),
  };
};

const APIFY_BASE = "https://api.apify.com/v2/acts";
const PROFILE_ACTOR = "apify~instagram-scraper";
const REEL_ACTOR = "apify~instagram-reel-scraper";

const apifyRun = <A>(
  token: string,
  actor: string,
  operation: string,
  input: unknown,
  schema: Schema.Codec<A, unknown>,
): Effect.Effect<A, MarketProviderFailed> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(
        `${APIFY_BASE}/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      return response.json() as Promise<unknown>;
    },
    catch: (error) =>
      new MarketProviderFailed({
        operation,
        message: error instanceof Error ? error.message : String(error),
      }),
  }).pipe(
    Effect.flatMap((value) =>
      decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError(
          (error) =>
            new MarketProviderFailed({ operation, message: `decode failed: ${String(error)}` }),
        ),
      ),
    ),
    Effect.timeout("4 minutes"),
    Effect.retry({ times: 1, schedule: Schedule.exponential("500 millis") }),
    Effect.mapError((error) =>
      error instanceof MarketProviderFailed
        ? error
        : new MarketProviderFailed({ operation, message: "Apify timed out" }),
    ),
  );

export const apifyMarketDataLayer = (token: string): Layer.Layer<MarketDataProvider> =>
  Layer.succeed(MarketDataProvider, {
    searchProfiles: (queries) =>
      Effect.forEach(
        queries.slice(0, 5),
        (query) =>
          apifyRun(
            token,
            PROFILE_ACTOR,
            `profile_search:${query}`,
            {
              directUrls: [],
              search: query,
              searchType: "user",
              searchLimit: 20,
              resultsType: "details",
              resultsLimit: 20,
              addParentData: false,
              addProfileStatistics: true,
              proxyConfiguration: { useApifyProxy: true },
            },
            ApifyProfiles,
          ),
        { concurrency: 5 },
      ).pipe(
        Effect.map((groups) => {
          const byHandle = new Map<string, MarketProfile>();
          for (const raw of groups.flat()) {
            const profile = normalizeProfile(raw);
            if (profile) byHandle.set(profile.handle.toLocaleLowerCase(), profile);
          }
          return [...byHandle.values()];
        }),
      ),
    getProfiles: (handles) =>
      handles.length === 0
        ? Effect.succeed([])
        : apifyRun(
            token,
            PROFILE_ACTOR,
            "profiles",
            {
              directUrls: handles.map((handle) => `https://www.instagram.com/${handle}/`),
              resultsType: "details",
              resultsLimit: handles.length,
              addProfileStatistics: true,
              proxyConfiguration: { useApifyProxy: true },
            },
            ApifyProfiles,
          ).pipe(
            Effect.map((items) =>
              items.flatMap((raw) => {
                const profile = normalizeProfile(raw);
                return profile ? [profile] : [];
              }),
            ),
          ),
    getReel: (permalink) =>
      apifyRun(
        token,
        REEL_ACTOR,
        "reel",
        {
          username: [permalink],
          resultsLimit: 1,
          includeTranscript: true,
          downloadVideos: false,
        },
        ApifyReels,
      ).pipe(
        Effect.flatMap((items) => {
          const raw: ApifyReelValue | undefined = items[0];
          if (!raw)
            return new MarketProviderFailed({ operation: "reel", message: "empty dataset" });
          const normalized = normalizePost(raw);
          if (!normalized)
            return new MarketProviderFailed({
              operation: "reel",
              message: "missing reel identity",
            });
          return Effect.succeed({
            ...normalized,
            ...(nonEmpty(raw.transcript) ? { transcript: nonEmpty(raw.transcript) } : {}),
          });
        }),
      ),
  });

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
      relevant: Schema.Boolean,
      relevanceScore: Schema.Number,
      reason: Schema.String,
    }),
  ),
});

const brandPrompt = (brandContext: string): string =>
  `Você está preparando a busca de concorrentes e criadores para uma marca no Instagram. ` +
  `Identifique a categoria principal, localização/mercado e idioma. Gere exatamente 5 consultas ` +
  `genéricas de 1 a 4 palavras para a busca do Instagram, usando nomes de profissão, especialidade ` +
  `e sinônimos locais. Nunca invente usernames, nunca use @ e não inclua as palavras perfil, ` +
  `Instagram ou pequena empresa. Exemplo válido: "cirurgião bucomaxilofacial". As buscas devem ` +
  `encontrar profissionais ou negócios que publiquem conteúdo no mesmo campo. Responda em ` +
  `português do Brasil.\n\nContexto confirmado da marca:\n${brandContext}`;

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
    `somente pelo material fornecido. relevant=true apenas quando o perfil atua claramente no ` +
    `mesmo campo da marca. Dê relevanceScore de 0 a 1 e uma razão factual e curta em português. ` +
    `Preserve exatamente cada handle.\n\nMarca:\n${brandContext}\n\nMercado inferido: ` +
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
      return profiles.flatMap((profile) => {
        const ranking = byHandle.get(profile.handle.toLocaleLowerCase());
        if (!ranking?.relevant) return [];
        return [
          {
            profile,
            relevanceScore: Math.max(0, Math.min(1, ranking.relevanceScore)),
            relevanceReason: ranking.reason,
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
}

const formatNumber = (value: number): string =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);

export const detectBreakout = (
  current: SnapshotInput,
  previous?: SnapshotInput | undefined,
): BreakoutDecision | undefined => {
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
        };
      }
    }
  }

  if (followers !== undefined && followers > 0 && views >= 1_000) {
    const ratio = views / followers;
    if (ratio >= 1.2) {
      return {
        score: Math.min(100, 60 + ratio * 4),
        triggerType: "audience_ratio",
        reason: `${formatNumber(views)} visualizações com ${formatNumber(followers)} seguidores — ${formatNumber(ratio)}× o tamanho da audiência.`,
      };
    }
  }

  if (views >= 5_000) {
    return {
      score: Math.min(100, 50 + views / 1_000),
      triggerType: "absolute_threshold",
      reason: `A publicação passou de ${formatNumber(views)} visualizações.`,
    };
  }

  return undefined;
};
