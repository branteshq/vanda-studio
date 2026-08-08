/**
 * The subscription lineup — mirrors the Autumn sandbox products. Tier decides
 * the usage allowance (see usage.ts); the annual price is the "12x" framing
 * (R$87/mês, R$132/mês) billed yearly. Imported by both Convex and the UI.
 */

export interface PlanTier {
  tier: "basico" | "profissional";
  label: string;
  monthly: { productId: string; priceBrl: number };
  annual: { productId: string; priceBrl: number; perMonthBrl: number };
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
];

export const PLAN_PRODUCT_IDS = PLAN_TIERS.flatMap((tier) => [
  tier.monthly.productId,
  tier.annual.productId,
]);

export const planLabel = (planId: string | null): string => {
  if (!planId) return "Teste grátis";
  const tier = PLAN_TIERS.find(
    (candidate) =>
      candidate.monthly.productId === planId || candidate.annual.productId === planId,
  );
  if (!tier) return planId;
  return planId.endsWith("-anual") ? `${tier.label} · anual` : `${tier.label} · mensal`;
};
