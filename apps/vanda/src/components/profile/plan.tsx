import { useState, type CSSProperties, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { cn } from "@vanda-studio/ui/lib/utils";
import { PLAN_TIERS, planLabel, tierOfPlan } from "../../convex/billing/plans";
import { errorMessage } from "../../errors";
import { useProfileRuntime } from "./runtime";

/**
 * The plan in one block: name, how usage works, and the bar. The owner only
 * ever sees a percentage, never the underlying money.
 */
export function PlanSummary({ action }: { action: ReactNode }) {
  const runtime = useProfileRuntime();
  const summary = runtime.useUsageSummary();
  const openai = runtime.useOpenAiConnection().status;
  const pct = summary?.usedPct ?? 0;
  const conectado = summary?.plan ? tierOfPlan(summary.plan) === "conectado" : false;

  return (
    <div aria-label="Uso do plano">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-text-3">Plano</p>
          {summary === undefined ? (
            <Skeleton className="mt-1.5 h-4 w-36" />
          ) : (
            <p className="mt-1 text-body">{planLabel(summary?.plan ?? null)}</p>
          )}
        </div>
        {action}
      </div>

      {summary === undefined ? (
        <Skeleton className="mt-4 h-2 w-full rounded-full" />
      ) : conectado && openai?.connected !== false ? (
        // Conectado with a live login: inference rides the owner's ChatGPT, no bar.
        <p className="mt-3 text-body-sm text-text-3">
          Conversas e imagens usam os limites da sua conta OpenAI.
        </p>
      ) : (
        <>
          {conectado ? (
            <p className="mt-3 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-body-sm text-text-2">
              Sua conta OpenAI não está conectada, então o uso sai do saldo do plano. Conecte em
              Conexões, logo abaixo.
            </p>
          ) : null}
          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-2xl font-medium tracking-tight tabular-nums">{pct}%</span>
            <span className="text-body-sm text-text-3">utilizado</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Uso do plano"
          >
            <div
              className={cn(
                "h-full w-(--progress) rounded-full transition-all duration-300 ease-out",
                summary?.limited ? "bg-destructive" : "bg-brand-accent",
              )}
              style={
                // SAFETY: React forwards CSS variables; the progress value includes its percentage unit.
                { "--progress": `${pct}%` } as CSSProperties
              }
            />
          </div>
          <p className="mt-2 text-body-sm text-text-3">
            {summary?.limited
              ? summary.chatLimited
                ? "Limite atingido. Mude de plano ou aguarde a renovação."
                : "Limite dos serviços pagos pela Vanda atingido. Conversa e imagens pela sua assinatura do ChatGPT continuam disponíveis."
              : summary?.renewsAt
                ? `Renova em ${new Date(summary.renewsAt).toLocaleDateString("pt-BR")}. O plano é compartilhado entre seus negócios.`
                : "Crédito de teste. Assine para renovar todo mês."}
          </p>
        </>
      )}
    </div>
  );
}

const TIER_FEATURES = {
  trial: [
    "Crédito único para experimentar tudo",
    "Todos os recursos incluídos",
    "Sem cartão de crédito",
  ],
  basico: [
    "Limite mensal de uso completo",
    "Radar de mercado diário",
    "Carrosséis, imagens e edições com IA",
  ],
  profissional: [
    "Tudo do Básico",
    "50% mais limite de uso por mês",
    "Para quem publica com frequência",
  ],
  conectado: [
    "Conecte sua assinatura do ChatGPT",
    "Texto e imagens pelo seu plano OpenAI",
    "GPT Image 2.5 — pela sua assinatura",
  ],
} satisfies Record<string, string[]>;

function planBadge(tier: string): string | undefined {
  if (tier === "profissional") return "Mais popular";

  if (tier === "conectado") return "Traga sua assinatura";

  return undefined;
}

/**
 * Plan comparison and billing controls. Checkout and portal ride Autumn; the
 * page refreshes the enforcement snapshot on arrival from checkout.
 */
export function PlansPicker() {
  const runtime = useProfileRuntime();
  const summary = runtime.useUsageSummary();
  const syncBilling = runtime.useSyncBilling();

  const { startCheckout, previewPlanChange, changePlan, getPortalUrl } =
    runtime.useBillingActions();

  const [schedule, setSchedule] = useState<"immediate" | "end_of_cycle">("immediate");

  const [preview, setPreview] = useState<{
    planId: string;
    currentPlanId: string;
    scheduledPlanId: string | null;
    total: number;
    currency: string;
    effectiveAt: number | null;
    schedule: "immediate" | "end_of_cycle";
  } | null>(null);

  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentTier = summary?.plan ? tierOfPlan(summary.plan) : null;

  const subscribe = async (planId: string) => {
    setBusy(planId);
    setError(null);

    try {
      if (summary?.plan) {
        const result = await previewPlanChange({ planId, schedule });
        setPreview({ ...result, planId, schedule });

        return;
      }

      const { checkoutUrl, attached } = await startCheckout({ planId });

      if (checkoutUrl) {
        window.location.href = checkoutUrl;

        return;
      }

      // The purchase completed without a payment page: refresh the snapshot
      // so the cards and the usage bar flip to the new plan reactively.
      if (attached) await syncBilling();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const confirmChange = async () => {
    if (!preview) return;
    setBusy(preview.planId);
    setError(null);

    try {
      const { effectiveAt: _, ...input } = preview;
      const result = await changePlan(input);
      setPreview(null);

      if (result.checkoutUrl) window.location.href = result.checkoutUrl;
      else await syncBilling();
    } catch (cause) {
      setPreview(null);
      setError(errorMessage(cause));
      await syncBilling().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const manage = async () => {
    setBusy("portal");
    setError(null);

    try {
      const { url } = await getPortalUrl();

      if (url) window.location.href = url;
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-5 border-t border-border pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-body font-semibold">Escolha seu plano</h3>
        {currentTier ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void manage()}
          >
            {busy === "portal" ? "Abrindo…" : "Cobrança e faturas"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
          {error}
        </p>
      ) : null}

      {currentTier ? (
        <fieldset className="mt-4 flex flex-wrap gap-4" disabled={busy !== null}>
          <legend className="mb-2 text-body-sm">Quando mudar de plano?</legend>
          {(
            [
              ["immediate", "Agora, com cobrança ou crédito proporcional"],
              ["end_of_cycle", "Na próxima renovação"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-body-sm">
              <input
                type="radio"
                name="plan-schedule"
                value={value}
                checked={schedule === value}
                onChange={() => {
                  setSchedule(value);
                  setPreview(null);
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {preview ? (
        <section
          className="mt-4 rounded-lg border border-border bg-app p-4"
          aria-label="Confirmar mudança de plano"
        >
          <h4 className="font-semibold">Confirmar mudança de plano</h4>
          <p className="mt-2 text-body-sm">
            {PLAN_TIERS.find((tier) => tier.tier === tierOfPlan(preview.planId))?.label}.
            {preview.schedule === "immediate"
              ? " A mudança vale agora."
              : ` A mudança vale na renovação${preview.effectiveAt ? ` em ${new Date(preview.effectiveAt).toLocaleDateString("pt-BR")}` : ""}.`}
          </p>
          <p className="mt-2 text-body-sm">
            {preview.total < 0 ? "Crédito proporcional: " : "Cobrança prevista: "}
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: preview.currency,
            }).format(Math.abs(preview.total))}
          </p>
          <p className="mt-2 text-xs text-text-3">
            Créditos seguem as regras da cobrança e não significam reembolso no cartão. O uso já
            consumido dos serviços pagos pela Vanda não é zerado. No plano ChatGPT, conecte sua
            assinatura em Conexões para usar conversa e imagens por ela.
          </p>
          {preview.scheduledPlanId ? (
            <p className="mt-2 text-body-sm">Esta escolha substitui a mudança já agendada.</p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button disabled={busy !== null} onClick={() => void confirmChange()}>
              Confirmar mudança
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => setPreview(null)}>
              Cancelar
            </Button>
          </div>
        </section>
      ) : null}

      <div className="mt-4 flex w-fit gap-1 rounded-lg border border-border bg-app p-1">
        {(
          [
            { key: "monthly", label: "Mensal" },
            { key: "annual", label: "Anual · 12x" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={interval === key}
            onClick={() => setInterval(key)}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors duration-150 ease-out",
              interval === key ? "bg-muted text-text" : "text-text-3 hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PlanCard
          title="Teste grátis"
          priceLine={<span className="text-xl font-semibold">R$0</span>}
          features={TIER_FEATURES.trial}
          action={
            currentTier === null ? (
              <Button variant="outline" size="sm" className="w-full" disabled>
                Plano atual
              </Button>
            ) : null
          }
        />
        {PLAN_TIERS.map((tier) => {
          // Monthly-only tiers (Conectado) ignore the interval switch.
          const annual = interval === "annual" ? tier.annual : undefined;
          const price = annual ?? tier.monthly;
          const perMonth = annual ? annual.perMonthBrl : tier.monthly.priceBrl;
          const current = summary?.plan === price.productId;
          const scheduled = summary?.scheduledPlan === price.productId;

          return (
            <PlanCard
              key={tier.tier}
              title={tier.label}
              highlight={tier.tier === "profissional"}
              badge={planBadge(tier.tier)}
              priceLine={
                <>
                  <span className="text-xl font-semibold">R${perMonth}</span>
                  <span className="text-body-sm text-text-4">/mês</span>
                  {annual ? (
                    <span className="block text-xs text-text-4">
                      12x no plano anual · R${annual.priceBrl}/ano
                    </span>
                  ) : interval === "annual" ? (
                    <span className="block text-xs text-text-4">somente mensal</span>
                  ) : null}
                </>
              }
              features={TIER_FEATURES[tier.tier]}
              action={
                current ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Plano atual
                  </Button>
                ) : scheduled ? (
                  // A downgrade Autumn deferred: it activates at the renewal.
                  <div className="text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={busy !== null}
                      onClick={() => void subscribe(price.productId)}
                    >
                      {schedule === "immediate" ? "Mudar agora" : "Revisar agendamento"}
                    </Button>
                    <p className="mt-1.5 text-xs text-text-4">
                      ativa na renovação
                      {summary?.renewsAt
                        ? ` (${new Date(summary.renewsAt).toLocaleDateString("pt-BR")})`
                        : ""}
                    </p>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={busy !== null}
                    onClick={() => void subscribe(price.productId)}
                  >
                    {busy === price.productId
                      ? "Abrindo…"
                      : currentTier
                        ? "Mudar de plano"
                        : "Assinar"}
                  </Button>
                )
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function PlanCard({
  title,
  priceLine,
  features,
  action,
  highlight = false,
  badge,
}: {
  title: string;
  priceLine: ReactNode;
  features: string[];
  action: ReactNode;
  highlight?: boolean;
  badge?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border bg-app p-4",
        highlight ? "border-brand-accent/50" : "border-border",
      )}
    >
      <div className="flex min-h-6 items-start justify-between gap-2">
        <h4 className="text-body font-semibold">{title}</h4>
        {badge ? (
          <span className="rounded-md bg-brand-accent/10 px-2 py-1 text-micro font-medium text-brand-soft">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-2">{priceLine}</p>
      <ul className="mt-3 flex-1 space-y-1.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-body-sm text-text-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-brand-accent" />
            {feature}
          </li>
        ))}
      </ul>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
