import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Check, ImageOff } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import { SLOT_STATUS, formatLabel, publishLabel, slotWhen } from "../components/autopilot/format";
import { AutopilotPostDialog } from "../components/autopilot/post-dialog";
import { groupQueue } from "../components/autopilot/queue";
import { showErrorToast } from "../components/error-feedback";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { AutopilotOverview, AutopilotSlotView } from "../convex/autopilotData";
import { PRODUCE_AHEAD_MS } from "../convex/autopilotModel";

export const Route = createFileRoute("/_dashboard/posts-automaticos")({
  component: AutomaticPostsPage,
});

/**
 * Posts automáticos: the queue of what Caetano makes, not a place to chat.
 * What needs the owner's yes comes first, then what is coming, then what went
 * out. Settings are one line; changing them, or any post, is a sentence to
 * Vanda (or to Caetano on WhatsApp), who use the same settings and tools.
 */
function AutomaticPostsPage() {
  const { activeAccount } = useActiveAccount();

  const overview = useQuery(
    api.autopilot.overview,
    activeAccount ? { accountId: activeAccount.id } : "skip",
  );

  if (!activeAccount) return null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight">Posts automáticos</h1>
        {overview === undefined ? (
          <div className="mt-6 space-y-3" aria-hidden>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <Queue accountId={activeAccount.id} overview={overview} />
        )}
      </div>
    </main>
  );
}

function Queue({
  accountId,
  overview,
}: {
  accountId: Id<"accounts">;
  overview: AutopilotOverview;
}) {
  const [openSlot, setOpenSlot] = useState<Id<"autopilotSlots"> | null>(null);
  const slots = overview.weeks.flatMap((week) => week.slots);
  const queue = groupQueue(slots, Date.now());
  const opened = slots.find((slot) => slot.slotId === openSlot) ?? null;
  const planning = overview.enabled && overview.weeks.some((week) => week.status === "planning");

  return (
    <>
      <StatusLine overview={overview} />
      {overview.enabled && slots.length === 0 ? (
        <p className="mt-8 text-body-sm text-text-3">
          {planning || overview.auditRunning
            ? "O Caetano está analisando a conta e planejando a semana. Os posts aparecem aqui em alguns minutos."
            : "Nenhum post planejado para esta semana e a próxima ainda."}
        </p>
      ) : null}
      <Section title="Precisa da sua aprovação" slots={queue.approval}>
        {(slot) => (
          <Row key={slot.slotId} slot={slot} onOpen={() => setOpenSlot(slot.slotId)}>
            <ApproveButton accountId={accountId} slotId={slot.slotId} />
          </Row>
        )}
      </Section>
      <Section title="Próximos" slots={queue.upcoming}>
        {(slot) => <Row key={slot.slotId} slot={slot} onOpen={() => setOpenSlot(slot.slotId)} />}
      </Section>
      <Section title="Publicados" slots={queue.past}>
        {(slot) => <Row key={slot.slotId} slot={slot} onOpen={() => setOpenSlot(slot.slotId)} />}
      </Section>
      {overview.enabled ? (
        <p className="mt-10 text-note text-text-4">
          Para mudar dias, horários, formatos ou o que evitar, é só pedir na{" "}
          <Link to="/conversa" search={{}} className="underline">
            conversa
          </Link>
          . O Caetano também te manda cada post para aprovar no WhatsApp.
        </p>
      ) : null}
      <AutopilotPostDialog
        key={opened?.slotId ?? "none"}
        accountId={accountId}
        slot={opened}
        onClose={() => setOpenSlot(null)}
      />
    </>
  );
}

/** The settings as one sentence and the single switch the page keeps. */
function StatusLine({ overview }: { overview: AutopilotOverview }) {
  const setEnabled = useMutation(api.autopilot.setEnabled);
  const [busy, setBusy] = useState(false);

  const toggle = (enabled: boolean) => {
    setBusy(true);
    setEnabled({ enabled })
      .catch(showErrorToast)
      .finally(() => setBusy(false));
  };

  if (!overview.connected) {
    return (
      <p className="mt-2 text-body-sm text-text-3">
        O Caetano planeja, cria e publica seus posts de feed toda semana. Para começar, conecte o
        Instagram em{" "}
        <Link to="/perfil" className="underline">
          Perfil
        </Link>
        .
      </p>
    );
  }

  if (!overview.enabled) {
    return (
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-body-sm text-text-3">
          Desligado. Quando ligado, o Caetano planeja a semana, cria cada post um dia antes e te
          pede aprovação antes de publicar.
        </p>
        <Button size="sm" disabled={busy} onClick={() => toggle(true)}>
          Ligar
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
      <p className="text-body-sm text-text-3">
        <span className="text-text">Ligado</span> · {overview.cadenceSummary} ·{" "}
        {overview.approval === "required" ? "com aprovação" : "publica sem pedir aprovação"}
      </p>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(false)}>
        Pausar
      </Button>
    </div>
  );
}

function Section({
  title,
  slots,
  children,
}: {
  title: string;
  slots: readonly AutopilotSlotView[];
  children: (slot: AutopilotSlotView) => React.ReactNode;
}) {
  if (slots.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-note font-medium text-text-3">{title}</h2>
      <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
        {slots.map(children)}
      </ul>
    </section>
  );
}

/** "fica pronto qua 18h" for a planned post, the status otherwise. */
const rowNote = (slot: AutopilotSlotView): string | null => {
  if (slot.status === "planned")
    return `fica pronto ${publishLabel(slot.scheduledFor - PRODUCE_AHEAD_MS)}`;

  if (slot.status === "published" && slot.results?.reach !== undefined)
    return `${slot.results.reach.toLocaleString("pt-BR")} de alcance`;

  return null;
};

function Row({
  slot,
  onOpen,
  children,
}: {
  slot: AutopilotSlotView;
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  const status = SLOT_STATUS[slot.status];
  const note = rowNote(slot);

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-3 py-2.5",
        slot.status === "skipped" && "opacity-55",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Ver o post de ${slotWhen(slot)}`}
      >
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-inset">
          {slot.coverUrl ? (
            <img src={slot.coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <ImageOff className="size-4 text-text-5" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body-sm font-medium text-text">
            {slotWhen(slot)} · {formatLabel(slot)}
          </span>
          <span className="block truncate text-note text-text-3">“{slot.hook}”</span>
        </span>
        <span className="hidden shrink-0 text-right sm:block">
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
          {note ? <span className="mt-1 block text-micro text-text-4">{note}</span> : null}
        </span>
      </button>
      {children}
    </li>
  );
}

function ApproveButton({
  accountId,
  slotId,
}: {
  accountId: Id<"accounts">;
  slotId: Id<"autopilotSlots">;
}) {
  const approveSlot = useMutation(api.autopilot.approveSlot);
  const [busy, setBusy] = useState(false);

  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        approveSlot({ accountId, slotId })
          .catch(showErrorToast)
          .finally(() => setBusy(false));
      }}
    >
      <Check /> Aprovar
    </Button>
  );
}
