import { CheckCircle2, CircleAlert, Clock3, LoaderCircle, ShieldX } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@vanda-studio/ui/components/sheet";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import type {
  PipelineReceipt,
  PipelineReceiptState,
  PipelineStageReceipt,
} from "../../convex/pipelineDiagnostics";
import { relativeTime } from "./meta";

const STAGE_LABEL: Record<PipelineStageReceipt["stage"], string> = {
  brand_profile: "Perfil da marca",
  consolidate: "Aprendizado",
  plan: "Planejamento",
  create: "Criação",
  embedding: "Memória vetorial",
  market_discovery: "Descoberta de mercado",
  market_adapt: "Adaptação",
};

const STATE_COPY: Record<
  PipelineReceiptState,
  { title: string; body: string; tone: "done" | "creating" | "needs" | "neutral" }
> = {
  idle: {
    title: "Nenhuma análise executada",
    body: "Ainda não há um ciclo registrado para este negócio.",
    tone: "neutral",
  },
  running: {
    title: "Análise em andamento",
    body: "Os resultados aparecem aqui conforme cada etapa termina.",
    tone: "creating",
  },
  failed: {
    title: "A análise falhou",
    body: "Uma das etapas não terminou. Veja o erro abaixo antes de tentar novamente.",
    tone: "needs",
  },
  waiting_for_evidence: {
    title: "Ainda sem evidência suficiente",
    body: "Os sinais foram processados, mas nenhuma crença passou pelo limiar de confiança.",
    tone: "neutral",
  },
  filtered: {
    title: "As ideias não passaram pela revisão",
    body: "A Vanda aprendeu com os sinais e gerou ideias, mas a revisão de qualidade barrou todas.",
    tone: "needs",
  },
  ready: {
    title: "Ideias prontas",
    body: "O ciclo terminou e há propostas disponíveis no quadro.",
    tone: "done",
  },
  complete: {
    title: "Análise concluída",
    body: "O ciclo terminou sem erros e não deixou trabalho pendente no quadro.",
    tone: "done",
  },
};

function StageIcon({ status }: { status: PipelineStageReceipt["status"] }) {
  if (status === "running")
    return <LoaderCircle className="size-4 animate-spin text-brand-accent" />;
  if (status === "failed") return <CircleAlert className="size-4 text-destructive" />;
  return <CheckCircle2 className="size-4 text-green" />;
}

export function PipelineDiagnosticsSheet({
  open,
  onOpenChange,
  receipt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: PipelineReceipt | undefined;
}) {
  const state = receipt?.state ?? "idle";
  const copy = STATE_COPY[state];
  const OutcomeIcon = state === "failed" ? CircleAlert : state === "filtered" ? ShieldX : Clock3;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle>Última análise</SheetTitle>
          <SheetDescription>
            {receipt?.completedAt
              ? `Concluída ${relativeTime(receipt.completedAt)}`
              : "Estado atual do pipeline"}
          </SheetDescription>
        </SheetHeader>

        <section className="border-b border-border px-5 py-5">
          <div className="mb-3 flex items-center gap-2.5">
            <OutcomeIcon className="size-4 text-text-3" />
            <StatusPill tone={copy.tone}>{copy.title}</StatusPill>
          </div>
          <p className="text-body-sm leading-relaxed text-text-3">{copy.body}</p>
        </section>

        <section className="grid grid-cols-3 border-b border-border">
          <div className="border-r border-border px-4 py-4">
            <p className="text-micro text-text-5">Sinais úteis</p>
            <p className="mt-1 text-lg font-semibold text-text">
              {receipt?.signals.actionable ?? 0}
              <span className="text-xs font-normal text-text-5">
                /{receipt?.signals.total ?? 0}
              </span>
            </p>
          </div>
          <div className="border-r border-border px-4 py-4">
            <p className="text-micro text-text-5">Crenças prontas</p>
            <p className="mt-1 text-lg font-semibold text-text">{receipt?.beliefs.eligible ?? 0}</p>
          </div>
          <div className="px-4 py-4">
            <p className="text-micro text-text-5">Ideias aprovadas</p>
            <p className="mt-1 text-lg font-semibold text-text">
              {receipt?.proposals.accepted ?? 0}
              <span className="text-xs font-normal text-text-5">
                /{receipt?.proposals.generated ?? 0}
              </span>
            </p>
          </div>
        </section>

        <section className="border-b border-border px-5 py-5">
          <h2 className="mb-3 text-xs font-medium text-text-3">Etapas</h2>
          <div className="flex flex-col gap-3">
            {receipt?.stages.map((stage) => (
              <div key={stage.stage} className="flex items-start gap-3">
                <StageIcon status={stage.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-body-sm font-medium text-text">
                      {STAGE_LABEL[stage.stage]}
                    </span>
                    <span className="truncate text-micro text-text-6">{stage.model}</span>
                  </div>
                  <p className="mt-0.5 text-caption text-text-4">
                    {stage.error ?? stage.summary ?? "Sem resumo disponível"}
                    {stage.durationMs !== null ? ` · ${(stage.durationMs / 1000).toFixed(1)}s` : ""}
                  </p>
                </div>
              </div>
            ))}
            {receipt && receipt.stages.length === 0 ? (
              <p className="text-caption text-text-5">Nenhuma etapa registrada.</p>
            ) : null}
          </div>
        </section>

        {receipt && receipt.proposals.rejectedItems.length > 0 ? (
          <section className="px-5 py-5">
            <div className="mb-3 flex items-center gap-2">
              <ShieldX className="size-4 text-amber" />
              <h2 className="text-xs font-medium text-text-3">
                {receipt.proposals.rejected}{" "}
                {receipt.proposals.rejected === 1 ? "ideia barrada" : "ideias barradas"}
              </h2>
            </div>
            <div className="flex flex-col divide-y divide-border">
              {receipt.proposals.rejectedItems.map((item) => (
                <div key={item.title} className="py-3 first:pt-0">
                  <p className="text-body-sm font-medium text-text">{item.title}</p>
                  <p className="mt-1 text-caption leading-relaxed text-text-4">{item.reason}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
