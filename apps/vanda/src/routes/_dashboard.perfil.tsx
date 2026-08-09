import { useEffect, useState, type ReactNode } from "react";
import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { ArrowLeft, Check, FileCode2, LogOut, NotebookPen } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@vanda-studio/ui/components/avatar";
import { Button } from "@vanda-studio/ui/components/button";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { PLAN_TIERS, planLabel, tierOfPlan } from "../convex/billing/plans";
import { parseBrandKit } from "../convex/workspace/brandKit";
import { useActiveAccount } from "../components/active-account";

export const Route = createFileRoute("/_dashboard/perfil")({
  component: ProfilePage,
});

/**
 * The owner-facing window into what Vanda knows: brand memory, durable notes
 * and reusable templates — per business, with a switcher. Renders full-bleed
 * (the dashboard layout skips the sidebar chrome for this route).
 */

type TabKey = "conta" | "marca" | "memoria" | "templates";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "conta", label: "Conta" },
  { key: "marca", label: "Marca" },
  { key: "memoria", label: "Memória" },
  { key: "templates", label: "Templates" },
];

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function ProfilePage() {
  const { user } = useUser();
  const clerk = useClerk();
  const navigate = useNavigate();
  const { accounts, activeAccount } = useActiveAccount();
  const ready = accounts?.filter((account) => account.onboardedAt !== null) ?? [];
  const [viewedId, setViewedId] = useState<Id<"accounts"> | null>(null);
  const viewed = ready.find((account) => account.id === viewedId) ?? activeAccount ?? ready[0];
  const [tab, setTab] = useState<TabKey>("conta");

  const name = user?.fullName ?? user?.username ?? "Minha conta";
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  const handleSignOut = async () => {
    await clerk.signOut();
    await navigate({ to: "/login" });
  };

  return (
    <div className="min-h-svh bg-app text-text">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8">
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void navigate({ to: "/conversa", search: {} })}
          >
            <ArrowLeft />
            Voltar para a conversa
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void handleSignOut()}>
            <LogOut />
            Sair
          </Button>
        </header>

        <div className="mt-10 grid gap-10 md:grid-cols-[260px_1fr]">
          <aside className="flex flex-col items-center text-center md:items-start md:text-left">
            <Avatar className="size-24">
              <AvatarImage src={user?.imageUrl} alt={name} />
              <AvatarFallback className="text-xl font-semibold">
                {getInitials(name) || "MC"}
              </AvatarFallback>
            </Avatar>
            <h1 className="mt-4 text-lg font-semibold tracking-tight">{name}</h1>
            {email ? <p className="mt-0.5 text-body-sm text-text-3">{email}</p> : null}

            <UsageCard />

            <section className="mt-8 w-full">
              <h2 className="section-label px-1 text-text-3">Negócios</h2>
              <div className="mt-2 space-y-1">
                {accounts === undefined ? (
                  <>
                    <Skeleton className="h-11 w-full rounded-lg" />
                    <Skeleton className="h-11 w-full rounded-lg" />
                  </>
                ) : (
                  ready.map((account) => {
                    const selected = account.id === viewed?.id;
                    return (
                      <button
                        key={account.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setViewedId(account.id)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 ease-[var(--ease-out)]",
                          selected
                            ? "border-border-strong bg-surface"
                            : "border-transparent hover:bg-surface",
                        )}
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-border-strong text-[11px] font-semibold text-text-2">
                          {getInitials(account.name) || "?"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-medium">
                            {account.name}
                          </span>
                          {account.handle ? (
                            <span className="block truncate text-xs text-text-3">
                              @{account.handle}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          </aside>

          <main className="min-w-0">
            <div className="flex w-fit gap-1 rounded-lg border border-border bg-surface p-1">
              {TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={tab === key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors duration-150 ease-[var(--ease-out)]",
                    tab === key ? "bg-muted text-text" : "text-text-3 hover:text-text",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "conta" ? (
              <div className="mt-6">
                <AccountTab />
              </div>
            ) : null}
            {viewed && tab !== "conta" ? (
              // Keyed by account so file selections reset when switching business.
              <div key={viewed.id} className="mt-6 space-y-6">
                {tab === "marca" ? <BrandTab accountId={viewed.id} /> : null}
                {tab === "memoria" ? (
                  <FolderTab
                    accountId={viewed.id}
                    folder="/memory"
                    format="markdown"
                    emptyIcon={NotebookPen}
                    emptyTitle="Nenhuma nota ainda"
                    emptyBody={`As notas duráveis da Vanda sobre este negócio moram aqui. Diga na conversa algo como "nunca use vermelho nas artes" — ela grava, e o que está gravado ela não esquece.`}
                  />
                ) : null}
                {tab === "templates" ? (
                  <FolderTab
                    accountId={viewed.id}
                    folder="/templates"
                    format="code"
                    emptyIcon={FileCode2}
                    emptyTitle="Nenhum template ainda"
                    emptyBody={`Códigos de edição de imagem que deram certo podem virar templates reutilizáveis. Peça na conversa: "salve esse código como template" — ele aparece aqui.`}
                  />
                ) : null}
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * The t3-style usage block in the left column: the plan name and the bar —
 * the owner only ever sees a percentage, never the underlying money.
 */
function UsageCard() {
  const summary = useQuery(api.usage.summary);
  const pct = summary?.usedPct ?? 0;

  return (
    <section className="mt-8 w-full">
      <h2 className="section-label px-1 text-text-3">Uso do plano</h2>
      <div className="mt-2 rounded-xl border border-border bg-surface p-4 text-left">
        {summary === undefined ? (
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ) : summary?.plan && tierOfPlan(summary.plan) === "conectado" ? (
          // Conectado: inference rides the owner's ChatGPT — no bar to show.
          <>
            <p className="text-body font-medium">{planLabel(summary.plan)}</p>
            <p className="mt-1 text-xs text-text-4">
              Inferência pela sua assinatura do ChatGPT — uso incluído.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-body font-medium">{planLabel(summary?.plan ?? null)}</p>
              <span className="text-body-sm text-text-3">{pct}%</span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Uso do plano"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300 ease-[var(--ease-out)]",
                  summary?.limited ? "bg-destructive" : "bg-brand-accent",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-text-4">
              {summary?.limited
                ? "Limite atingido — faça upgrade para continuar."
                : summary?.renewsAt
                  ? `Renova em ${new Date(summary.renewsAt).toLocaleDateString("pt-BR")}`
                  : "Crédito de teste — assine para renovar todo mês."}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

const TIER_FEATURES: Record<string, string[]> = {
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
    "GPT Image 2 — o melhor modelo de imagem",
  ],
};

/**
 * The account tab, t3-style: choose-your-plan cards side by side with a
 * monthly/annual switch, plus the billing portal for whoever is subscribed.
 * Checkout and portal ride Autumn; the enforcement snapshot re-syncs on every
 * visit — this page is also the post-checkout landing.
 */
function AccountTab() {
  const summary = useQuery(api.usage.summary);
  const syncBilling = useAction(api.billing.autumn.syncBilling);
  const startCheckout = useAction(api.billing.autumn.startCheckout);
  const getPortalUrl = useAction(api.billing.autumn.getBillingPortalUrl);
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void syncBilling().catch(() => {});
  }, [syncBilling]);

  const currentTier = summary?.plan ? tierOfPlan(summary.plan) : null;

  const subscribe = async (planId: string) => {
    setBusy(planId);
    setError(null);
    try {
      const { checkoutUrl, attached } = await startCheckout({ planId });
      if (checkoutUrl) {
        window.location.href = checkoutUrl;
        return;
      }
      // The purchase completed without a payment page — refresh the snapshot
      // so the cards and the usage bar flip to the new plan reactively.
      if (attached) await syncBilling();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Escolha seu plano</h2>
        {currentTier ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() => void manage()}
          >
            {busy === "portal" ? "Abrindo…" : "Gerenciar cobrança e faturas"}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex w-fit gap-1 rounded-lg border border-border bg-surface p-1">
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
              "rounded-md px-3.5 py-1.5 text-body-sm font-medium transition-colors duration-150 ease-[var(--ease-out)]",
              interval === key ? "bg-muted text-text" : "text-text-3 hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <PlanCard
          title="Teste grátis"
          priceLine={<span className="text-xl font-semibold">R$0</span>}
          features={TIER_FEATURES.trial!}
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
          const current = currentTier === tier.tier;
          const scheduled =
            summary?.scheduledPlan != null && tierOfPlan(summary.scheduledPlan) === tier.tier;
          return (
            <PlanCard
              key={tier.tier}
              title={tier.label}
              highlight={tier.tier === "profissional"}
              badge={
                tier.tier === "profissional"
                  ? "Mais popular"
                  : tier.tier === "conectado"
                    ? "Traga sua assinatura"
                    : undefined
              }
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
              features={TIER_FEATURES[tier.tier]!}
              action={
                current ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Plano atual
                  </Button>
                ) : scheduled ? (
                  // A downgrade Autumn deferred: it activates at the renewal.
                  <div className="text-center">
                    <Button variant="outline" size="sm" className="w-full" disabled>
                      Agendado
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

      {currentTier === "conectado" ? <OpenAiConnectCard /> : null}
    </div>
  );
}

/**
 * The Conectado plan's OpenAI connection card: shows connection state and
 * runs the device-code flow — a short code the owner types at openai.com,
 * polled here until approval lands.
 */
function OpenAiConnectCard() {
  const status = useQuery(api.openaiSub.connectionStatus);
  const startDeviceAuth = useAction(api.openaiSub.startDeviceAuth);
  const pollDeviceAuth = useAction(api.openaiSub.pollDeviceAuth);
  const disconnect = useMutation(api.openaiSub.disconnect);
  const [device, setDevice] = useState<{
    deviceAuthId: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds: number;
  } | null>(null);
  const [flowState, setFlowState] = useState<"idle" | "starting" | "waiting" | "failed">("idle");
  const [flowError, setFlowError] = useState<string | null>(null);

  // Poll while a device code is outstanding; stop on approval or failure.
  useEffect(() => {
    if (!device || flowState !== "waiting") return;
    let cancelled = false;
    const timer = setInterval(
      () => {
        void pollDeviceAuth({ deviceAuthId: device.deviceAuthId, userCode: device.userCode })
          .then((result) => {
            if (cancelled) return;
            if (result.status === "complete") {
              setDevice(null);
              setFlowState("idle");
            } else if (result.status === "failed") {
              setFlowError(result.message ?? "A conexão falhou. Tente de novo.");
              setFlowState("failed");
            }
          })
          .catch(() => {});
      },
      Math.max(device.intervalSeconds, 3) * 1000,
    );
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [device, flowState, pollDeviceAuth]);

  const connect = async () => {
    setFlowState("starting");
    setFlowError(null);
    try {
      const info = await startDeviceAuth();
      setDevice(info);
      setFlowState("waiting");
    } catch (cause) {
      setFlowError(cause instanceof Error ? cause.message : String(cause));
      setFlowState("failed");
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-body font-semibold">Conta OpenAI</h3>
          <p className="mt-0.5 text-body-sm text-text-3">
            {status?.connected
              ? "Conectada — a Vanda usa a sua assinatura do ChatGPT para textos e imagens."
              : "Conecte sua conta para a Vanda usar a sua assinatura do ChatGPT."}
          </p>
        </div>
        {status?.connected ? (
          <Button variant="outline" size="sm" onClick={() => void disconnect()}>
            Desconectar
          </Button>
        ) : flowState === "waiting" ? null : (
          <Button size="sm" disabled={flowState === "starting"} onClick={() => void connect()}>
            {flowState === "starting" ? "Gerando código…" : "Conectar OpenAI"}
          </Button>
        )}
      </div>

      {!status?.connected && device && flowState === "waiting" ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4 text-center">
          <p className="text-body-sm text-text-3">
            Acesse{" "}
            <a
              href={device.verificationUri}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-text underline underline-offset-2"
            >
              {device.verificationUri.replace("https://", "")}
            </a>{" "}
            e digite o código:
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-[0.3em]">
            {device.userCode}
          </p>
          <p className="mt-2 flex items-center justify-center gap-2 text-xs text-text-4">
            <Spinner className="size-3" /> aguardando aprovação…
          </p>
        </div>
      ) : null}

      {flowError ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
          {flowError}
        </p>
      ) : null}
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
        "relative flex flex-col rounded-xl border bg-surface p-5",
        highlight ? "border-brand-accent/50" : "border-border",
      )}
    >
      {badge ? (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-brand-accent px-2.5 py-0.5 text-[11px] font-semibold text-white">
          {badge}
        </span>
      ) : null}
      <h3 className="text-body font-semibold">{title}</h3>
      <p className="mt-2">{priceLine}</p>
      <ul className="mt-4 flex-1 space-y-2">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-body-sm text-text-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-brand-accent" />
            {feature}
          </li>
        ))}
      </ul>
      <div className="mt-5">{action}</div>
    </div>
  );
}

type FileResult = ReturnType<typeof useFileText>;

/** Reads a workspace text file; null while loading, "" only if truly empty. */
function useFileText(accountId: Id<"accounts">, path: string, skip = false) {
  const result = useQuery(api.workspacePublic.file, skip ? "skip" : { accountId, path });
  if (result === undefined) return { loading: true as const, text: null };
  return {
    loading: false as const,
    text: result.ok && result.file.kind === "text" ? result.file.text : null,
  };
}

function SectionCard({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-body font-semibold">{title}</h3>
        {caption ? <p className="text-xs text-text-4">{caption}</p> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function BrandTab({ accountId }: { accountId: Id<"accounts"> }) {
  const profile = useFileText(accountId, "/brand/profile.json");
  const memory = useFileText(accountId, "/brand/memory.md");
  const notes = useFileText(accountId, "/brand/notes.md");

  let readiness: number | null = null;
  if (profile.text) {
    try {
      const parsed = JSON.parse(profile.text) as { readiness?: { score?: number } };
      const score = parsed.readiness?.score;
      if (typeof score === "number") readiness = Math.round(score * 100);
    } catch {
      readiness = null;
    }
  }

  return (
    <>
      {readiness !== null ? (
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <h3 className="text-body font-semibold">Prontidão do perfil</h3>
            <span className="text-body-sm font-medium text-text-2">{readiness}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand-accent transition-[width] duration-300 ease-[var(--ease-out)]"
              style={{ width: `${readiness}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-text-4">
            Quanto mais completo o perfil, mais fiel à marca a Vanda consegue ser.
          </p>
        </section>
      ) : null}

      <BrandKitCard accountId={accountId} />

      <SectionCard title="Memória de marca" caption="fatos confirmados por você">
        <FileBody result={memory} format="markdown" />
      </SectionCard>

      <SectionCard title="Anotações da Vanda" caption="ela grava aqui — sempre com a sua aprovação">
        <FileBody result={notes} format="markdown" />
      </SectionCard>
    </>
  );
}

/**
 * The Pomelli-style identity card: swatches with exact hexes, font previews,
 * tagline — rendered straight from /brand/kit.json. The kit only changes
 * through the write approval flow, so what's shown here is what Vanda uses.
 */
function BrandKitCard({ accountId }: { accountId: Id<"accounts"> }) {
  const result = useFileText(accountId, "/brand/kit.json");
  const kit = result.text !== null ? parseBrandKit(result.text) : null;
  const empty = kit === null || (kit.colors.length === 0 && kit.fonts.length === 0 && !kit.tagline);

  return (
    <SectionCard title="Identidade visual" caption="a Vanda usa exatamente estas cores e fontes">
      {result.loading ? (
        <div className="flex gap-3" aria-hidden>
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="size-14 rounded-full" />
        </div>
      ) : empty ? (
        <p className="text-body-sm leading-relaxed text-text-3">
          Nenhuma identidade registrada ainda. Diga na conversa algo como{" "}
          <em>"nossas cores são #d81b60 e #fdfcfb, e a fonte é Poppins"</em> — a Vanda monta o
          kit e pede a sua aprovação antes de gravar.
        </p>
      ) : (
        <div className="space-y-5">
          {kit.colors.length > 0 ? (
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              {kit.colors.map((color) => (
                <div key={color.hex} className="flex flex-col items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-14 rounded-full border border-border shadow-sm"
                    style={{ backgroundColor: color.hex }}
                  />
                  <span className="font-mono text-xs text-text-2">{color.hex}</span>
                  {color.name || color.role ? (
                    <span className="max-w-24 truncate text-[11px] text-text-4">
                      {color.name ?? color.role}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {kit.fonts.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {kit.fonts.map((font) => (
                <div
                  key={`${font.family}-${font.role ?? ""}`}
                  className="flex min-w-36 flex-col items-center rounded-lg border border-border px-5 py-3"
                >
                  <span
                    aria-hidden
                    className="text-3xl leading-tight text-text"
                    style={{ fontFamily: `"${font.family}", sans-serif` }}
                  >
                    Aa
                  </span>
                  <span className="mt-1 text-body-sm font-medium">{font.family}</span>
                  {font.role ? <span className="text-[11px] text-text-4">{font.role}</span> : null}
                </div>
              ))}
            </div>
          ) : null}

          {kit.tagline ? (
            <p className="text-body-sm text-text-2 italic">“{kit.tagline}”</p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function FileBody({ result, format }: { result: FileResult; format: "markdown" | "code" }) {
  if (result.loading) {
    return (
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3.5 w-2/5" />
      </div>
    );
  }
  if (result.text === null) return <p className="text-body-sm text-text-3">(vazio)</p>;
  if (format === "code") {
    return (
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-body-sm leading-relaxed whitespace-pre text-text-2">
        {result.text}
      </pre>
    );
  }
  return <Markdown variant="reading">{result.text}</Markdown>;
}

function FolderTab({
  accountId,
  folder,
  format,
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptyBody,
}: {
  accountId: Id<"accounts">;
  folder: string;
  format: "markdown" | "code";
  emptyIcon: typeof NotebookPen;
  emptyTitle: string;
  emptyBody: string;
}) {
  const listing = useQuery(api.workspacePublic.browse, { accountId, path: folder });
  const entries = listing?.ok ? listing.entries : [];
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected = entries.some((entry) => entry.name === selectedName)
    ? selectedName
    : (entries[0]?.name ?? null);
  const file = useFileText(accountId, `${folder}/${selected}`, selected === null);

  if (listing === undefined) {
    return (
      <div className="space-y-2" aria-hidden>
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
        <EmptyIcon className="size-6 text-text-4" />
        <h3 className="mt-3 text-body font-semibold">{emptyTitle}</h3>
        <p className="mt-1.5 max-w-md text-body-sm leading-relaxed text-text-3">{emptyBody}</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-1">
        {entries.map((entry) => {
          const active = entry.name === selected;
          return (
            <button
              key={entry.name}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedName(entry.name)}
              className={cn(
                "flex w-full items-baseline gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-150 ease-[var(--ease-out)]",
                active
                  ? "border-border-strong bg-surface"
                  : "border-transparent hover:bg-surface",
              )}
            >
              <span className="shrink-0 font-mono text-body-sm font-medium">{entry.name}</span>
              {entry.summary ? (
                <span className="min-w-0 flex-1 truncate text-xs text-text-4">{entry.summary}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <SectionCard title={selected ?? ""}>
        <FileBody result={file} format={format} />
      </SectionCard>
    </>
  );
}
