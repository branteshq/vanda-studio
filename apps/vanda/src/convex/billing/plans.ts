/**
 * The subscription lineup — mirrors the Autumn sandbox products. Tier decides
 * the usage allowance (see usage.ts); the annual price is the "12x" framing
 * (R$87/mês, R$132/mês) billed yearly. Imported by both Convex and the UI.
 */

export interface PlanTier {
  tier: "basico" | "profissional" | "conectado";
  label: string;
  monthly: { productId: string; priceBrl: number };
  /** Absent = monthly-only plan (Conectado). */
  annual?: { productId: string; priceBrl: number; perMonthBrl: number };
}

export const PLAN_TIERS: readonly PlanTier[] = [
  {
    tier: "basico",
    label: "Básico",
    monthly: { productId: "basico", priceBrl: 96 },
    annual: { productId: "basico-anual", priceBrl: 1044, perMonthBrl: 87 },
  },
  {
    tier: "profissional",
    label: "Profissional",
    monthly: { productId: "profissional", priceBrl: 146 },
    annual: { productId: "profissional-anual", priceBrl: 1584, perMonthBrl: 132 },
  },
  {
    // BYO inference: the user's ChatGPT subscription powers text and images.
    tier: "conectado",
    label: "ChatGPT",
    monthly: { productId: "conectado", priceBrl: 50 },
  },
];

export const PLAN_PRODUCT_IDS = PLAN_TIERS.flatMap((tier) => [
  tier.monthly.productId,
  ...(tier.annual ? [tier.annual.productId] : []),
]);

/** Plan ids in Autumn are `<tier>` or `<tier>-anual`; the tier decides usage. */
export const tierOfPlan = (planId: string): string => planId.replace(/-anual$/, "");

export const planLabel = (planId: string | null): string => {
  if (!planId) return "Teste grátis";
  const tier = PLAN_TIERS.find(
    (candidate) =>
      candidate.monthly.productId === planId || candidate.annual?.productId === planId,
  );
  if (!tier) return planId;
  if (tier.tier === "conectado") return tier.label;
  return planId.endsWith("-anual") ? `${tier.label} · anual` : `${tier.label} · mensal`;
};
