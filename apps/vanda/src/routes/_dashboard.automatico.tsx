import { useEffect, useState, type ComponentType } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Activity,
  ArrowUpRight,
  Check,
  Eye,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Video,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@vanda-studio/ui/components/avatar";
import { Button } from "@vanda-studio/ui/components/button";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { useActiveAccount } from "../components/active-account";

export const Route = createFileRoute("/_dashboard/automatico")({
  validateSearch: (search: Record<string, unknown>): { welcome?: true } =>
    search.welcome === true || search.welcome === "true" ? { welcome: true } : {},
  component: AutomaticoPage,
});

type DashboardData = FunctionReturnType<typeof api.market.dashboard>;
type Opportunity = DashboardData["opportunities"][number];
type Creator = DashboardData["creators"][number];

type BusyAction =
  | { readonly kind: "run" }
  | { readonly kind: "adapt"; readonly id: Id<"opportunities"> }
  | { readonly kind: "publish"; readonly id: Id<"opportunities"> }
  | { readonly kind: "dismiss"; readonly id: Id<"opportunities"> }
  | null;

const RUN_STAGE: Record<string, string> = {
  starting_discovery: "Preparando a busca",
  planning_search: "Entendendo o mercado",
  searching_profiles: "Procurando perfis",
  ranking_candidates: "Verificando candidatos",
  discovery_complete: "Radar montado",
  starting_observation: "Preparando observação",
  observing_reels: "Lendo vídeos e métricas",
  complete: "Ciclo concluído",
  failed: "Ciclo interrompido",
};

const OPPORTUNITY_STATUS: Record<
  Opportunity["status"],
  { readonly label: string; readonly tone: "neutral" | "creating" | "needs" | "scheduled" | "done" }
> = {
  detected: { label: "Detectado", tone: "neutral" },
  analyzing: { label: "Analisando", tone: "creating" },
  adapting: { label: "Criando versão", tone: "creating" },
  awaiting_approval: { label: "Pronto para você", tone: "needs" },
  publishing: { label: "Publicando", tone: "scheduled" },
  published: { label: "Publicado", tone: "done" },
  measuring: { label: "Medindo", tone: "done" },
  dismissed: { label: "Dispensado", tone: "neutral" },
  failed: { label: "Falhou", tone: "needs" },
};

function AutomaticoPage() {
  const { activeAccount: active } = useActiveAccount();
  const data = useQuery(api.market.dashboard, active ? { accountId: active.id } : "skip");
  const runNow = useAction(api.marketActions.runNow);
  const adaptNow = useAction(api.marketActions.adaptNow);
  const approve = useMutation(api.market.approveOpportunity);
  const dismiss = useMutation(api.market.dismissOpportunity);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(null);
    setError(null);
  }, [active?.id]);

  if (!active) return null;

  const execute = async (action: BusyAction, work: () => Promise<unknown>) => {
    setBusy(action);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A ação não terminou.");
    } finally {
      setBusy(null);
    }
  };

  const running = data?.latestRun?.status === "running" || busy?.kind === "run";
  const run = () => execute({ kind: "run" }, () => runNow({ accountId: active.id }));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-semibold tracking-tight text-text">
              Radar de crescimento
            </h1>
            {data?.latestRun ? (
              <StatusPill
                tone={
                  data.latestRun.status === "running"
                    ? "creating"
                    : data.latestRun.status === "failed"
                      ? "needs"
                      : "live"
                }
                dot={data.latestRun.status === "running"}
              >
                {data.latestRun.status === "running"
                  ? (RUN_STAGE[data.latestRun.stage] ?? "Vanda trabalhando")
                  : data.latestRun.status === "failed"
                    ? "atenção"
                    : "monitorando"}
              </StatusPill>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-text-4">
            {data?.latestRun
              ? `${RUN_STAGE[data.latestRun.stage] ?? data.latestRun.stage} · ${relativeTime(data.latestRun.startedAt)}`
              : "Vanda ainda não começou a observar este mercado."}
          </p>
        </div>
        <span className="flex-1" />
        {error ? (
          <span className="max-w-72 truncate text-xs text-destructive" title={error} role="alert">
            {error}
          </span>
        ) : null}
        <Button variant="outline" disabled={running} onClick={() => void run()}>
          <RefreshCw className={running ? "animate-spin" : undefined} />
          {running ? "Executando" : "Executar agora"}
        </Button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {data === undefined ? (
          <DashboardSkeleton />
        ) : data.totals.creators === 0 ? (
          <DiscoveryState data={data} running={running} onRun={() => void run()} />
        ) : (
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-5 lg:p-6">
            <MetricStrip totals={data.totals} />

            <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
              <section className="min-w-0">
                <div className="mb-3 flex items-center gap-2">
                  <TrendingUp className="size-4 text-brand-soft" />
                  <h2 className="text-body font-semibold text-text">Oportunidades</h2>
                  <span className="text-xs text-text-5">{data.opportunities.length}</span>
                </div>
                {data.opportunities.length === 0 ? (
                  <NoOpportunities running={running} />
                ) : (
                  <div className="grid gap-3 2xl:grid-cols-2">
                    {data.opportunities.map((opportunity) => (
                      <OpportunityCard
                        key={opportunity._id}
                        opportunity={opportunity}
                        busy={busy}
                        onAdapt={() =>
                          void execute({ kind: "adapt", id: opportunity._id }, () =>
                            adaptNow({ accountId: active.id, opportunityId: opportunity._id }),
                          )
                        }
                        onPublish={() =>
                          void execute({ kind: "publish", id: opportunity._id }, () =>
                            approve({ opportunityId: opportunity._id }),
                          )
                        }
                        onDismiss={() =>
                          void execute({ kind: "dismiss", id: opportunity._id }, () =>
                            dismiss({ opportunityId: opportunity._id }),
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </section>

              <aside className="min-w-0">
                <div className="mb-3 flex items-center gap-2">
                  <Activity className="size-4 text-green" />
                  <h2 className="text-body font-semibold text-text">Observando</h2>
                  <span className="text-xs text-text-5">{data.creators.length}</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
                  {data.creators.map((creator, index) => (
                    <CreatorRow
                      key={creator._id}
                      creator={creator}
                      divided={index !== data.creators.length - 1}
                    />
                  ))}
                </div>
              </aside>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function MetricStrip({ totals }: { totals: DashboardData["totals"] }) {
  const metrics: Array<{
    readonly label: string;
    readonly value: number;
    readonly icon: ComponentType<{ className?: string }>;
    readonly tone: string;
  }> = [
    { label: "contas observadas", value: totals.creators, icon: Users, tone: "text-green" },
    { label: "vídeos monitorados", value: totals.posts, icon: Video, tone: "text-peri" },
    {
      label: "oportunidades",
      value: totals.opportunities,
      icon: TrendingUp,
      tone: "text-brand-soft",
    },
    { label: "prontas para você", value: totals.ready, icon: Sparkles, tone: "text-amber" },
  ];
  return (
    <section className="grid overflow-hidden rounded-xl border border-border bg-surface shadow-sm sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({ label, value, icon: Icon, tone }, index) => (
        <div
          key={label}
          className={cn(
            "flex items-center gap-3 px-4 py-3.5",
            index > 0 && "border-t border-border sm:border-t-0 sm:border-l",
            index === 2 && "sm:border-l-0 xl:border-l",
          )}
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-inset">
            <Icon className={cn("size-4", tone)} />
          </span>
          <div>
            <div className="text-lg font-semibold tabular-nums text-text">{value}</div>
            <div className="text-caption text-text-4">{label}</div>
          </div>
        </div>
      ))}
    </section>
  );
}

function DiscoveryState({
  data,
  running,
  onRun,
}: {
  data: DashboardData;
  running: boolean;
  onRun: () => void;
}) {
  const run = data.latestRun;
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-7 shadow-sm">
        <span className="mb-5 flex size-11 items-center justify-center rounded-xl bg-creating-bg text-brand-accent">
          {running ? <RefreshCw className="size-5 animate-spin" /> : <Search className="size-5" />}
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-text">
          {running
            ? (RUN_STAGE[run?.stage ?? ""] ?? "Vanda está procurando")
            : "Monte o radar deste mercado"}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-text-3">
          {running
            ? "Vanda está transformando o que aprendeu sobre a marca em buscas, verificando perfis pequenos e selecionando apenas os que realmente pertencem ao mesmo campo."
            : "Vanda usa o contexto confirmado da marca para encontrar contas pequenas, acompanhar seus vídeos e detectar tração fora do comum."}
        </p>

        {run?.category ? (
          <div className="mt-5 rounded-lg border border-border bg-inset p-3">
            <div className="font-mono text-micro tracking-widest text-text-5 uppercase">
              foco inferido
            </div>
            <div className="mt-1.5 text-body font-medium text-text-2">
              {[run.category, run.location, run.language].filter(Boolean).join(" · ")}
            </div>
          </div>
        ) : null}

        {run?.status === "failed" && run.error ? (
          <p className="mt-4 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-xs text-destructive">
            {run.error}
          </p>
        ) : null}

        <div className="mt-6 flex items-center gap-3">
          <Button disabled={running} onClick={onRun}>
            {running ? <RefreshCw className="animate-spin" /> : <Search />}
            {running ? "Procurando contas" : "Encontrar contas"}
          </Button>
          <span className="text-xs text-text-5">até 1.000 seguidores</span>
        </div>
      </div>
    </div>
  );
}

function NoOpportunities({ running }: { running: boolean }) {
  return (
    <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed border-border-strong bg-inset/35 p-8 text-center">
      <div className="max-w-sm">
        <span className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full border border-border bg-surface text-text-4">
          {running ? <RefreshCw className="size-4 animate-spin" /> : <Eye className="size-4" />}
        </span>
        <h3 className="text-sm font-semibold text-text">
          {running ? "Lendo os sinais agora" : "Nenhuma ruptura ainda"}
        </h3>
        <p className="mt-1.5 text-body leading-5 text-text-4">
          Vanda continua medindo. Quando um vídeo superar o tamanho da própria audiência ou
          acelerar, ele aparece aqui com a evidência.
        </p>
      </div>
    </div>
  );
}

function OpportunityCard({
  opportunity,
  busy,
  onAdapt,
  onPublish,
  onDismiss,
}: {
  opportunity: Opportunity;
  busy: BusyAction;
  onAdapt: () => void;
  onPublish: () => void;
  onDismiss: () => void;
}) {
  const state = OPPORTUNITY_STATUS[opportunity.status];
  const metrics = opportunity.metrics;
  const creator = opportunity.creator;
  const post = opportunity.post;
  const actionBusy = busy !== null && "id" in busy && busy.id === opportunity._id;
  const published = opportunity.scheduled?.status === "published";
  const failedPublication = opportunity.scheduled?.status === "failed";
  const visibleState = published
    ? { label: "Publicado", tone: "done" as const }
    : failedPublication
      ? { label: "Falha ao publicar", tone: "needs" as const }
      : state;

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition-[border-color] duration-150 ease-[var(--ease-out)] hover:border-border-strong">
      <div className="flex gap-3.5 p-4">
        <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-inset">
          {post?.thumbnailUrl ? (
            <img src={post.thumbnailUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-text-5">
              <Video className="size-5" />
            </span>
          )}
          <span className="absolute right-1.5 bottom-1.5 rounded bg-app/85 px-1.5 py-0.5 font-mono text-tiny text-text-2 backdrop-blur-sm">
            REEL
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-text-3">
                @{creator?.handle ?? "conta observada"}
              </div>
              <h3 className="mt-1 line-clamp-2 text-card-title font-semibold leading-5 text-text">
                {opportunity.adaptedHook ?? post?.caption ?? "Vídeo ganhando tração"}
              </h3>
            </div>
            <StatusPill tone={visibleState.tone} dot={visibleState.tone === "creating"}>
              {visibleState.label}
            </StatusPill>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-text-4">
            <span className="inline-flex items-center gap-1.5">
              <Eye className="size-3" />
              <strong className="font-medium tabular-nums text-text-2">
                {compactNumber(metrics?.views ?? metrics?.plays)}
              </strong>
              views
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-3" />
              <strong className="font-medium tabular-nums text-text-2">
                {compactNumber(metrics?.followers ?? creator?.followers)}
              </strong>
              seguidores
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-inset/45 px-4 py-3">
        <div className="flex items-start gap-2 text-body text-text-3">
          <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-brand-soft" />
          <p className="leading-5">{opportunity.triggerReason}</p>
        </div>
        {opportunity.adaptedSlides?.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {opportunity.adaptedSlides.slice(0, 3).map((slide, index) => (
              <span
                key={slide}
                className="max-w-full truncate rounded-md border border-border bg-surface px-2 py-1 text-caption text-text-4"
              >
                {index + 1}. {slide}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
        {post?.permalink ? (
          <Button
            variant="ghost"
            size="sm"
            render={<a href={post.permalink} target="_blank" rel="noreferrer" />}
          >
            Ver fonte <ArrowUpRight />
          </Button>
        ) : null}
        <span className="flex-1" />
        {(opportunity.status === "detected" || opportunity.status === "failed") && !published ? (
          <Button size="sm" disabled={actionBusy} onClick={onAdapt}>
            {actionBusy ? <RefreshCw className="animate-spin" /> : <Sparkles />}
            Criar versão
          </Button>
        ) : null}
        {opportunity.status === "awaiting_approval" ? (
          <Button size="sm" disabled={actionBusy} onClick={onPublish}>
            {actionBusy ? <RefreshCw className="animate-spin" /> : <Check />}
            Publicar
          </Button>
        ) : null}
        {!published && opportunity.status !== "publishing" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dispensar oportunidade"
            disabled={actionBusy}
            onClick={onDismiss}
          >
            <X />
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function CreatorRow({ creator, divided }: { creator: Creator; divided: boolean }) {
  return (
    <a
      href={creator.profileUrl}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "group flex items-center gap-3 px-3.5 py-3 outline-none transition-[background-color] duration-150 ease-[var(--ease-out)] hover:bg-accent focus-visible:bg-accent",
        divided && "border-b border-border",
      )}
    >
      <Avatar className="size-9 border border-border bg-inset">
        <AvatarImage src={creator.profileImageUrl} alt="" />
        <AvatarFallback>{initials(creator.displayName ?? creator.handle)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-body font-semibold text-text-2">@{creator.handle}</span>
          {creator.verified ? <Check className="size-3 text-peri" /> : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-caption text-text-5">
          <span>{compactNumber(creator.followers)} seguidores</span>
          {creator.lastObservedAt ? (
            <>
              <span>·</span>
              <span>{relativeTime(creator.lastObservedAt)}</span>
            </>
          ) : null}
        </div>
      </div>
      <ArrowUpRight className="size-3.5 text-text-6 transition-colors duration-150 group-hover:text-text-3" />
    </a>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-6">
      <div className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-20 rounded-none" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid gap-3 2xl:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-56 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (seconds < 45) return "agora";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.round(hours / 24)}d`;
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
}
