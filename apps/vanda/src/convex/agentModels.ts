/**
 * The orchestrator lineup — which model thinks as Vanda. One catalog imported
 * by both Convex (to resolve the model for a turn) and the UI (to render the
 * picker), so the two can never disagree about what is selectable.
 *
 * `codexCapable` is the load-bearing flag: the Conectado plan runs inference on
 * the owner's own ChatGPT subscription through the codex adapter, which can
 * only serve OpenAI models. Anthropic models there would silently fall back to
 * OUR OpenRouter key — the owner's choice quietly spending our margin. So the
 * catalog marks what each transport can carry and `resolveOrchestratorModel`
 * enforces it on the server; the picker disables the same options in the UI.
 */

export type ModelMaker = "OpenAI" | "Anthropic";

export interface OrchestratorModel {
  /** OpenRouter model id — also what the codex adapter sends upstream. */
  readonly id: string;
  readonly label: string;
  readonly maker: ModelMaker;
  /** One line, owner-facing, pt-BR: when to reach for this model. */
  readonly tagline: string;
  /** Can run on the owner's ChatGPT subscription (plano Conectado). */
  readonly codexCapable: boolean;
}

export const ORCHESTRATOR_MODELS: readonly OrchestratorModel[] = [
  {
    id: "openai/gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    maker: "OpenAI",
    tagline: "Equilíbrio entre rapidez e capricho — o padrão da Vanda.",
    codexCapable: true,
  },
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    maker: "OpenAI",
    tagline: "Mais rápido e econômico, para conversas do dia a dia.",
    codexCapable: true,
  },
  {
    id: "anthropic/claude-opus-5",
    label: "Claude Opus 5",
    maker: "Anthropic",
    tagline: "O mais caprichoso em texto e planejamento — consome mais uso.",
    codexCapable: false,
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    maker: "Anthropic",
    tagline: "Escrita afiada com custo moderado.",
    codexCapable: false,
  },
];

/** The lineup's default — what a user who never chose anything runs on. */
export const DEFAULT_ORCHESTRATOR_MODEL = "openai/gpt-5.6-terra";

export const orchestratorModel = (
  id: string | null | undefined,
): OrchestratorModel | undefined => ORCHESTRATOR_MODELS.find((model) => model.id === id);

/**
 * The single decision point: which model id a turn actually runs on. Unknown or
 * absent preferences collapse to the default (a model retired from the catalog
 * must never wedge a conversation), and a model the transport cannot carry
 * falls back to the default rather than silently changing who pays.
 */
export const resolveOrchestratorModel = (
  // `null` is what a Convex query returns for an absent preference.
  preferred: string | null | undefined,
  options: { readonly conectado: boolean },
): string => {
  const model = orchestratorModel(preferred);
  if (!model) return DEFAULT_ORCHESTRATOR_MODEL;
  if (options.conectado && !model.codexCapable) return DEFAULT_ORCHESTRATOR_MODEL;
  return model.id;
};
