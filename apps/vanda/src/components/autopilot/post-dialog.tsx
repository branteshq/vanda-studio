import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ImageOff,
  MessageCircle,
  RefreshCw,
  SkipForward,
  Undo2,
} from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@vanda-studio/ui/components/dialog";
import { Spinner } from "@vanda-studio/ui/components/spinner";
import { StatusPill } from "@vanda-studio/ui/components/status-pill";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { AutopilotSlotView } from "../../convex/autopilotData";
import { PRODUCE_AHEAD_LABEL, PRODUCE_AHEAD_MS } from "../../convex/autopilotModel";
import { showErrorToast } from "../error-feedback";
import { changeDraft, formatLabel, publishLabel, slotStatus } from "./format";

/**
 * One automatic post: its slides, caption and the one-tap decisions (approve,
 * skip, restore, make it again). Anything else is a conversation: "Mudar na
 * conversa" opens Vanda with the post named, and she changes it with her tools.
 */

const run = (action: () => Promise<void>, after: () => void) => {
  action().then(after, showErrorToast);
};

/** Big slide with arrows and thumbnails below, the way a carousel reads on Instagram. */
function Slides({
  urls,
  index,
  onIndex,
  empty,
}: {
  urls: readonly string[];
  index: number;
  onIndex: (index: number) => void;
  /** Shown in place of the slides before they exist. */
  empty: ReactNode;
}) {
  const url = urls[index];

  return (
    <div className="grid content-start gap-2">
      <div className="relative overflow-hidden rounded-lg bg-inset">
        {url ? (
          <img src={url} alt={`Imagem ${index + 1}`} className="aspect-4/5 w-full object-cover" />
        ) : (
          <div className="flex aspect-4/5 w-full flex-col items-center justify-center gap-2 p-6 text-center">
            {empty}
          </div>
        )}
        {urls.length > 1 ? (
          <>
            <Button
              size="icon-sm"
              variant="secondary"
              aria-label="Imagem anterior"
              className="absolute top-1/2 left-2 -translate-y-1/2"
              disabled={index === 0}
              onClick={() => onIndex(index - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon-sm"
              variant="secondary"
              aria-label="Próxima imagem"
              className="absolute top-1/2 right-2 -translate-y-1/2"
              disabled={index === urls.length - 1}
              onClick={() => onIndex(index + 1)}
            >
              <ChevronRight />
            </Button>
            <span className="absolute top-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-micro text-white">
              {index + 1}/{urls.length}
            </span>
          </>
        ) : null}
      </div>
      {urls.length > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto">
          {urls.map((thumb, thumbIndex) => (
            <button
              key={thumb}
              type="button"
              aria-label={`Ver imagem ${thumbIndex + 1}`}
              aria-current={thumbIndex === index}
              onClick={() => onIndex(thumbIndex)}
              className={cn(
                "w-12 shrink-0 overflow-hidden rounded-sm border-2",
                thumbIndex === index ? "border-brand-accent" : "border-transparent opacity-70",
              )}
            >
              <img src={thumb} alt="" className="aspect-4/5 w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AutopilotPostDialog({
  accountId,
  slot,
  onClose,
}: {
  accountId: Id<"accounts">;
  slot: AutopilotSlotView | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const approveSlot = useMutation(api.autopilot.approveSlot);
  const skipSlot = useMutation(api.autopilot.skipSlot);
  const restoreSlot = useMutation(api.autopilot.restoreSlot);
  const regenerateSlot = useMutation(api.autopilot.regenerateSlot);
  const [index, setIndex] = useState(0);

  if (!slot) return null;

  const status = slotStatus(slot);
  const urls = slot.imageUrls.length > 0 ? slot.imageUrls : slot.coverUrl ? [slot.coverUrl] : [];
  const current = Math.min(index, Math.max(0, urls.length - 1));
  // Paused posts wait for Caetano to be woken: nothing to approve, skip or restore here.
  const open = slot.status !== "published" && !slot.paused;
  const generating = slot.status === "generating";
  const canGenerate = open && !generating && slot.status !== "skipped";
  const ids = { accountId, slotId: slot.slotId };

  const generate = () =>
    run(
      async () => {
        await regenerateSlot(ids);
      },
      () => undefined,
    );

  const empty = slot.paused ? (
    <>
      <ImageOff className="size-6 text-text-5" aria-hidden="true" />
      <span className="text-note text-text-3">Será criado quando o Caetano acordar</span>
    </>
  ) : generating ? (
    <>
      <Spinner />
      <span className="text-note text-text-3">Criando as imagens…</span>
    </>
  ) : (
    <>
      <ImageOff className="size-6 text-text-5" aria-hidden="true" />
      <span className="text-note text-text-3">
        {slot.status === "failed" ? "Não deu para criar" : "Ainda sem imagens"}
      </span>
      <span className="text-micro text-text-5">
        Fica pronto cerca de {PRODUCE_AHEAD_LABEL} antes ·{" "}
        {publishLabel(slot.scheduledFor - PRODUCE_AHEAD_MS)}
      </span>
      {canGenerate ? (
        <Button size="sm" onClick={generate}>
          <RefreshCw /> Criar agora
        </Button>
      ) : null}
    </>
  );

  const change = () => {
    onClose();
    void navigate({ to: "/conversa", search: { rascunho: changeDraft(slot) } });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-dvh max-w-3xl overflow-y-auto">
        <div className="grid gap-5 sm:grid-cols-2">
          <Slides urls={urls} index={current} onIndex={setIndex} empty={empty} />
          <div className="grid content-start gap-4">
            <div className="grid gap-1.5 pr-6">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>{publishLabel(slot.scheduledFor)}</DialogTitle>
                <StatusPill tone={status.tone}>{status.label}</StatusPill>
              </div>
              <span className="text-micro text-text-4">
                {formatLabel(slot)} · {slot.purposeLabel}
              </span>
            </div>
            <p className="text-body font-medium text-text">“{slot.hook}”</p>
            {slot.caption ? (
              <p className="max-h-48 overflow-y-auto text-note whitespace-pre-line text-text-3">
                {slot.caption}
              </p>
            ) : null}
            {slot.revisionNote && (slot.status === "planned" || generating) ? (
              <p className="rounded-md bg-inset px-3 py-2 text-micro text-text-3">
                Refazendo: “{slot.revisionNote}”
              </p>
            ) : null}
            {slot.paused ? (
              <p className="rounded-md bg-inset px-3 py-2 text-note text-text-2">
                Os posts automáticos estão pausados. Acorde o Caetano no topo do Calendário para
                retomar: este post volta sozinho.
              </p>
            ) : null}
            {slot.lastError && slot.status !== "published" && !slot.paused ? (
              <p className="rounded-md border border-needs-border bg-needs-bg px-3 py-2 text-micro text-text-2">
                {slot.lastError}
              </p>
            ) : null}
            {open ? (
              <div className="flex flex-wrap gap-2">
                {slot.status === "awaiting_approval" ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        await approveSlot(ids);
                      }, onClose)
                    }
                  >
                    <Check /> Aprovar
                  </Button>
                ) : null}
                {slot.status === "skipped" ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        await restoreSlot(ids);
                      }, onClose)
                    }
                  >
                    <Undo2 /> Reativar
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={change}>
                  <MessageCircle /> Mudar na conversa
                </Button>
                {canGenerate && urls.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={generate}>
                    <RefreshCw /> Criar de novo
                  </Button>
                ) : null}
                {slot.status !== "skipped" && !generating ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(async () => {
                        await skipSlot(ids);
                      }, onClose)
                    }
                  >
                    <SkipForward /> Pular
                  </Button>
                ) : null}
              </div>
            ) : slot.permalink ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => window.open(slot.permalink!, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink /> Ver no Instagram
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The dialog for a post known only by id (Calendário, the posts rail). */
export function AutopilotPostDialogById({
  accountId,
  slotId,
  onClose,
}: {
  accountId: Id<"accounts">;
  slotId: Id<"autopilotSlots"> | null;
  onClose: () => void;
}) {
  const slot = useQuery(api.autopilot.slot, slotId ? { accountId, slotId } : "skip");

  return (
    <AutopilotPostDialog
      key={slot?.slotId ?? "none"}
      accountId={accountId}
      slot={slotId ? (slot ?? null) : null}
      onClose={onClose}
    />
  );
}
