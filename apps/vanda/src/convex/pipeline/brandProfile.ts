import * as Effect from "effect/Effect";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import type { BrandFact, BrandFactKind } from "../brandFile";
import { BrandAnalysis, type BrandCorpus, type BrandGroup, type BrandText } from "./brand";

/** Cap the corpus fed to the model so a large account stays within a sane prompt. */
const MAX_CAPTIONS = 25;

const MAX_COMMENTS = 50;

/** Marketing words the owner never hears from the agents: plain Portuguese instead. */
export const JARGON = "tipo de post, persona, paleta, engajamento, branding, público-alvo";

const profileLines = (profile: BrandCorpus["profile"]): string => {
  const lines = [
    profile.name !== undefined ? `Nome: ${profile.name}` : null,
    profile.username !== undefined ? `@${profile.username}` : null,
    profile.accountType !== undefined ? `Tipo de conta: ${profile.accountType}` : null,
    profile.mediaCount !== undefined ? `Total de publicações: ${profile.mediaCount}` : null,
    profile.followers !== undefined ? `Seguidores: ${profile.followers}` : null,
    profile.reach !== undefined ? `Alcance recente: ${profile.reach}` : null,
    profile.views !== undefined ? `Visualizações recentes: ${profile.views}` : null,
    profile.biography !== undefined ? `Bio: ${profile.biography}` : null,
  ].filter((line): line is string => line !== null);

  return lines.length > 0 ? lines.join("\n") : "(sem dados de perfil)";
};

const bulleted = (items: ReadonlyArray<string>, empty: string): string =>
  items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : empty;

/**
 * The brand-analysis prompt. Deterministic in the corpus (so it can be recorded
 * to a cassette), it asks for evidence + confidence on every card — the
 * provenance that keeps a single comment from landing in the brand file as a
 * confident fact. All output is Brazilian Portuguese: this is product copy.
 */
const buildPrompt = (corpus: BrandCorpus): string =>
  [
    "Você é a Vanda, uma agência de marketing autônoma. Analise a conta de Instagram de",
    "um pequeno negócio e devolva, em português do Brasil, o que você entendeu sobre a marca.",
    "Isso abre o arquivo da marca e a primeira conversa com o dono: seja concreta e fiel ao que está nos dados.",
    "",
    'Em cada campo, escreva `evidence` citando a base (ex.: "Detectado em 18 posts",',
    '"Citado em 7 comentários", "Do perfil e bio") e `confidence` de 0 a 1 — quão segura você',
    "está, considerando a quantidade e a independência das evidências. Seja conservadora: um",
    "único comentário é confiança baixa; o que não aparece nos dados tem confiança 0 e texto vazio.",
    "",
    "- identity: uma frase dizendo o que é o negócio (nome, categoria, lugar).",
    "- summary: 2 a 3 frases descrevendo a marca, escritas com a sua voz.",
    "- kind: 'negocio' (lugar/produto) ou 'pessoal' (uma pessoa é a marca — o dono aparece nos posts).",
    "- location: onde o negócio atende (bairro, cidade, online, entrega) quando os dados dizem.",
    "- positioning: por que escolher esta marca e não outra, na voz dela.",
    "- offers: produtos ou serviços concretos, com preço quando citado (um item por oferta).",
    "- audience: para quem a marca fala, como necessidades ou situações ('quem trabalha de casa e precisa de…').",
    "- voice: adjetivos do tom de voz da marca.",
    "- themes: assuntos recorrentes nos posts.",
    "- characters: personagens recorrentes (pessoas, pets, mascotes).",
    "- proof: credenciais, números, prêmios ou depoimentos que os dados confirmam.",
    "- restrictions: restrições de segurança a respeitar (o que a marca deve evitar).",
    "- opportunities: primeiras ideias de conteúdo por onde a Vanda começaria.",
    "- opener: a primeira mensagem do Caetano, o macaquinho do Vanda Studio, ao dono. Ele vai conhecer o",
    "  negócio com o dono numa conversa rápida. Até 3 frases curtas: um oi; algo concreto que você viu nos",
    "  posts (um produto, um tema, o jeito de falar); e UMA pergunta, sobre UM só assunto, do que os dados não",
    "  mostram e mais importa saber, citando o que viu. Um único ponto de interrogação: nunca junte dois assuntos",
    "  nem peça para o dono citar outra coisa. Informal, sem textão.",
    `  Linguagem simples, sem jargão de marketing (nada de ${JARGON}):`,
    "  o dono é dono de pequeno negócio, não profissional de marketing. A pergunta deve ser sobre algo que ele",
    "  sabe do próprio negócio (por exemplo, o preço OU quem compra, nunca os dois).",
    "",
    "=== PERFIL ===",
    profileLines(corpus.profile),
    "",
    `=== LEGENDAS (${Math.min(corpus.captions.length, MAX_CAPTIONS)}) ===`,
    bulleted(corpus.captions.slice(0, MAX_CAPTIONS), "(sem legendas)"),
    "",
    `=== COMENTÁRIOS (${Math.min(corpus.comments.length, MAX_COMMENTS)}) ===`,
    bulleted(corpus.comments.slice(0, MAX_COMMENTS), "(sem comentários)"),
  ].join("\n");

/**
 * The brand-profile stage: one structured LLM pass turning a corpus into Vanda's
 * read of the brand. `generateObject` decodes the output against `BrandAnalysis`,
 * so an out-of-range confidence fails the pass rather than persisting a bad card.
 */
export const proposeBrandProfile = Effect.fn("pipeline.proposeBrandProfile")(function* (
  corpus: BrandCorpus,
) {
  const response = yield* LanguageModel.generateObject({
    prompt: buildPrompt(corpus),
    schema: BrandAnalysis,
  });

  return response.value;
});

/** Below this the read is a guess: Caetano asks in the brand guide instead. */
const CONFIDENT = 0.5;

/**
 * The confident cards of the analysis as brand file items, observed with their
 * evidence and date: the owner's word in the conversation overrides them.
 */
export const analysisFacts = (analysis: BrandAnalysis, at: number): BrandFact[] => {
  const date = new Date(at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const facts = (kind: BrandFactKind, card: BrandText | BrandGroup): BrandFact[] =>
    card.confidence < CONFIDENT
      ? []
      : ("text" in card ? [card.text] : card.items)
          .filter((text) => text.trim())
          .map((text) => ({ kind, text, origin: `observado: ${card.evidence}, ${date}` }));

  return [
    ...facts("identity", analysis.identity),
    ...facts("summary", analysis.summary),
    ...facts("location", analysis.location),
    ...facts("offer", analysis.offers),
    ...facts("positioning", analysis.positioning),
    ...facts("audience", analysis.audience),
    ...facts("voice", analysis.voice),
    ...facts("character", analysis.characters),
    ...facts("proof", analysis.proof),
    ...facts("restriction", analysis.restrictions),
  ];
};
