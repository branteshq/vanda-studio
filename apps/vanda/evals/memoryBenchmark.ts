/**
 * Brand-memory consistency benchmark: one fictional owner talking to Vanda and
 * Caetano across separate conversations. Memory has to survive between them, so
 * each step reads or changes the brand file and later steps depend on it.
 * Checks are deliberately narrow; the transcripts are for human review.
 */

export type MemoryAgent = "vanda" | "caetano";

export interface MemoryStepContext {
  /** Brand file before and after the turn. */
  readonly before: string;
  readonly after: string;
  readonly response: string;
  readonly tools: readonly string[];
  readonly theme: string | undefined;
  readonly imageModel: string | undefined;
}

export interface MemoryCheck {
  readonly label: string;
  readonly pass: (context: MemoryStepContext) => boolean;
}

export interface MemoryStep {
  readonly id: string;
  /** Steps sharing a session continue the same conversation; a new session is a new thread. */
  readonly session: string;
  readonly agent: MemoryAgent;
  readonly prompt: string;
  /** What this step exercises, for the report. */
  readonly probes: string;
  readonly checks: readonly MemoryCheck[];
}

const lower = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const unchanged: MemoryCheck = {
  label: "brand file unchanged",
  pass: ({ before, after }) => before === after,
};

const changed: MemoryCheck = {
  label: "brand file changed",
  pass: ({ before, after }) => before !== after,
};

const keepsFacts: MemoryCheck = {
  label: "earlier facts preserved",
  pass: ({ after }) => after.includes("R$ 16") && after.includes("das 8h às 18h"),
};

const says = (label: string, ...needles: string[]): MemoryCheck => ({
  label,
  pass: ({ response }) => needles.some((needle) => lower(response).includes(lower(needle))),
});

const avoids = (label: string, needle: string): MemoryCheck => ({
  label,
  pass: ({ response }) => !lower(response).includes(lower(needle)),
});

const usedTool = (name: string): MemoryCheck => ({
  label: `used ${name}`,
  pass: ({ tools }) => tools.includes(name),
});

// Legend lines ("- **(dono)**: …") describe the tags; only real items count.
const isLegend = (line: string) => line.startsWith("- **(");

const fileLine = (label: string, pattern: RegExp): MemoryCheck => ({
  label,
  pass: ({ after }) =>
    after.split("\n").some((line) => !isLegend(line) && pattern.test(lower(line))),
});

export const SIGNATURE = "Vem pra varanda.";

export const memorySteps: readonly MemoryStep[] = [
  {
    id: "read-facts",
    session: "a",
    agent: "vanda",
    prompt:
      "Qual o horário de vocês e quanto custa o combo da manhã? Me responde numa frase que eu cole no direct.",
    probes: "reads confirmed facts from the brand file; no write",
    checks: [
      says("mentions 8h", "8h"),
      says("mentions 18h", "18h"),
      says("mentions R$ 16", "16"),
      unchanged,
    ],
  },
  {
    id: "write-preference",
    session: "a",
    agent: "vanda",
    prompt: `Anota aí pra sempre: nunca use a palavra "imperdível" e toda legenda termina com "${SIGNATURE}"`,
    probes: "writes an owner preference as (dono), preserving the rest",
    checks: [
      changed,
      fileLine("signature rule saved as (dono)", /vem pra varanda.*\(dono\)/),
      fileLine("'imperdível' rule saved as (dono)", /imperdivel.*\(dono\)/),
      keepsFacts,
    ],
  },
  {
    id: "recall-new-session",
    session: "b",
    agent: "vanda",
    prompt: "Escreve uma legenda curta pro coado de hoje.",
    probes: "recalls the preference in a new conversation; one-off task, no write",
    checks: [
      says("ends with the signature", "vem pra varanda"),
      avoids("avoids 'imperdível'", "imperdível"),
      unchanged,
    ],
  },
  {
    id: "correction",
    session: "b",
    agent: "vanda",
    prompt:
      "Ficou formal demais. A gente fala mais solto, tipo conversa de vizinho. Lembra disso daqui pra frente.",
    probes: "turns a correction into a lasting (dono) rule in Tom e voz",
    checks: [
      changed,
      fileLine("tone rule saved as (dono)", /(vizinho|solto|informal|descontra).*\(dono\)/),
      keepsFacts,
    ],
  },
  {
    id: "caetano-reads",
    session: "caetano",
    agent: "caetano",
    prompt: "Me manda uma legenda pro pão de queijo.",
    probes: "Caetano reads what Vanda wrote (signature, tone); no write",
    checks: [
      says("ends with the signature", "vem pra varanda"),
      avoids("avoids 'imperdível'", "imperdível"),
      unchanged,
    ],
  },
  {
    id: "observation",
    session: "caetano",
    agent: "caetano",
    prompt:
      "Olha isso: o post do combo da manhã da semana passada teve 3x mais salvamentos que a média dos nossos posts.",
    probes: "records a result as (observado: evidência, data) without being asked",
    checks: [changed, fileLine("observation recorded", /\(observado/), keepsFacts],
  },
  {
    id: "no-write-episode",
    session: "c",
    agent: "vanda",
    prompt: "Faz uma legenda pra hoje que tá chovendo em Recife.",
    probes: "one-off request: nothing goes into the brand file",
    checks: [unchanged, says("still uses the signature", "vem pra varanda")],
  },
  {
    id: "owner-removes-rule",
    session: "c",
    agent: "vanda",
    prompt: `Pode esquecer aquela regra de terminar as legendas com "${SIGNATURE}". Não precisa mais.`,
    probes: "removes a (dono) rule only because the owner asked; keeps the other",
    checks: [
      changed,
      {
        label: "signature rule removed",
        pass: ({ after }) => !lower(after).includes("vem pra varanda"),
      },
      fileLine("'imperdível' rule kept", /imperdivel/),
      keepsFacts,
    ],
  },
  {
    id: "settings-read",
    session: "caetano",
    agent: "caetano",
    prompt: "Qual é o meu plano e que modelo você tá usando agora?",
    probes: "answers from settings_get",
    checks: [usedTool("settings_get"), says("names the ChatGPT plan", "chatgpt"), unchanged],
  },
  {
    id: "settings-write",
    session: "caetano",
    agent: "caetano",
    prompt: "Muda o app pro tema claro, por favor.",
    probes: "changes a setting through settings_set",
    checks: [
      usedTool("settings_set"),
      { label: "theme is light", pass: ({ theme }) => theme === "light" },
      unchanged,
    ],
  },
  {
    id: "docs",
    session: "d",
    agent: "vanda",
    prompt: "Como eu conecto o WhatsApp do Caetano?",
    probes: "explains the product from the docs",
    checks: [usedTool("product_help"), says("points to Perfil", "perfil"), unchanged],
  },
];
