import { useState } from "react";
import { useMutation } from "convex/react";
import { ExternalLink, RefreshCw, SkipForward, Undo2 } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@vanda-studio/ui/components/dialog";
import { Input } from "@vanda-studio/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vanda-studio/ui/components/select";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { AutopilotSlotView } from "../../convex/autopilotData";
import { purposeLabels } from "../../convex/pipeline/autopilot";
import { postPurposes, type PostPurpose } from "../../convex/postPurposes";
import { showErrorToast } from "../error-feedback";
import { SLOT_STATUS, WEEKDAY_NAMES, hourLabel, slidesLabel } from "./week-strip";

/**
 * Edit one autopilot post: when, what and how it looks, or veto it. The same
 * mutations back Vanda and Caetano's autopilot tools.
 */

const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

interface Draft {
  weekday: number;
  time: string;
  type: "image" | "carousel";
  slideCount: number;
  purpose: PostPurpose;
  theme: string;
  angle: string;
  hook: string;
  captionBrief: string;
}

const draftOf = (slot: AutopilotSlotView): Draft => ({
  weekday: slot.weekday,
  time: slot.time,
  type: slot.type,
  slideCount: slot.slideCount,
  purpose: slot.purpose,
  theme: slot.theme,
  angle: slot.angle,
  hook: slot.hook,
  captionBrief: slot.captionBrief,
});

const publishLabel = (scheduledFor: number) =>
  new Date(scheduledFor).toLocaleString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

/** Only the fields the owner actually changed, so the server can tell a re-time from a re-brief. */
const changed = (slot: AutopilotSlotView, draft: Draft): Partial<Draft> => {
  const original = draftOf(slot);
  const result: Partial<Draft> = {};

  if (draft.weekday !== original.weekday) result.weekday = draft.weekday;

  if (draft.time !== original.time) result.time = draft.time;

  if (draft.type !== original.type) result.type = draft.type;

  if (draft.slideCount !== original.slideCount) result.slideCount = draft.slideCount;

  if (draft.purpose !== original.purpose) result.purpose = draft.purpose;

  if (draft.theme !== original.theme) result.theme = draft.theme;

  if (draft.angle !== original.angle) result.angle = draft.angle;

  if (draft.hook !== original.hook) result.hook = draft.hook;

  if (draft.captionBrief !== original.captionBrief) result.captionBrief = draft.captionBrief;

  return result;
};

const descriptionOf = (slot: AutopilotSlotView): string => {
  if (slot.status === "published") return "Publicado. O resultado aparece aqui depois de 48 horas.";

  if (slot.status === "skipped") return "Pulado: este post não será publicado.";

  return `Publica automaticamente ${publishLabel(slot.scheduledFor)}. Edite ou pule até lá.`;
};

const purposeOf = (value: string | null): PostPurpose | undefined =>
  postPurposes.find((purpose) => purpose === value);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-caption font-medium text-text-3">{label}</span>
      {children}
    </label>
  );
}

export function SlotEditor({
  accountId,
  slot,
  onClose,
}: {
  accountId: Id<"accounts">;
  slot: AutopilotSlotView | null;
  onClose: () => void;
}) {
  const updateSlot = useMutation(api.autopilot.updateSlot);
  const skipSlot = useMutation(api.autopilot.skipSlot);
  const restoreSlot = useMutation(api.autopilot.restoreSlot);
  const regenerateSlot = useMutation(api.autopilot.regenerateSlot);
  // The page remounts the editor per slot (key), so the draft starts from the slot.
  const [draft, setDraft] = useState<Draft | null>(slot ? draftOf(slot) : null);
  const [busy, setBusy] = useState(false);

  if (!slot || !draft) return null;

  const locked = slot.status === "published" || slot.status === "generating";
  const status = SLOT_STATUS[slot.status];
  const pending = changed(slot, draft);
  const dirty = Object.keys(pending).length > 0;

  const run = async (action: () => Promise<void>, close = true) => {
    setBusy(true);

    try {
      await action();

      if (close) onClose();
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-dvh max-w-lg overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-6">
            <DialogTitle>
              {WEEKDAY_NAMES[slot.weekday]} {hourLabel(slot.time)} · {slidesLabel(slot.slideCount)}
            </DialogTitle>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </div>
          <DialogDescription>{descriptionOf(slot)}</DialogDescription>
        </DialogHeader>

        {slot.coverUrl ? (
          <div className="flex gap-3">
            <img
              src={slot.coverUrl}
              alt="Capa do post"
              className="aspect-4/5 w-24 shrink-0 rounded-md bg-inset object-cover"
            />
            <p className="line-clamp-6 text-note whitespace-pre-line text-text-3">{slot.caption}</p>
          </div>
        ) : null}

        {slot.lastError && slot.status !== "published" ? (
          <p className="rounded-md border border-needs-border bg-needs-bg px-3 py-2 text-note text-text-2">
            {slot.lastError}
          </p>
        ) : null}

        <fieldset disabled={locked || busy} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dia">
              <Select
                value={String(draft.weekday)}
                onValueChange={(value) => set("weekday", Number(value))}
              >
                <SelectTrigger aria-label="Dia">
                  <SelectValue>{(value) => WEEKDAY_NAMES[Number(value)]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MONDAY_FIRST.map((weekday) => (
                    <SelectItem key={weekday} value={String(weekday)}>
                      {WEEKDAY_NAMES[weekday]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Horário">
              <Input
                type="time"
                value={draft.time}
                onChange={(event) => set("time", event.target.value)}
              />
            </Field>
            <Field label="Formato">
              <Select
                value={draft.type}
                onValueChange={(value) => {
                  const type = value === "carousel" ? "carousel" : "image";

                  set("type", type);
                  set("slideCount", type === "image" ? 1 : Math.max(2, draft.slideCount));
                }}
              >
                <SelectTrigger aria-label="Formato">
                  <SelectValue>
                    {(value) => (value === "carousel" ? "Carrossel" : "Imagem")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Imagem</SelectItem>
                  <SelectItem value="carousel">Carrossel</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Slides">
              <Input
                type="number"
                min={draft.type === "image" ? 1 : 2}
                max={draft.type === "image" ? 1 : 10}
                value={draft.slideCount}
                disabled={draft.type === "image"}
                onChange={(event) =>
                  set("slideCount", Math.min(10, Math.max(2, Number(event.target.value) || 2)))
                }
              />
            </Field>
          </div>
          <Field label="Propósito">
            <Select
              value={draft.purpose}
              onValueChange={(value) => {
                const purpose = purposeOf(value);

                if (purpose) set("purpose", purpose);
              }}
            >
              <SelectTrigger aria-label="Propósito">
                <SelectValue>
                  {(value: string | null) => {
                    const purpose = purposeOf(value);

                    return purpose ? purposeLabels[purpose] : null;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {postPurposes.map((purpose) => (
                  <SelectItem key={purpose} value={purpose}>
                    {purposeLabels[purpose]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Gancho da capa">
            <Input value={draft.hook} onChange={(event) => set("hook", event.target.value)} />
          </Field>
          <Field label="Tema">
            <Input value={draft.theme} onChange={(event) => set("theme", event.target.value)} />
          </Field>
          <Field label="Ângulo">
            <Input value={draft.angle} onChange={(event) => set("angle", event.target.value)} />
          </Field>
          <Field label="O que a legenda deve dizer">
            <textarea
              rows={3}
              value={draft.captionBrief}
              onChange={(event) => set("captionBrief", event.target.value)}
              className="w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </Field>
          {slot.postId && dirty ? (
            <p className="text-note text-text-4">
              Mudar o conteúdo gera o post de novo. Mudar só o horário mantém o post pronto.
            </p>
          ) : null}
        </fieldset>

        <DialogFooter>
          <div className="mr-auto flex flex-wrap gap-2">
            {slot.status === "skipped" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await restoreSlot({ accountId, slotId: slot.slotId });
                  })
                }
              >
                <Undo2 /> Reativar
              </Button>
            ) : !locked ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await skipSlot({ accountId, slotId: slot.slotId });
                  })
                }
              >
                <SkipForward /> Pular
              </Button>
            ) : null}
            {!locked && slot.status !== "skipped" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await regenerateSlot({ accountId, slotId: slot.slotId });
                  })
                }
              >
                <RefreshCw /> Gerar agora
              </Button>
            ) : null}
            {slot.permalink ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(slot.permalink!, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink /> Ver no Instagram
              </Button>
            ) : null}
          </div>
          <Button
            size="sm"
            disabled={!dirty || locked || busy}
            onClick={() =>
              void run(async () => {
                await updateSlot({ accountId, slotId: slot.slotId, change: pending });
              })
            }
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
