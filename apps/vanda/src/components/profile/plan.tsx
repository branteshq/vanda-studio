import { useState, type CSSProperties, type ReactNode } from "react";
import { Check, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { cn } from "@vanda-studio/ui/lib/utils";
import { PLAN_TIERS, planLabel, tierOfPlan } from "../../convex/billing/plans";
import { errorMessage } from "../../errors";
import { Pill, Segmented, ServiceTile, SettingsCard, SettingsHeading, SettingsRow } from "./layout";
import { useProfileRuntime } from "./runtime";

type Summary = NonNullable<ReturnType<ReturnType<typeof useProfileRuntime>["useUsageSummary"]>>;

type Breakdown = Summary["breakdown"];

/** Category colors on the meter and its legend, in order of how much each used. */
const SEGMENT_TONES = ["bg-peri", "bg-brand-soft", "bg-amber", "bg-green", "bg-text-3"] as const;

/** A share as a CSS width, clamped to the track. */
const share = (pct: number) => `${Math.max(0, Math.min(100, pct))}%`;

/**
 * The plan's meter: one track, a segment per category that used it (colored
 * like the legend), or one plain fill when there is no breakdown.
 */
function Meter({ pct, summary }: { pct: number; summary: Summary }) {
  const used = usedCategories(summary.breakdown);

  return (
    <div
      className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-line-strong"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Uso do plano"
    >
      {used.length > 0 ? (
        used.map((category, index) => (
          <span
            key={category.id}
            className={cn(
              "block h-full w-(--progress) transition-all duration-300 ease-out",
              SEGMENT_TONES[index % SEGMENT_TONES.length],
            )}
            style={
              // SAFETY: React forwards CSS variables; the value includes its percentage unit.
              { "--progress": share(category.pct) } as CSSProperties
            }
          />
        ))
      ) : (
        <span
          className={cn(
            "block h-full w-(--progress) rounded-full transition-all duration-300 ease-out",
            summary.limited ? "bg-destructive" : "bg-text-3",
          )}
          style={
            // SAFETY: React forwards CSS variables; the value includes its percentage unit.
            { "--progress": share(pct) } as CSSProperties
          }
        />
      )}
    </div>
  );
}

const usedCategories = (breakdown: Breakdown | undefined) =>
  (breakdown?.categories ?? [])
    .filter((category) => !category.viaChatGpt && category.pct > 0)
    .toSorted((a, b) => b.pct - a.pct);

/**
 * Plano e uso. The plan card: its name and renewal, how much is used and on
 * what, and what is still possible; "Ver planos" turns magenta only when the
 * plan runs low. Below it, what the ChatGPT subscription covers. Every plan
 * shows the same meter: on the ChatGPT plan, conversations and images are
 * covered by the subscription, and everything Vanda pays for (Instagram
 * research, the radar, web search) still draws from the plan. The owner sees
 * percentages and examples, never the underlying money.
 */
export function PlanOverview() {
  const runtime = useProfileRuntime();
  const navigate = runtime.useProfileNavigate();
  const summary = runtime.useUsageSummary();
  const openai = runtime.useOpenAiConnection().status;
  const [plansOpen, setPlansOpen] = useState(false);

  if (summary === undefined)
    return (
      <SettingsCard>
        <div className="space-y-4 p-4" aria-hidden>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      </SettingsCard>
    );

  const pct = summary?.usedPct ?? 0;
  const conectado = summary?.plan ? tierOfPlan(summary.plan) === "conectado" : false;
  const breakdown = summary?.breakdown;
  const used = usedCategories(breakdown);
  const covered = breakdown?.categories.filter((category) => category.viaChatGpt) ?? [];
  const remaining = breakdown?.remaining.filter((item) => item.count > 0) ?? [];
  const webClose = breakdown ? breakdown.web.used >= breakdown.web.limit / 2 : false;
  const low = Boolean(summary?.limited) || pct >= 80;

  return (
    <>
      <SettingsCard label="Uso do plano">
        <div>
          <SettingsRow
            icon={
              <ServiceTile>
                <Sparkles className="size-4" />
              </ServiceTile>
            }
            title={
              <span className="flex items-center gap-2">
                {summary?.plan ? `Plano ${planLabel(summary.plan)}` : planLabel(null)}
                {summary?.renewsAt ? null : <Pill>Crédito de teste</Pill>}
              </span>
            }
            detail={
              summary?.renewsAt
                ? `Renova em ${new Date(summary.renewsAt).toLocaleDateString("pt-BR")}`
                : "Um crédito único para experimentar tudo"
            }
          >
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={plansOpen}
              onClick={() => setPlansOpen((open) => !open)}
            >
              {plansOpen ? "Fechar planos" : "Gerenciar plano"}
            </Button>
          </SettingsRow>

          <div className="px-4 pt-1 pb-4">
            <div className="mb-2.5 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight tabular-nums">{pct}%</span>
              <span className="text-body text-text-3">do plano usado</span>
              <span className="ml-auto text-body-sm text-text-4 tabular-nums">
                {Math.max(0, 100 - pct)}% restantes
              </span>
            </div>
            {summary ? <Meter pct={pct} summary={summary} /> : null}
            {used.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-body-sm text-text-3">
                {used.map((category, index) => (
                  <li key={category.id} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.75 rounded-xs",
                        SEGMENT_TONES[index % SEGMENT_TONES.length],
                      )}
                    />
                    <span>{category.label}</span>
                    <span className="text-text-4 tabular-nums">{category.pct}%</span>
                  </li>
                ))}
              </ul>
            ) : breakdown ? (
              <p className="mt-3 text-body-sm text-text-3">Nada usado ainda neste período.</p>
            ) : null}
            {webClose && breakdown ? (
              <p className="mt-2 text-body-sm text-text-3">
                Pesquisa na web nas últimas 24 horas: {breakdown.web.used} de {breakdown.web.limit}.
              </p>
            ) : null}
          </div>
        </div>

        {conectado && openai?.connected === false ? (
          <div className="flex items-center gap-2.5 px-4 py-3 text-body text-text-2">
            <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-amber" />
            <span className="min-w-0 flex-1">
              Sua conta OpenAI não está conectada, então conversas e imagens também saem do plano.
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void navigate({ to: "/perfil/conexoes" })}
            >
              Conectar
            </Button>
          </div>
        ) : null}

        {summary?.limited || remaining.length > 0 || low ? (
          <div className="flex items-center gap-2.5 px-4 py-3 text-body text-text-2">
            {low ? <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-amber" /> : null}
            <span className="min-w-0 flex-1">
              {summary?.limited ? (
                summary.chatLimited ? (
                  "Limite atingido. Mude de plano ou aguarde a renovação."
                ) : (
                  "Limite atingido para pesquisa no Instagram, radar e web. Conversas e imagens pela sua assinatura do ChatGPT continuam."
                )
              ) : remaining.length > 0 ? (
                <>
                  Ainda dá para{" "}
                  {remaining.map((item, index) => (
                    <span key={item.label}>
                      {index > 0 ? " ou " : ""}~{item.count} {item.label}
                    </span>
                  ))}
                  .
                </>
              ) : (
                "O plano está quase no fim."
              )}
            </span>
            {low && !plansOpen ? (
              <Button size="sm" onClick={() => setPlansOpen(true)}>
                Ver planos
              </Button>
            ) : null}
          </div>
        ) : null}
      </SettingsCard>

      {plansOpen ? <PlansPicker /> : null}

      {covered.length > 0 ? (
        <>
          <SettingsHeading title="Fora do plano" caption="Isso não gasta seu crédito." />
          <SettingsCard>
            {covered.map((category) => (
              <div key={category.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-body text-text-2">
                  {category.label}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-body-sm text-text-3">
                  <Check className="size-3.5 text-green" aria-hidden />
                  pela sua assinatura do ChatGPT
                </span>
              </div>
            ))}
          </SettingsCard>
        </>
      ) : null}
    </>
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
    <div className="mt-9">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Escolha seu plano</h3>
        {currentTier ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => void manage()}
          >
            {busy === "portal" ? "Abrindo…" : "Cobrança e faturas"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-body-sm text-destructive">
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
          className="mt-4 rounded-lg border border-line bg-tile p-4"
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
            <Button variant="secondary" disabled={busy !== null} onClick={() => setPreview(null)}>
              Cancelar
            </Button>
          </div>
        </section>
      ) : null}

      <div className="mt-4">
        <Segmented
          label="Cobrança"
          value={interval}
          options={[
            { value: "monthly", label: "Mensal" },
            { value: "annual", label: "Anual · 12x" },
          ]}
          onChange={setInterval}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PlanCard
          title="Teste grátis"
          priceLine={<span className="text-xl font-semibold">R$0</span>}
          features={TIER_FEATURES.trial}
          action={
            currentTier === null ? (
              <Button variant="secondary" size="sm" className="w-full" disabled>
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
                  <Button variant="secondary" size="sm" className="w-full" disabled>
                    Plano atual
                  </Button>
                ) : scheduled ? (
                  // A downgrade Autumn deferred: it activates at the renewal.
                  <div className="text-center">
                    <Button
                      variant="secondary"
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
                    variant={tier.tier === "profissional" ? "default" : "secondary"}
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
        "relative flex flex-col rounded-lg border bg-tile p-4",
        highlight ? "border-brand-accent/40" : "border-line",
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
