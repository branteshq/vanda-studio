/**
 * Usage categories: how the owner reads the meter. Every charge kind recorded
 * by usage.chargeUsage lands in one category, named the way the owner thinks
 * about the work. See docs/usage-metering.md for what is (and is not) metered.
 */

export const USAGE_CATEGORIES = [
  {
    id: "conversas",
    label: "Conversas com a Vanda e o Caetano",
    // On the ChatGPT plan these run on the owner's subscription and cost the plan nothing.
    viaChatGpt: true,
  },
  { id: "imagens", label: "Criação de imagens", viaChatGpt: true },
  { id: "instagram", label: "Pesquisa no Instagram", viaChatGpt: false },
  { id: "radar", label: "Radar de mercado e análises", viaChatGpt: false },
  { id: "web", label: "Pesquisa na web", viaChatGpt: false },
] as const;

export type UsageCategoryId = (typeof USAGE_CATEGORIES)[number]["id"];

/** The category of a charge kind (usageEvents.kind). Unknown kinds count as conversation work. */
export const categoryOfKind = (kind: string): UsageCategoryId => {
  if (kind === "paint") return "imagens";

  if (kind === "instagram_apify") return "instagram";

  if (kind.startsWith("web_")) return "web";

  if (kind === "scan" || kind === "full_loop" || kind === "pipeline") return "radar";

  // chat, caetano_chat, title, context_summary, transcription.
  return "conversas";
};

/**
 * What one typical piece of work costs, in micro-USD, for the "dá para mais…"
 * line. Defaults until the period has enough real charges to average; tune
 * them against usageEvents.
 */
export const TYPICAL_COST_MICRO_USD: Record<
  "instagram" | "radar" | "web",
  { microUsd: number; one: string; many: string }
> = {
  // A profile read with its recent posts: ~30 Apify results at $0.0027.
  instagram: { microUsd: 80_000, one: "pesquisa de perfil", many: "pesquisas de perfil" },
  // A scan ($0.05) plus its model steps.
  radar: { microUsd: 120_000, one: "varredura do radar", many: "varreduras do radar" },
  // One Parallel search.
  web: { microUsd: 5_000, one: "pesquisa na web", many: "pesquisas na web" },
};

/** Web requests per owner in any rolling 24 hours (failed attempts included). */
export const WEB_DAILY_LIMIT = 100;
