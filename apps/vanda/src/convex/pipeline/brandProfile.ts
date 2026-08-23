import * as Effect from "effect/Effect";
import * as LanguageModel from "effect/unstable/ai/LanguageModel";
import { BrandAnalysis, type BrandCorpus } from "./brand";

/** Cap the corpus fed to the model so a large account stays within a sane prompt. */
const MAX_CAPTIONS = 25;
const MAX_COMMENTS = 50;

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
 * provenance the Confirmar screen surfaces so a single comment can't masquerade
 * as a confident fact. All output is Brazilian Portuguese: this is product copy.
 */
const buildPrompt = (corpus: BrandCorpus): string =>
  [
    "Você é a Vanda, uma agência de marketing autônoma. Analise a conta de Instagram de",
    "um pequeno negócio e devolva, em português do Brasil, o que você entendeu sobre a marca.",
    "",
    'Em cada campo, escreva `evidence` citando a base (ex.: "Detectado em 18 posts",',
    '"Citado em 7 comentários", "Do perfil e bio") e `confidence` de 0 a 1 — quão segura você',
    "está, considerando a quantidade e a independência das evidências. Seja conservadora: um",
    "único comentário é confiança baixa.",
    "",
    "- identity: uma frase dizendo o que é o negócio (nome, categoria, lugar).",
    "- summary: 2 a 3 frases descrevendo a marca, escritas com a sua voz.",
    "- kind: 'negocio' (lugar/produto) ou 'pessoal' (uma pessoa é a marca — o dono aparece nos posts).",
    "- voice: adjetivos do tom de voz da marca.",
    "- themes: assuntos recorrentes nos posts.",
    "- characters: personagens recorrentes (pessoas, pets, mascotes).",
    "- restrictions: restrições de segurança a respeitar (o que a marca deve evitar).",
    "- opportunities: primeiras ideias de conteúdo por onde a Vanda começaria.",
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
 * read of the brand. Pure transform (corpus in, analysis out) over the
 * `LanguageModel` — the action owns the I/O on both sides (fetch the corpus,
 * return the analysis to the client). `generateObject` decodes the model output
 * against `BrandAnalysis`, so an out-of-range confidence fails the pass loudly
 * rather than persisting a malformed card.
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
