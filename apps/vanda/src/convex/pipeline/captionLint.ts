/**
 * Feed caption checks from the instagram-caption skill: what survives the
 * "… mais" cut, one ask, at most five specific hashtags, no dead links.
 * FAIL blocks an autopilot post; WARN is reported to the writer.
 */

export const CAPTION_LIMIT = 2200;

export const VISIBLE_CHARS = 125;

export const HASHTAG_LIMIT = 5;

export type LintStatus = "PASS" | "WARN" | "FAIL";

export interface LintCheck {
  readonly check: string;
  readonly status: LintStatus;
  readonly detail: string;
}

export interface CaptionLint {
  readonly verdict: "READY" | "REVIEW" | "FIX";
  readonly checks: readonly LintCheck[];
  readonly visible: string;
  readonly hashtags: readonly string[];
  readonly asks: readonly string[];
}

const HASHTAG_RE = /(?:^|\s)(#[\p{L}\p{N}_]+)/gu;

const LINK_RE =
  /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|com\.br|br|co|io|net|org|ai|app)\/\S*/giu;

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

const CONCRETE_RE = /R\$\s?\d|\d|(?<!^)\b\p{Lu}\p{Ll}{2,}/mu;

const ASKS: readonly (readonly [RegExp, string])[] = [
  [/\bcomente\s+(?:a palavra\s+)?["“]?\p{Lu}{2,}\b/u, "comentar palavra-chave"],
  [
    /\b(?:me chama|chama|manda|mande)\s+(?:no|na|uma?)?\s*(?:dm|direct|inbox|mensagem)\b/iu,
    "mandar DM",
  ],
  [/\bsalv[ae]\s+(?:esse|este|o|pra|para)\b/iu, "salvar"],
  [/\b(?:compartilh[ae]|envi[ae]|mand[ae])\s+(?:esse|este|com|pra|para)\b/iu, "compartilhar"],
  [/\bsig[ae]\s+(?:o|a|@|nosso|nossa|a gente)/iu, "seguir"],
  [/\blink\s+na\s+bio\b/iu, "link na bio"],
  [/\b(?:conta|conte|me diz|diz aí|qual (?:é|e) o seu|qual você)\b/iu, "responder pergunta"],
];

const FILLER_TAGS = new Set([
  "#viral",
  "#fyp",
  "#explore",
  "#explorepage",
  "#foryou",
  "#foryoupage",
  "#trending",
  "#instagood",
  "#love",
  "#follow",
  "#like4like",
  "#reels",
  "#reelsinstagram",
  "#instadaily",
  "#tbt",
]);

export const lintCaption = (
  text: string,
  options: { readonly keywords?: readonly string[] } = {},
): CaptionLint => {
  const caption = text.trim();
  const chars = [...caption].length;
  const firstLine = caption.split("\n")[0]?.trim() ?? "";
  const visible = [...caption].slice(0, VISIBLE_CHARS).join("");
  const hashtags = [...caption.matchAll(HASHTAG_RE)].map((match) => match[1]!);
  const links = caption.match(LINK_RE) ?? [];
  const emoji = caption.match(EMOJI_RE) ?? [];
  const asks = ASKS.flatMap(([pattern, name]) => (pattern.test(caption) ? [name] : []));
  const filler = hashtags.filter((tag) => FILLER_TAGS.has(tag.toLowerCase()));
  const checks: LintCheck[] = [];

  const add = (check: string, status: LintStatus, detail: string) =>
    checks.push({ check, status, detail });

  add(
    "TAMANHO",
    chars > CAPTION_LIMIT ? "FAIL" : chars === 0 ? "FAIL" : "PASS",
    `${chars} / ${CAPTION_LIMIT} caracteres`,
  );

  if (!firstLine) add("PRIMEIRA LINHA", "FAIL", "a legenda começa em branco");
  else if (/^[#@]/.test(firstLine))
    add("PRIMEIRA LINHA", "FAIL", "começa com hashtag ou menção, a posição mais valiosa");
  else if (/^\p{Extended_Pictographic}/u.test(firstLine))
    add("PRIMEIRA LINHA", "WARN", "começa com emoji");
  else if ([...firstLine].length > VISIBLE_CHARS)
    add(
      "PRIMEIRA LINHA",
      "WARN",
      `${[...firstLine].length} caracteres; o feed corta em ~${VISIBLE_CHARS}`,
    );
  else add("PRIMEIRA LINHA", "PASS", `${[...firstLine].length} caracteres, aparece inteira`);

  add(
    "GANCHO CONCRETO",
    CONCRETE_RE.test(visible) ? "PASS" : "WARN",
    CONCRETE_RE.test(visible)
      ? "número, valor ou nome visível antes do “mais”"
      : "nada concreto antes do “mais”",
  );

  if (hashtags.length > HASHTAG_LIMIT)
    add(
      "HASHTAGS",
      "FAIL",
      `${hashtags.length} hashtags; o limite do Instagram é ${HASHTAG_LIMIT}`,
    );
  else if (filler.length > 0) add("HASHTAGS", "WARN", `hashtags genéricas: ${filler.join(", ")}`);
  else add("HASHTAGS", "PASS", `${hashtags.length} hashtag(s)`);

  if (hashtags.some((tag) => visible.includes(tag)))
    add("POSIÇÃO DAS HASHTAGS", "WARN", "hashtag dentro da área visível");

  add(
    "LINKS",
    links.length > 0 ? "FAIL" : "PASS",
    links.length > 0 ? "link na legenda não é clicável; use a bio ou DM" : "sem links",
  );

  if (asks.length === 1) add("UM PEDIDO", "PASS", `pedido: ${asks[0]}`);
  else if (asks.length === 0) add("UM PEDIDO", "WARN", "sem chamada para ação");
  else
    add(
      "UM PEDIDO",
      "WARN",
      `${asks.length} pedidos (${asks.join(", ")}); dois pedidos equivalem a nenhum`,
    );

  const density = (emoji.length * 100) / Math.max(chars, 1);
  add(
    "EMOJI",
    density > 4 ? "WARN" : "PASS",
    `${emoji.length} emoji, ${density.toFixed(1)} a cada 100 caracteres`,
  );

  const keywords = (options.keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean);

  if (keywords.length > 0) {
    const lower = caption.toLowerCase();
    const missing = keywords.filter((keyword) => !lower.includes(keyword.toLowerCase()));
    add(
      "TERMOS DE BUSCA",
      missing.length === 0 ? "PASS" : missing.length < keywords.length ? "WARN" : "FAIL",
      missing.length === 0 ? "todos presentes" : `faltando: ${missing.join(", ")}`,
    );
  }

  const verdict = checks.some((check) => check.status === "FAIL")
    ? "FIX"
    : checks.some((check) => check.status === "WARN")
      ? "REVIEW"
      : "READY";

  return { verdict, checks, visible, hashtags, asks };
};

/** One line per non-passing check, for a repair prompt or an error. */
export const lintProblems = (lint: CaptionLint): string =>
  lint.checks
    .filter((check) => check.status !== "PASS")
    .map((check) => `${check.status} ${check.check}: ${check.detail}`)
    .join("\n");
