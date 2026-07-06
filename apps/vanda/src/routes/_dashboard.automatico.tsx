import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, PencilLine, Plus } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { AutomaticoBoard, PlanCard as PlanCardData } from "../convex/board";
import { AgendadoCard } from "../components/automatico/agendado-card";
import { BoardColumn } from "../components/automatico/board-column";
import { EmptyState } from "../components/automatico/empty-state";
import { LineageSheet } from "../components/automatico/lineage-sheet";
import { type Mode, ModeToggle } from "../components/automatico/mode-toggle";
import { ObservingRail } from "../components/automatico/observing-rail";
import { PlanCard } from "../components/automatico/plan-card";

export const Route = createFileRoute("/_dashboard/automatico")({
  // `welcome` is set once, right after onboarding, to show the handoff banner.
  validateSearch: (search: Record<string, unknown>): { welcome?: true } =>
    search.welcome === true || search.welcome === "true" ? { welcome: true } : {},
  component: AutomaticoPage,
});

const MODE_HINT: Record<Mode, string> = {
  auto: "A Vanda cria e agenda sozinha. Você só entra quando ela te chama.",
  needs_approval: "Toda ideia espera sua aprovação antes de virar post.",
  manual: "A Vanda propõe; você escolhe o que criar.",
};

function AutomaticoPage() {
  const { welcome } = Route.useSearch();
  const navigate = useNavigate();
  const accounts = useQuery(api.accounts.listMine);
  const active = accounts?.find((account) => account.onboardedAt != null) ?? accounts?.[0];
  const board = useQuery(api.board.board, active ? { accountId: active.id } : "skip");
  const observing = useQuery(api.board.observing, active ? { accountId: active.id } : "skip");

  const setMode = useMutation(api.accounts.setMode);
  const delegate = useMutation(api.create.delegate);
  const approveAll = useMutation(api.create.approveAll);
  const dismiss = useMutation(api.board.dismiss);

  const [selected, setSelected] = useState<Id<"suggestions"> | null>(null);

  if (accounts === undefined) return <div className="flex-1 bg-app" />;
  if (!active) return null; // the dashboard gate handles the no-account case

  const mode = active.mode;

  const cardHandlers = {
    onDelegate: (id: Id<"suggestions">) => void delegate({ suggestionId: id }),
    onDismiss: (id: Id<"suggestions">) => void dismiss({ suggestionId: id }),
    onTakeOver: () => void navigate({ to: "/galeria" }), // Eu faço → the editor (Galeria)
    onOpen: (id: Id<"suggestions">) => setSelected(id),
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {welcome ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-inset px-6 py-3">
          <StatusPill tone="done" dot>
            Pronto
          </StatusPill>
          <span className="text-[13px] text-text-2">A Vanda já está observando.</span>
          <span className="text-[13px] text-text-4">
            Você está no controle — ela só te chama quando precisar.
          </span>
        </div>
      ) : null}

      <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-border px-6">
        <h1 className="text-[16px] font-semibold tracking-[-0.01em] text-text">Automático</h1>
        <span className="inline-flex items-center gap-1.5 text-xs text-green">
          <span className="size-1.5 rounded-full bg-green shadow-[0_0_6px] shadow-green motion-safe:animate-pulse" />
          ao vivo
        </span>
        <span className="flex-1" />
        <ModeToggle
          mode={mode}
          onChange={(next) => void setMode({ accountId: active.id, mode: next })}
        />
      </header>

      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-border bg-inset px-6">
        <span className="size-1.5 rounded-full bg-green" />
        <span className="text-[12.5px] text-text-3">{MODE_HINT[mode]}</span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-hidden p-5">
          {board === undefined ? (
            <BoardSkeleton />
          ) : (
            <BoardGrid
              mode={mode}
              board={board}
              handlers={cardHandlers}
              onApproveAll={() => void approveAll({ accountId: active.id })}
              onStartFromScratch={() => void navigate({ to: "/galeria" })}
            />
          )}
        </div>
        <ObservingRail data={observing} />
      </div>

      <LineageSheet suggestionId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

interface CardHandlers {
  onDelegate: (id: Id<"suggestions">) => void;
  onDismiss: (id: Id<"suggestions">) => void;
  onTakeOver: (id: Id<"suggestions">) => void;
  onOpen: (id: Id<"suggestions">) => void;
}

/** Render a pool of plan cards with the shared handlers, honoring actionability + the mode's primary intent. */
function planCards(
  cards: PlanCardData[],
  actionable: boolean,
  handlers: CardHandlers,
  primary: "vanda" | "voce" = "vanda",
) {
  return cards.map((card) => (
    <PlanCard
      key={card.id}
      card={card}
      actionable={actionable}
      primary={primary}
      onDelegate={handlers.onDelegate}
      onTakeOver={handlers.onTakeOver}
      onDismiss={handlers.onDismiss}
      onOpen={handlers.onOpen}
    />
  ));
}

/**
 * The board — the same pipeline pools, re-balanced by mode. Auto spreads the
 * three stages evenly; Aprovação widens the review queue (where the work lands);
 * Manual widens the proposals (the owner composes). Aprovação/Manual stack the
 * two secondary stages in a thin rail so the columns never go crooked.
 */
function BoardGrid({
  mode,
  board,
  handlers,
  onApproveAll,
  onStartFromScratch,
}: {
  mode: Mode;
  board: AutomaticoBoard;
  handlers: CardHandlers;
  onApproveAll: () => void;
  onStartFromScratch: () => void;
}) {
  const agendado = (
    <BoardColumn name="Agendado" count={board.scheduled.length} tone="green">
      {board.scheduled.length > 0 ? (
        board.scheduled.map((card) => (
          <AgendadoCard key={card.id} card={card} onOpen={handlers.onOpen} />
        ))
      ) : (
        <EmptyState
          icon={CheckCircle2}
          tone="muted"
          title="Nada agendado ainda"
          body="Os posts prontos aparecem aqui, fixados na data em que vão ao ar."
        />
      )}
    </BoardColumn>
  );

  const vandaFazendo = (
    <BoardColumn name="Vanda fazendo" count={board.creating.length} tone="brand">
      {board.creating.length > 0 ? (
        planCards(board.creating, false, handlers)
      ) : mode === "manual" ? (
        <EmptyState
          icon={PencilLine}
          tone="muted"
          title="No manual, quem cria é você"
          body="Escolha uma proposta com “Eu faço” — ou delegue com “Vanda faz”."
        />
      ) : (
        <EmptyState
          icon={CheckCircle2}
          tone="muted"
          title="Nada em produção"
          body="Quando a Vanda pega uma ideia, o progresso aparece aqui."
        />
      )}
    </BoardColumn>
  );

  // Aprovação/Manual share a two-region split: a widened, focused primary column
  // and a thin rail stacking the two secondary stages.
  const secondaryRail = (
    <div className="grid min-h-0 grid-rows-2 gap-[13px]">
      {vandaFazendo}
      {agendado}
    </div>
  );

  if (mode === "auto") {
    const queued = [...board.creating, ...board.pool];
    return (
      <div className="grid h-full grid-cols-3 gap-[13px]">
        <BoardColumn
          name="Precisa de você"
          count={board.needsYou.length}
          tone={board.needsYou.length > 0 ? "amber" : "green"}
        >
          {board.needsYou.length > 0 ? (
            planCards(board.needsYou, true, handlers)
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="Tudo sob controle"
              body="Nada precisa de você agora. A Vanda cuida das ideias e te chama só quando uma decisão for sua."
            />
          )}
        </BoardColumn>
        <BoardColumn name="Vanda fazendo" count={queued.length} tone="brand">
          {queued.length > 0 ? (
            <>
              {planCards(board.creating, false, handlers)}
              {planCards(board.pool, false, handlers)}
            </>
          ) : (
            <EmptyState
              icon={CheckCircle2}
              tone="muted"
              title="Nada em produção"
              body="Quando a Vanda pega uma ideia, o progresso aparece aqui."
            />
          )}
        </BoardColumn>
        {agendado}
      </div>
    );
  }

  if (mode === "needs_approval") {
    const queue = [...board.needsYou, ...board.pool];
    return (
      <div className="grid h-full grid-cols-[1.7fr_1fr] gap-[13px]">
        <BoardColumn
          name="Fila de revisão"
          count={queue.length}
          tone="amber"
          className="rounded-xl bg-inset/40 p-2.5"
          action={
            queue.length > 0 ? (
              <Button variant="subtle" size="xs" onClick={onApproveAll}>
                Aprovar todas
              </Button>
            ) : null
          }
        >
          {queue.length > 0 ? (
            planCards(queue, true, handlers)
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="Fila vazia"
              body="Nada esperando você. Novas ideias entram aqui pra revisão."
            />
          )}
        </BoardColumn>
        {secondaryRail}
      </div>
    );
  }

  const proposals = [...board.pool, ...board.needsYou];
  return (
    <div className="grid h-full grid-cols-[1.5fr_1fr] gap-[13px]">
      <BoardColumn
        name="Propostas da Vanda"
        count={proposals.length}
        tone="peri"
        className="rounded-xl bg-inset/40 p-2.5"
        action={
          <Button variant="subtle" size="xs" onClick={onStartFromScratch}>
            <Plus /> Começar do zero
          </Button>
        }
      >
        {proposals.length > 0 ? (
          planCards(proposals, true, handlers, "voce")
        ) : (
          <EmptyState
            icon={PencilLine}
            tone="muted"
            title="Sem propostas ainda"
            body="A Vanda traz ideias conforme observa. Ou comece uma do zero."
          />
        )}
      </BoardColumn>
      {secondaryRail}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid h-full grid-cols-3 gap-[13px]">
      {[0, 1, 2].map((column) => (
        <div key={column} className="flex flex-col gap-2.5">
          <Skeleton className="mb-1 h-4 w-32" />
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

export { AutomaticoPage };
