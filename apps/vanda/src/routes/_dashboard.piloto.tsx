import { useMemo, useState, type CSSProperties } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { CalendarClock, Pencil, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { Tag } from "@vanda-studio/ui/components/tag";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import { CadenceEditor } from "../components/autopilot/cadence-editor";
import { SlotEditor } from "../components/autopilot/slot-editor";
import {
  WEEKDAY_NAMES,
  WeekStrip,
  hourLabel,
  slidesLabel,
} from "../components/autopilot/week-strip";
import { showErrorToast } from "../components/error-feedback";
import { api } from "../convex/_generated/api";
import type { AutopilotOverview, AutopilotSlotView } from "../convex/autopilotData";

export const Route = createFileRoute("/_dashboard/piloto")({
  component: PilotoPage,
});

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;

const count = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : value.toLocaleString("pt-BR");

const PANEL = "rounded-lg border border-border bg-surface p-4";

const CONFIDENCE = { baixa: "confiança baixa", media: "confiança média", alta: "confiança alta" };

function PilotoPage() {
  const { activeAccount } = useActiveAccount();

  const overview = useQuery(
    api.autopilot.overview,
    activeAccount ? { accountId: activeAccount.id } : "skip",
  );

  const setEnabled = useMutation(api.autopilot.setEnabled);

  if (!activeAccount) return null;

  // On/off is the autopilot.enabled setting: Vanda and Caetano change it with settings_set.
  const enable = async () => {
    try {
      await setEnabled({ enabled: true });
    } catch (error) {
      showErrorToast(error);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-app px-4 md:px-6">
        <CalendarClock className="size-4 text-text-4" aria-hidden="true" />
        <h1 className="mr-auto text-sm font-semibold text-text">Piloto automático</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto grid w-full max-w-5xl gap-4">
          {overview === undefined ? (
            <>
              <Skeleton className="h-28" />
              <Skeleton className="h-56" />
            </>
          ) : (
            <PilotoContent overview={overview} onEnable={() => void enable()} />
          )}
        </div>
      </main>
    </div>
  );
}

function PilotoContent({
  overview,
  onEnable,
}: {
  overview: AutopilotOverview;
  onEnable: () => void;
}) {
  const [cadenceOpen, setCadenceOpen] = useState(false);
  const [weekIndex, setWeekIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const week = overview.weeks[weekIndex] ?? overview.weeks[0];

  const selected: AutopilotSlotView | null = useMemo(
    () =>
      overview.weeks.flatMap((item) => item.slots).find((slot) => slot.slotId === selectedId) ??
      null,
    [overview, selectedId],
  );

  return (
    <>
      {!overview.connected ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-needs-border bg-needs-bg p-4">
          <p className="mr-auto text-body text-text-2">
            Conecte o Instagram do negócio para o piloto analisar a conta e publicar.
          </p>
          <Button size="sm" variant="outline" render={<Link to="/perfil" />}>
            Conectar em Perfil
          </Button>
        </div>
      ) : null}

      {!overview.enabled ? <Intro onEnable={onEnable} connected={overview.connected} /> : null}

      <CadenceCard overview={overview} onEdit={() => setCadenceOpen(true)} />

      {week ? (
        <section className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-sm font-semibold text-text">Programação</h2>
            {overview.weeks.map((item, index) => (
              <Button
                key={item.weekStart}
                size="sm"
                variant={index === weekIndex ? "secondary" : "ghost"}
                onClick={() => setWeekIndex(index)}
              >
                {index === 0 ? "Esta semana" : "Próxima semana"} · {item.label}
              </Button>
            ))}
          </div>
          {week.strategy ? <p className="text-note text-text-4">{week.strategy}</p> : null}
          {week.slots.length === 0 ? (
            <div className="rounded-lg border border-border bg-inset p-6 text-center text-body text-text-4">
              {overview.enabled
                ? "Esta semana ainda não tem posts planejados. O planejamento roda aos domingos, ou quando você reanalisa."
                : "Ligue o piloto automático para a Vanda planejar a semana."}
            </div>
          ) : (
            <WeekStrip
              week={week}
              size="board"
              selectedSlotId={selectedId}
              onSelectSlot={(slot) => setSelectedId(slot.slotId)}
            />
          )}
        </section>
      ) : null}

      <AuditCard overview={overview} />

      <History accountId={overview.accountId} />

      <SlotEditor
        key={selected?.slotId ?? "none"}
        accountId={overview.accountId}
        slot={selected}
        onClose={() => setSelectedId(null)}
      />
      {cadenceOpen ? (
        <CadenceEditor
          accountId={overview.accountId}
          cadence={overview.cadence}
          source={overview.cadenceSource}
          open={cadenceOpen}
          onClose={() => setCadenceOpen(false)}
        />
      ) : null}
    </>
  );
}

function Intro({ onEnable, connected }: { onEnable: () => void; connected: boolean }) {
  return (
    <section className={cn(PANEL, "grid gap-3 p-5")}>
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-brand-accent" aria-hidden="true" />
        <h2 className="text-base font-semibold text-text">Posts de feed no automático</h2>
      </div>
      <ol className="grid gap-1.5 text-body text-text-3">
        <li>1. A Vanda analisa a conta e diz do que ela precisa.</li>
        <li>2. Monta a cadência da semana: dias, horários, imagem ou carrossel.</li>
        <li>3. Gera cada post cerca de 24 horas antes e publica sozinha.</li>
        <li>4. Você vê tudo aqui e pode editar, pular ou gerar de novo até o horário.</li>
      </ol>
      <p className="text-note text-text-4">
        Fica separado dos posts que você cria na conversa. Por enquanto, só posts de feed. A Vanda e
        o Caetano também ligam, desligam e mudam a cadência quando você pedir.
      </p>
      <Button className="justify-self-start" onClick={onEnable} disabled={!connected}>
        Ligar piloto automático
      </Button>
    </section>
  );
}

function CadenceCard({ overview, onEdit }: { overview: AutopilotOverview; onEdit: () => void }) {
  return (
    <section className={cn(PANEL, "flex flex-col gap-3 md:flex-row md:items-start")}>
      <div className="grid flex-1 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-text">Cadência</h2>
          <Tag tone={overview.cadenceSource === "owner" ? "neutral" : "brand"}>
            {overview.cadenceSource === "owner" ? "editada por você" : "sugerida pela Vanda"}
          </Tag>
        </div>
        <p className="font-mono text-body text-text-2">{overview.cadenceSummary}</p>
        <ul className="grid gap-0.5 text-body text-text-3">
          {overview.cadence.map((entry) => (
            <li key={`${entry.weekday}-${entry.time}`}>
              <span className="font-medium text-text-2">
                {WEEKDAY_NAMES[entry.weekday]} {hourLabel(entry.time)}
              </span>{" "}
              · {entry.type === "carousel" ? "carrossel" : "imagem"} ·{" "}
              {slidesLabel(entry.slideCount)}
            </li>
          ))}
        </ul>
        {overview.cadenceRationale ? (
          <p className="text-note text-text-4">{overview.cadenceRationale}</p>
        ) : null}
      </div>
      <Button variant="outline" size="sm" className="self-start" onClick={onEdit}>
        <Pencil /> Editar cadência
      </Button>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <div className="grid gap-0.5 rounded-md border border-border bg-inset px-3 py-2">
      <span className="text-caption text-text-4">{label}</span>
      <span className="font-mono text-base font-semibold text-text">{value}</span>
      {hint ? <span className="text-micro text-text-5">{hint}</span> : null}
    </div>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null;

  return (
    <div className="grid gap-1">
      <h3 className={cn("text-caption font-semibold tracking-wide uppercase", tone)}>{title}</h3>
      <ul className="grid gap-1 text-body text-text-2">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function AuditCard({ overview }: { overview: AutopilotOverview }) {
  const reanalyze = useMutation(api.autopilot.reanalyze);
  const audit = overview.audit;
  const metrics = audit?.metrics;

  const run = async () => {
    try {
      await reanalyze({ accountId: overview.accountId });
    } catch (error) {
      showErrorToast(error);
    }
  };

  return (
    <section className={cn(PANEL, "grid gap-4")}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold text-text">Diagnóstico da conta</h2>
        {audit ? (
          <span className="text-note text-text-4">
            {new Date(audit.createdAt).toLocaleDateString("pt-BR")}
            {audit.confidence ? ` · ${CONFIDENCE[audit.confidence]}` : ""}
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={overview.auditRunning || !overview.connected}
          onClick={() => void run()}
        >
          {overview.auditRunning ? <Spinner /> : <RefreshCw />}
          {overview.auditRunning ? "Analisando…" : "Reanalisar"}
        </Button>
      </div>

      {!audit ? (
        <p className="text-body text-text-4">
          {overview.auditRunning
            ? "A Vanda está lendo os posts e as métricas da conta."
            : "Ainda sem diagnóstico. Ele roda ao ligar o piloto e todo domingo."}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-4 md:flex-row">
            <div className="grid shrink-0 content-start justify-items-center gap-1 rounded-lg border border-border bg-inset p-4 md:w-40">
              <span className="font-mono text-3xl font-semibold text-text">
                {audit.profileScore ?? "—"}
              </span>
              <span className="text-caption text-text-4">nota do perfil / 100</span>
            </div>
            <div className="grid flex-1 gap-2">
              {audit.summary ? <p className="text-body text-text-2">{audit.summary}</p> : null}
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Metric
                  label="Mediana de alcance"
                  value={count(metrics?.medianReach)}
                  hint={metrics ? `${metrics.sampleSize} posts` : undefined}
                />
                <Metric label="Salvos / alcance" value={percent(metrics?.savesPerReach)} />
                <Metric label="Envios / alcance" value={percent(metrics?.sharesPerReach)} />
                <Metric
                  label="Posts por semana"
                  value={count(metrics?.postsPerWeek)}
                  hint={
                    metrics?.daysSinceLastPost !== undefined
                      ? `último há ${metrics.daysSinceLastPost} dias`
                      : undefined
                  }
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <List title="Do que a conta precisa" items={audit.needs} tone="text-brand-accent" />
            <List title="Faça mais" items={audit.doMore} tone="text-green" />
            <List title="Pare" items={audit.stop} tone="text-amber" />
          </div>

          {audit.findings.length > 0 ? (
            <div className="grid gap-1">
              <h3 className="text-caption font-semibold tracking-wide text-text-4 uppercase">
                O que os dados dizem
              </h3>
              <ul className="grid gap-1 text-body text-text-3">
                {audit.findings.map((finding) => (
                  <li key={finding.claim}>
                    <span className="text-text-2">{finding.claim}</span> — {finding.evidence}
                    {finding.n ? ` (n=${finding.n})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {audit.rubric.length > 0 ? (
            <div className="grid gap-1.5">
              <h3 className="text-caption font-semibold tracking-wide text-text-4 uppercase">
                Perfil
              </h3>
              {audit.rubric.map((item) => (
                <div key={item.item} className="grid gap-0.5">
                  <div className="flex items-center gap-2 text-note">
                    <span className="w-36 shrink-0 truncate text-text-2">{item.item}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-inset">
                      <div
                        className="h-full w-(--score) rounded-full bg-brand-accent"
                        // SAFETY: React accepts custom properties at runtime; CSSProperties omits their open-ended names.
                        style={
                          {
                            "--score": `${Math.round((item.score / Math.max(1, item.max)) * 100)}%`,
                          } as CSSProperties
                        }
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-text-4">
                      {item.score}/{item.max}
                    </span>
                  </div>
                  {item.fix && item.score < item.max ? (
                    <p className="pl-38 text-micro text-text-4">{item.fix}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function History({ accountId }: { accountId: AutopilotOverview["accountId"] }) {
  const weeks = useQuery(api.autopilot.history, { accountId });
  const published = (weeks ?? []).filter((week) => week.slots.length > 0);

  if (published.length === 0) return null;

  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-semibold text-text">Semanas anteriores</h2>
      {published.map((week) => (
        <div key={week.weekStart} className={cn(PANEL, "grid gap-2 p-3")}>
          <span className="text-caption font-medium text-text-3">Semana de {week.label}</span>
          <ul className="grid gap-1">
            {week.slots.map((slot) => (
              <li key={slot.slotId} className="flex flex-wrap items-center gap-2 text-note">
                <span className="w-24 font-mono text-text-2">
                  {WEEKDAY_NAMES[slot.weekday]?.slice(0, 3)} {hourLabel(slot.time)}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-3">“{slot.hook}”</span>
                {slot.results ? (
                  <span className="font-mono text-text-4">
                    {count(slot.results.reach)} alcance
                    {slot.results.outlier !== undefined
                      ? ` · ${slot.results.outlier}× da mediana`
                      : ""}
                  </span>
                ) : (
                  <StatusPill tone={slot.status === "published" ? "done" : "neutral"}>
                    {slot.status === "published" ? "Publicado" : "Sem resultado"}
                  </StatusPill>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
