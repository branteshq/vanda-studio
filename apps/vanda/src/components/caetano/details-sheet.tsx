import type { CSSProperties } from "react";
import { useQuery } from "convex-helpers/react/cache";
import { useMutation } from "convex/react";
import { Check, RefreshCw, Star, X } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@vanda-studio/ui/components/sheet";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { AutopilotOverview } from "../../convex/autopilotData";
import { Meter, PanelSection, StatTile, scoreTone } from "../autopilot/visuals";
import { WEEKDAY_NAMES, hourLabel } from "../autopilot/week-strip";
import { showErrorToast } from "../error-feedback";

/**
 * The account diagnosis, read first and acted on second: the score and the one
 * line that explains it, the numbers measured from the account, what to do,
 * the profile items that were actually seen, then the evidence. Anything the
 * owner wants changed goes to Caetano in the chat.
 */

const CONFIDENCE = { baixa: "confiança baixa", media: "confiança média", alta: "confiança alta" };

const PERCENT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : PERCENT.format(value);

const count = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

const lastPostHint = (days: number | undefined): string | undefined => {
  if (days === undefined) return undefined;

  if (days === 0) return "último post hoje";

  return days === 1 ? "último post ontem" : `último post há ${days} dias`;
};

const auditDate = (overview: AutopilotOverview): string =>
  overview.audit ? new Date(overview.audit.createdAt).toLocaleDateString("pt-BR") : "";

type Audit = NonNullable<AutopilotOverview["audit"]>;

const ACTIONS = [
  { key: "needs", title: "Prioridade", icon: Star, iconClass: "text-brand-accent" },
  { key: "doMore", title: "Faça mais", icon: Check, iconClass: "text-green" },
  { key: "stop", title: "Pare", icon: X, iconClass: "text-destructive" },
] as const;

/** What to do, in three named lists: the label says which list, not only the icon. */
function ActionLists({ audit }: { audit: Audit }) {
  const lists = ACTIONS.filter(({ key }) => audit[key].length > 0);

  if (lists.length === 0) return null;

  return (
    <PanelSection title="O que fazer">
      <div className="grid gap-3">
        {lists.map(({ key, title, icon: Icon, iconClass }) => (
          <div key={key} className="grid gap-1.5">
            <span className="inline-flex items-center gap-1.5 text-note font-medium text-text-2">
              <Icon className={cn("size-3.5", iconClass)} aria-hidden="true" />
              {title}
            </span>
            <ul className="grid gap-1 border-l border-border pl-3">
              {audit[key].map((item) => (
                <li key={item} className="text-note leading-snug text-text-3">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </PanelSection>
  );
}

/** The profile items that were seen, biggest gap first; the unseen ones only named. */
function ProfileRubric({ audit }: { audit: Audit }) {
  const seen = audit.rubric
    .filter((item) => item.observed !== false)
    .toSorted((a, b) => b.max - b.score - (a.max - a.score));

  const unseen = audit.rubric.filter((item) => item.observed === false);

  if (seen.length === 0 && unseen.length === 0) return null;

  return (
    <PanelSection title="Perfil">
      <ul className="grid gap-2.5">
        {seen.map((item) => (
          <li key={item.item} className="grid gap-1">
            <span className="flex items-baseline gap-3 text-note">
              <span className="mr-auto font-medium text-text-2">{item.item}</span>
              <span className="text-micro text-text-4 tabular-nums">
                {item.score}/{item.max}
              </span>
            </span>
            <Meter
              ratio={item.score / Math.max(1, item.max)}
              tone={scoreTone((item.score / Math.max(1, item.max)) * 100)}
              label={`${item.item}: ${item.score} de ${item.max}`}
            />
            {item.fix && item.score < item.max ? (
              <span className="text-micro leading-snug text-text-4">{item.fix}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {unseen.length > 0 ? (
        <p className="text-micro text-text-5">
          Não deu para ver (fora da nota): {unseen.map((item) => item.item).join(", ")}
        </p>
      ) : null}
    </PanelSection>
  );
}

function Diagnosis({ overview }: { overview: AutopilotOverview }) {
  const audit = overview.audit;

  if (!audit) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-center text-note text-text-4">
        {overview.auditRunning
          ? "O Caetano está analisando a conta."
          : "Ainda sem diagnóstico. Toque em Reanalisar ou peça ao Caetano."}
      </p>
    );
  }

  const metrics = audit.metrics;
  // Rates over reach only mean something when reach was measured.
  const reach = metrics?.medianReach !== undefined;

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="shrink-0 sm:w-44">
          <StatTile
            label="Nota do perfil"
            value={audit.profileScore === null ? "—" : String(audit.profileScore)}
            suffix="/100"
            meter={
              audit.profileScore === null
                ? undefined
                : { ratio: audit.profileScore / 100, tone: scoreTone(audit.profileScore) }
            }
            hint={audit.confidence ? CONFIDENCE[audit.confidence] : undefined}
          />
        </div>
        {audit.summary ? (
          <p className="text-body-sm leading-relaxed text-text-2">{audit.summary}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Posts por semana"
          value={count(metrics?.postsPerWeek)}
          hint={lastPostHint(metrics?.daysSinceLastPost)}
        />
        <StatTile
          label="Mediana de alcance"
          value={count(metrics?.medianReach)}
          hint={reach ? `${metrics?.sampleSize} posts` : "sem dados"}
        />
        <StatTile
          label="Salvos / alcance"
          value={reach ? percent(metrics?.savesPerReach) : "—"}
          hint={reach ? undefined : "sem dados"}
        />
        <StatTile
          label="Envios / alcance"
          value={reach ? percent(metrics?.sharesPerReach) : "—"}
          hint={reach ? undefined : "sem dados"}
        />
      </div>

      <ActionLists audit={audit} />
      <ProfileRubric audit={audit} />

      {audit.findings.length > 0 ? (
        <details className="group rounded-lg border border-border bg-surface px-3 py-2">
          <summary className="cursor-pointer text-note font-medium text-text-3">
            Evidências ({audit.findings.length})
          </summary>
          <ul className="mt-2 grid gap-2 text-note text-text-3">
            {audit.findings.map((finding) => (
              <li key={finding.claim}>
                <span className="text-text-2">{finding.claim}</span> — {finding.evidence}
                {finding.n ? ` (n=${finding.n})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Reach per published post, one column each; only the best one is labelled. */
function History({ accountId }: { accountId: AutopilotOverview["accountId"] }) {
  const weeks = useQuery(api.autopilot.history, { accountId });

  const posts = (weeks ?? [])
    .toReversed()
    .flatMap((week) => week.slots.filter((slot) => slot.status === "published"));

  const measured = posts.filter((slot) => slot.results?.reach !== undefined);

  if (posts.length === 0) {
    return (
      <p className="text-note text-text-4">
        O alcance de cada post automático aparece aqui dois dias depois de publicado.
      </p>
    );
  }

  if (measured.length === 0) {
    return (
      <p className="text-note text-text-4">
        {posts.length} publicado{posts.length === 1 ? "" : "s"} · resultados em 48h
      </p>
    );
  }

  const max = Math.max(...measured.map((slot) => slot.results?.reach ?? 0), 1);

  const best = measured.reduce((a, b) =>
    (b.results?.reach ?? 0) > (a.results?.reach ?? 0) ? b : a,
  );

  return (
    <figure
      className="grid gap-1"
      aria-label={`Alcance por post: ${measured.map((slot) => `${slot.hook} ${slot.results?.reach}`).join("; ")}`}
    >
      <div className="flex h-28 items-end gap-1 border-b border-border">
        {measured.map((slot) => (
          <ActionTooltip
            key={slot.slotId}
            label={`${WEEKDAY_NAMES[slot.weekday]} ${hourLabel(slot.time)} · “${slot.hook}” · ${count(slot.results?.reach)} de alcance${slot.results?.outlier !== undefined ? ` · ${slot.results.outlier}× da mediana` : ""}`}
            side="top"
          >
            <span className="relative flex h-full max-w-6 flex-1 items-end">
              {slot.slotId === best.slotId ? (
                <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-micro font-medium text-text-2">
                  {count(slot.results?.reach)}
                </span>
              ) : null}
              <span
                className="h-(--h) w-full rounded-t-sm bg-brand-accent"
                // SAFETY: React accepts custom properties at runtime; CSSProperties omits their open-ended names.
                style={
                  {
                    "--h": `${Math.max(4, ((slot.results?.reach ?? 0) / max) * 85)}%`,
                  } as CSSProperties
                }
              />
            </span>
          </ActionTooltip>
        ))}
      </div>
      <figcaption className="text-micro text-text-5">Alcance por post</figcaption>
      <details className="text-note">
        <summary className="cursor-pointer text-micro font-medium text-text-4">Tabela</summary>
        <table className="mt-1 w-full text-left text-micro">
          <thead className="text-text-5">
            <tr>
              <th className="py-0.5 font-medium">Post</th>
              <th className="py-0.5 text-right font-medium">Alcance</th>
              <th className="py-0.5 text-right font-medium">× mediana</th>
            </tr>
          </thead>
          <tbody className="text-text-3">
            {measured.map((slot) => (
              <tr key={slot.slotId} className="border-t border-border">
                <td className="max-w-40 truncate py-0.5">
                  {WEEKDAY_NAMES[slot.weekday]?.slice(0, 3)} {hourLabel(slot.time)} · {slot.hook}
                </td>
                <td className="py-0.5 text-right tabular-nums">{count(slot.results?.reach)}</td>
                <td className="py-0.5 text-right tabular-nums">
                  {slot.results?.outlier === undefined ? "—" : slot.results.outlier}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Reanalyse straight from wherever the diagnosis is shown. */
function ReanalyzeButton({ overview }: { overview: AutopilotOverview }) {
  const reanalyze = useMutation(api.autopilot.reanalyze);

  return (
    <Button
      size="xs"
      variant="outline"
      disabled={overview.auditRunning || !overview.connected}
      onClick={() => reanalyze({ accountId: overview.accountId }).catch(showErrorToast)}
    >
      {overview.auditRunning ? <Spinner /> : <RefreshCw />}
      {overview.auditRunning ? "Analisando…" : "Reanalisar"}
    </Button>
  );
}

/** Date and the reanalyse action, the same wherever the diagnosis shows. */
function DiagnosisToolbar({ overview }: { overview: AutopilotOverview }) {
  return (
    <div className="flex items-center gap-3">
      <span className="mr-auto text-note text-text-4">
        {overview.audit ? `Análise de ${auditDate(overview)}` : "Ainda sem análise"}
      </span>
      <ReanalyzeButton overview={overview} />
    </div>
  );
}

/**
 * The account's current status. One component for the Diagnóstico sheet next
 * to Caetano's chat and the business page in Perfil, so both show the same
 * thing; the sheet adds why this week's plan looks the way it does.
 */
export function AccountDiagnosis({
  overview,
  wide = false,
  withPlan = false,
}: {
  overview: AutopilotOverview;
  /** Perfil's full-width page: diagnosis and results side by side. */
  wide?: boolean;
  /** Posts automáticos: also explain this week's plan and the cadence. */
  withPlan?: boolean;
}) {
  const strategy = overview.weeks[0]?.strategy;

  return (
    <div className={cn("grid gap-8", wide && "lg:grid-cols-5")}>
      <div className={cn(wide && "lg:col-span-3")}>
        <Diagnosis overview={overview} />
      </div>
      <div className={cn("grid content-start gap-6", wide && "lg:col-span-2")}>
        {withPlan && (strategy || overview.cadenceRationale) ? (
          <PanelSection title="Plano desta semana">
            <div className="grid gap-2 text-note leading-relaxed text-text-3">
              {strategy ? <p>{strategy}</p> : null}
              {overview.cadenceRationale ? (
                <p>
                  <span className="font-medium text-text-2">Cadência: </span>
                  {overview.cadenceRationale}
                </p>
              ) : null}
            </div>
          </PanelSection>
        ) : null}
        <PanelSection title="Resultados">
          <History accountId={overview.accountId} />
        </PanelSection>
      </div>
    </div>
  );
}

export function DetailsSheet({
  overview,
  open,
  onOpenChange,
}: {
  overview: AutopilotOverview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Diagnóstico da conta</SheetTitle>
          <SheetDescription>
            {overview.handle ? `@${overview.handle} · ` : ""}o que o Caetano mediu e o que recomenda
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 px-4 pb-6">
          <DiagnosisToolbar overview={overview} />
          <AccountDiagnosis overview={overview} withPlan />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The diagnosis on its own, for a business's page in Perfil. */
export function InstagramDiagnosis({ accountId }: { accountId: AutopilotOverview["accountId"] }) {
  const overview = useQuery(api.autopilot.overview, { accountId });

  if (overview === undefined) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="grid gap-5">
      <DiagnosisToolbar overview={overview} />
      <AccountDiagnosis overview={overview} wide />
    </div>
  );
}
