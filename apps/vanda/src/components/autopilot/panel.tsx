import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { Check, ImageOff } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Toggle } from "@vanda-studio/ui/components/toggle";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { AutopilotOverview, AutopilotSlotView } from "../../convex/autopilotData";
import { showErrorToast } from "../error-feedback";
import { formatLabel, slotWhen } from "./format";

/** What Vanda gets when the owner wants to change the days and times. */
const CADENCE_DRAFT = "Quero mudar os dias e horários dos posts automáticos: ";

/**
 * Posts automáticos at the top of the Calendário: the two switches, the
 * cadence as a sentence, and the posts waiting for the owner. Every switch is
 * the same setting the agents change with settings_set, so asking in the
 * conversation and tapping here always agree.
 */
export function AutopilotPanel({
  accountId,
  onOpen,
}: {
  accountId: Id<"accounts">;
  onOpen: (slotId: Id<"autopilotSlots">) => void;
}) {
  const overview = useQuery(api.autopilot.overview, { accountId });

  if (overview === undefined) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      {overview.enabled ? (
        <Enabled accountId={accountId} overview={overview} onOpen={onOpen} />
      ) : (
        <Disabled overview={overview} />
      )}
    </section>
  );
}

function useSetting<Args, Result>(run: (args: Args) => Promise<Result>) {
  const [busy, setBusy] = useState(false);

  const apply = (args: Args) => {
    setBusy(true);
    run(args)
      .catch(showErrorToast)
      .finally(() => setBusy(false));
  };

  return { busy, apply };
}

function Disabled({ overview }: { overview: AutopilotOverview }) {
  const enabled = useSetting(useMutation(api.autopilot.setEnabled));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-body-sm font-semibold">Posts automáticos</h2>
        <p className="text-note text-text-3">
          {overview.connected ? (
            "O Caetano pode planejar, criar e publicar seus posts toda semana, com a sua aprovação."
          ) : (
            <>
              O Caetano pode cuidar dos seus posts toda semana. Para isso, conecte o Instagram em{" "}
              <Link to="/perfil" className="underline">
                Perfil
              </Link>
              .
            </>
          )}
        </p>
      </div>
      {overview.connected ? (
        <Button size="sm" disabled={enabled.busy} onClick={() => enabled.apply({ enabled: true })}>
          Ligar
        </Button>
      ) : null}
    </div>
  );
}

function Enabled({
  accountId,
  overview,
  onOpen,
}: {
  accountId: Id<"accounts">;
  overview: AutopilotOverview;
  onOpen: (slotId: Id<"autopilotSlots">) => void;
}) {
  const enabled = useSetting(useMutation(api.autopilot.setEnabled));
  const approval = useSetting(useMutation(api.autopilot.setApproval));
  const now = Date.now();

  const waiting = overview.weeks
    .flatMap((week) => week.slots)
    .filter((slot) => slot.status === "awaiting_approval" && slot.scheduledFor > now)
    .toSorted((a, b) => a.scheduledFor - b.scheduledFor);

  const planning =
    overview.auditRunning || overview.weeks.some((week) => week.status === "planning");

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2.5">
          <Toggle
            checked
            disabled={enabled.busy}
            onCheckedChange={(checked) => enabled.apply({ enabled: checked })}
            aria-label="Posts automáticos"
          />
          <span className="text-body-sm font-semibold">Posts automáticos</span>
        </label>
        <label className="flex items-center gap-2.5">
          <Toggle
            checked={overview.approval === "required"}
            disabled={approval.busy}
            onCheckedChange={(checked) => approval.apply({ required: checked })}
            aria-label="Pedir minha aprovação"
          />
          <span className="text-body-sm text-text-2">Pedir minha aprovação</span>
        </label>
      </div>
      <p className="mt-2 text-note text-text-3">
        {overview.cadenceSummary}.{" "}
        <Link to="/conversa" search={{ rascunho: CADENCE_DRAFT }} className="underline">
          Mudar dias e horários
        </Link>
        {planning ? " · O Caetano está planejando a semana." : null}
      </p>
      {waiting.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-note font-medium text-text-3">Precisa da sua aprovação</h3>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-app">
            {waiting.map((slot) => (
              <Waiting
                key={slot.slotId}
                accountId={accountId}
                slot={slot}
                onOpen={() => onOpen(slot.slotId)}
              />
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-micro text-text-4">
        Tudo aqui também muda pedindo na conversa, à Vanda ou ao Caetano no WhatsApp.
      </p>
    </>
  );
}

function Waiting({
  accountId,
  slot,
  onOpen,
}: {
  accountId: Id<"accounts">;
  slot: AutopilotSlotView;
  onOpen: () => void;
}) {
  const approve = useSetting(useMutation(api.autopilot.approveSlot));

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={`Ver o post de ${slotWhen(slot)}`}
      >
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-inset">
          {slot.coverUrl ? (
            <img src={slot.coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <ImageOff className="size-4 text-text-5" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body-sm font-medium">
            {slotWhen(slot)} · {formatLabel(slot)}
          </span>
          <span className="block truncate text-note text-text-3">“{slot.hook}”</span>
        </span>
      </button>
      <Button
        size="sm"
        disabled={approve.busy}
        onClick={() => approve.apply({ accountId, slotId: slot.slotId })}
      >
        <Check /> Aprovar
      </Button>
    </li>
  );
}
