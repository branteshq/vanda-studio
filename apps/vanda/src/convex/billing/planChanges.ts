export type PlanSchedule = "immediate" | "end_of_cycle";

/** Explicit timing avoids Autumn's price-based downgrade scheduling. */
export const planChangeParams = (customerId: string, planId: string, schedule: PlanSchedule) => ({
  customer_id: customerId,
  plan_id: planId,
  plan_schedule: schedule,
  proration_behavior: "prorate_immediately",
});

export interface PlanChangePreview {
  total: number;
  currency: string;
}

export async function billingRequest(method: string, body: object): Promise<unknown> {
  const key = process.env.AUTUMN_SECRET_KEY;
  if (!key) throw new Error("Autumn não configurado");
  const response = await fetch(`https://api.useautumn.com/v1/billing.${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "x-api-version": "2.4.0",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    console.error(`[Autumn] ${method}: HTTP ${response.status}`, await response.text());
    throw new Error(
      "Não foi possível atualizar a cobrança. Confira seu plano antes de tentar novamente.",
    );
  }
  return response.json();
}

export function parsePreview(value: unknown): PlanChangePreview {
  const data = value as Partial<PlanChangePreview> | null;
  if (
    !data ||
    typeof data.total !== "number" ||
    !Number.isFinite(data.total) ||
    typeof data.currency !== "string" ||
    !/^[a-z]{3}$/i.test(data.currency)
  ) {
    throw new Error("Não foi possível conferir o valor da mudança.");
  }
  return { total: data.total, currency: data.currency.toUpperCase() };
}

export function assertPreviewUnchanged(actual: PlanChangePreview, expected: PlanChangePreview) {
  if (actual.currency !== expected.currency || Math.abs(actual.total - expected.total) > 0.01) {
    throw new Error("O valor mudou. Confira a nova prévia antes de confirmar.");
  }
}
