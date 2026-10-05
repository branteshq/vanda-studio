import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import { autopilotPostTypes, type AuditMetrics, type CadenceEntry } from "../autopilotModel";
import { ConnectedInstagramProvider } from "../instagram/service";
import type { InstagramPost, InstagramProfile, InstagramTarget } from "../instagram/types";
import { postPurposes, type PostPurpose } from "../postPurposes";
import { findInstalledSkill } from "../skills/catalog";
import {
  cadenceSummary,
  computeAccountMetrics,
  confidenceFor,
  formatHour,
  localSlot,
  normalizeCadence,
  purposeLabels,
  slidesLabel,
  type MetricBasis,
  type ScoredPost,
} from "./autopilot";

/**
 * The autopilot's two thinking stages, as pure transforms over the
 * `LanguageModel`: the account audit (evidence in, diagnosis out) and the
 * weekly plan (diagnosis + brand + history in, slot briefs out). Metrics are
 * computed deterministically before the model sees them, so the model ranks
 * and explains — it never does arithmetic.
 */

const AUDIT_SAMPLE = 30;

const INSIGHT_CONCURRENCY = 4;

const skillText = (name: string, extraFile?: string): string => {
  const skill = findInstalledSkill(name);

  if (!skill) return "";

  const extra = extraFile ? skill.files[extraFile] : undefined;

  return extra ? `${skill.body}\n\n${extraFile}:\n${extra}` : skill.body;
};

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

// --------------------------------------------------------------------- audit

const Weekday = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 6 }));

const CadenceEntrySchema = Schema.Struct({
  weekday: Weekday,
  time: Schema.String,
  type: Schema.Literals(autopilotPostTypes),
  slideCount: Schema.Finite,
});

export const AuditOutput = Schema.Struct({
  summary: Schema.String,
  rubric: Schema.Array(
    Schema.Struct({
      item: Schema.String,
      score: Schema.Finite,
      max: Schema.Finite,
      fix: Schema.String,
    }),
  ),
  postNotes: Schema.Array(Schema.Struct({ postId: Schema.String, why: Schema.String })),
  findings: Schema.Array(
    Schema.Struct({ claim: Schema.String, evidence: Schema.String, n: Schema.Finite }),
  ),
  stop: Schema.Array(Schema.String),
  doMore: Schema.Array(Schema.String),
  needs: Schema.Array(Schema.String),
  recommendedCadence: Schema.Array(CadenceEntrySchema),
  cadenceRationale: Schema.String,
});

export type AuditOutput = typeof AuditOutput.Type;

export interface AuditResult {
  readonly basis: MetricBasis;
  readonly metrics: AuditMetrics;
  readonly confidence: "baixa" | "media" | "alta";
  readonly profileScore: number;
  readonly top: readonly ScoredPost[];
  readonly bottom: readonly ScoredPost[];
  readonly output: AuditOutput;
  readonly recommendedCadence: readonly CadenceEntry[];
}

export interface PreviousResult {
  readonly scheduledFor: number;
  readonly type: string;
  readonly slideCount: number;
  readonly purpose: PostPurpose;
  readonly hook: string;
  readonly outlier?: number | undefined;
  readonly reach?: number | undefined;
  readonly shares?: number | undefined;
  readonly saves?: number | undefined;
}

const percent = (value: number | undefined): string =>
  value === undefined ? "desconhecido" : `${(value * 100).toFixed(1)}%`;

const postLine = (item: ScoredPost, basis: MetricBasis): string => {
  const when =
    item.post.publishedAt === undefined
      ? "data desconhecida"
      : (() => {
          const slot = localSlot(item.post.publishedAt);

          return `dia ${slot.weekday} ${formatHour(slot.time)}`;
        })();

  const caption = (item.post.caption ?? "").replace(/\s+/g, " ").slice(0, 160);

  return [
    `- id=${item.post.id} · ${item.outlier}× · ${item.post.mediaType} · ${when}`,
    `${basis === "reach" ? "alcance" : "interações"}=${item.value}`,
    `envios/alcance=${percent(item.sharesPerReach)}`,
    `salvos/alcance=${percent(item.savesPerReach)}`,
    `"${caption}"`,
  ].join(" · ");
};

const resultLine = (result: PreviousResult): string => {
  const slot = localSlot(result.scheduledFor);

  return `- dia ${slot.weekday} ${formatHour(slot.time)} · ${result.type} ${slidesLabel(result.slideCount)} · ${purposeLabels[result.purpose]} · "${result.hook}" · ${result.outlier === undefined ? "sem resultado ainda" : `${result.outlier}× da mediana`}`;
};

const buildAuditPrompt = (input: {
  readonly brand: string;
  readonly evidence: AccountEvidence;
  readonly metrics: ReturnType<typeof computeAccountMetrics>;
  readonly previous: readonly PreviousResult[];
  readonly previousSummary?: string | undefined;
}): string => {
  const { metrics, basis, ranked } = input.metrics;

  return [
    "Você é a Vanda, agência de marketing autônoma. Faça o diagnóstico da conta de Instagram do dono",
    "para o piloto automático de posts de feed (imagem e carrossel). Escreva em português do Brasil.",
    "Siga a habilidade abaixo. As métricas já foram calculadas: não refaça contas, interprete-as.",
    "",
    "<habilidade>",
    skillText("instagram-account-audit", "rubric.json"),
    "</habilidade>",
    "",
    "Regras da saída:",
    "- rubric: pontue só itens observáveis com os dados abaixo (nome, usuário, atividade recente, grade/legendas).",
    "  Itens que você não consegue ver (destaques, stories, link) ficam de fora. Cada fix diz a correção concreta.",
    "- postNotes: para cada post dos melhores e piores, por que ele foi bem ou mal (1 frase, use o id).",
    "- findings: afirmações com evidência e n. Com poucos posts, diga que não há padrão.",
    "- stop, doMore, needs: listas curtas e concretas. needs = do que a conta mais precisa agora.",
    "- recommendedCadence: 3 a 5 posts de feed por semana. weekday 0=domingo … 6=sábado, time HH:mm",
    "  (America/Sao_Paulo), type image (slideCount 1) ou carousel (2 a 10 slides). Use horários com",
    "  evidência quando houver; senão, início da noite (consumidor) ou manhã (B2B) e sábado ao meio-dia.",
    "- cadenceRationale: uma ou duas frases explicando a cadência para o dono.",
    "",
    "=== MARCA ===",
    input.brand || "(sem memória de marca confirmada)",
    "",
    "=== PERFIL ===",
    `@${input.evidence.profile?.handle ?? "?"} · nome: ${input.evidence.profile?.name ?? "?"} · seguidores: ${input.evidence.followers ?? "desconhecido"}`,
    `Posts lidos: ${input.evidence.posts.length} (feed: ${input.evidence.feedPosts.length})`,
    "",
    "=== MÉTRICAS (base: " +
      (basis === "reach" ? "alcance privado" : "interações públicas") +
      ") ===",
    `mediana=${metrics.medianReach ?? "?"} · salvos/alcance=${percent(metrics.savesPerReach)} · envios/alcance=${percent(metrics.sharesPerReach)}`,
    `posts por semana=${metrics.postsPerWeek ?? "?"} · dias desde o último post=${metrics.daysSinceLastPost ?? "?"}`,
    `por formato: ${metrics.byFormat.map((b) => `${b.key} ${b.meanOutlier}× (n=${b.n})`).join("; ") || "-"}`,
    `por dia/hora: ${metrics.byHour.map((b) => `${b.key} ${b.meanOutlier}× (n=${b.n})`).join("; ") || "-"}`,
    "",
    "=== MELHORES (múltiplo da mediana) ===",
    ranked
      .slice(0, 5)
      .map((item) => postLine(item, basis))
      .join("\n") || "(nenhum)",
    "",
    "=== PIORES ===",
    ranked
      .slice(-5)
      .toReversed()
      .map((item) => postLine(item, basis))
      .join("\n") || "(nenhum)",
    "",
    "=== POSTS DO PILOTO AUTOMÁTICO NAS ÚLTIMAS SEMANAS ===",
    input.previous.map(resultLine).join("\n") || "(ainda nenhum)",
    "",
    input.previousSummary ? `=== DIAGNÓSTICO ANTERIOR ===\n${input.previousSummary}` : "",
  ].join("\n");
};

/**
 * The account audit: deterministic metrics, then one structured pass that
 * scores the observable profile, explains the extremes and recommends a
 * cadence. Reranking happens here: last weeks' autopilot results are part of
 * the evidence.
 */
export const auditAccount = Effect.fn("autopilot.auditAccount")(function* (input: {
  readonly brand: string;
  readonly evidence: AccountEvidence;
  readonly previous: readonly PreviousResult[];
  readonly previousSummary?: string | undefined;
  readonly now: number;
}) {
  const computed = computeAccountMetrics(input.evidence.feedPosts, {
    followers: input.evidence.followers,
    now: input.now,
  });

  const response = yield* LanguageModel.generateObject({
    prompt: buildAuditPrompt({ ...input, metrics: computed }),
    schema: AuditOutput,
  });

  const output = response.value;
  const scored = output.rubric.filter((item) => item.max > 0);
  const max = scored.reduce((sum, item) => sum + item.max, 0);

  const got = scored.reduce((sum, item) => sum + Math.min(item.max, Math.max(0, item.score)), 0);

  const recommended = normalizeCadence(output.recommendedCadence);

  return {
    basis: computed.basis,
    metrics: computed.metrics,
    confidence: confidenceFor(input.evidence.feedPosts.length),
    profileScore: max > 0 ? Math.round((got / max) * 100) : 0,
    top: computed.ranked.slice(0, 5),
    bottom: computed.ranked.slice(-5).toReversed(),
    output,
    recommendedCadence: recommended,
  } satisfies AuditResult;
});

// ---------------------------------------------------------------------- plan

const Purpose = Schema.Literals(postPurposes);

export const PlanOutput = Schema.Struct({
  strategy: Schema.String,
  slots: Schema.Array(
    Schema.Struct({
      index: Schema.Finite,
      purpose: Purpose,
      theme: Schema.String,
      angle: Schema.String,
      hook: Schema.String,
      slideOutline: Schema.Array(Schema.String),
      captionBrief: Schema.String,
    }),
  ),
});

export type PlanOutput = typeof PlanOutput.Type;

export interface PlannedSlotBrief {
  readonly purpose: PostPurpose;
  readonly theme: string;
  readonly angle: string;
  readonly hook: string;
  readonly slideOutline: readonly string[];
  readonly captionBrief: string;
}

export interface PlanInput {
  readonly brand: string;
  readonly auditSummary: string;
  readonly cadence: readonly CadenceEntry[];
  /** Briefs the owner fixed in this week, by cadence index: keep, plan around them. */
  readonly fixed: ReadonlyMap<number, PlannedSlotBrief>;
  readonly recentThemes: readonly string[];
  readonly weekLabel: string;
}

const cadenceLine = (entry: CadenceEntry, index: number, fixed?: PlannedSlotBrief): string => {
  const base = `${index}. dia ${entry.weekday} ${formatHour(entry.time)} · ${entry.type} · ${slidesLabel(entry.slideCount)}`;

  return fixed
    ? `${base} · FIXADO PELO DONO: ${purposeLabels[fixed.purpose]} — "${fixed.hook}" (não altere)`
    : base;
};

const buildPlanPrompt = (input: PlanInput): string =>
  [
    "Você é a Vanda. Planeje o conteúdo da semana de posts de feed do piloto automático, em português do Brasil.",
    "Siga as habilidades abaixo. A cadência (dias, horários, tipo e slides) já está decidida: preencha",
    "cada slot pelo índice. Mantenha slots FIXADOS como estão, mas considere-os na mistura.",
    "",
    "<habilidade>",
    skillText("instagram-weekly-plan"),
    "</habilidade>",
    "<habilidade>",
    skillText("instagram-caption"),
    "</habilidade>",
    "",
    "Regras da saída:",
    "- slots: um por índice da cadência, inclusive os fixados (repita os dados deles).",
    "- purpose: um destes ids: " +
      postPurposes.join(", ") +
      ". Nunca o mesmo propósito em slots seguidos.",
    "- hook: a capa, até 6 palavras, concreta.",
    "- slideOutline: exatamente um item por slide, com a função e o texto do slide.",
    "- captionBrief: o que a legenda deve dizer, o pedido único e 1 a 3 termos de busca.",
    "- Use apenas fatos da marca; quando faltar um dado, escreva {{dado do dono}}.",
    "- strategy: uma frase explicando a lógica da semana para o dono.",
    "",
    `=== SEMANA: ${input.weekLabel} · ${cadenceSummary(input.cadence)} ===`,
    input.cadence
      .map((entry, index) => cadenceLine(entry, index, input.fixed.get(index)))
      .join("\n"),
    "",
    "=== MARCA ===",
    input.brand || "(sem memória de marca confirmada)",
    "",
    "=== DIAGNÓSTICO ===",
    input.auditSummary || "(sem diagnóstico: use as regras gerais da habilidade)",
    "",
    "=== TEMAS RECENTES (não repita) ===",
    input.recentThemes.map((theme) => `- ${theme}`).join("\n") || "(nenhum)",
  ].join("\n");

const fitOutline = (outline: readonly string[], slideCount: number, hook: string): string[] => {
  const trimmed = outline.slice(0, slideCount);

  while (trimmed.length < slideCount)
    trimmed.push(trimmed.length === 0 ? hook : "Resumo e chamada");

  return trimmed;
};

/**
 * The weekly plan: one structured pass filling every cadence slot with a
 * purpose, angle, hook and slide outline. Owner-fixed slots are returned
 * untouched whatever the model says.
 */
export const planWeek = Effect.fn("autopilot.planWeek")(function* (input: PlanInput) {
  const response = yield* LanguageModel.generateObject({
    prompt: buildPlanPrompt(input),
    schema: PlanOutput,
  });

  const byIndex = new Map(response.value.slots.map((slot) => [slot.index, slot]));

  const briefs = input.cadence.map((entry, index): PlannedSlotBrief => {
    const fixed = input.fixed.get(index);

    if (fixed) return fixed;

    const planned = byIndex.get(index) ?? response.value.slots[index];

    if (!planned) {
      return {
        purpose: "educacional",
        theme: "Conteúdo da marca",
        angle: "Uma dica prática do dia a dia da marca",
        hook: "Uma dica que funciona",
        slideOutline: fitOutline([], entry.slideCount, "Uma dica que funciona"),
        captionBrief: "Explique a dica em frases curtas e peça para salvar.",
      };
    }

    return {
      purpose: planned.purpose,
      theme: planned.theme,
      angle: planned.angle,
      hook: planned.hook,
      slideOutline: fitOutline(planned.slideOutline, entry.slideCount, planned.hook),
      captionBrief: planned.captionBrief,
    };
  });

  return { strategy: response.value.strategy, briefs };
});

/** The audit as compact text for the planner, the workspace mount and agents. */
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
