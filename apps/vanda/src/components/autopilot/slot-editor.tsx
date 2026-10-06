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
import type { PostFocus } from "../caetano/caetano-chat";
import { showErrorToast } from "../error-feedback";
import { SlidePips, purposeGroupOf } from "./visuals";
import { SLOT_STATUS, WEEKDAY_NAMES, hourLabel } from "./week-strip";

/**
 * A post Caetano made, as a viewer: every slide, the caption and the plan
 * behind it. Changes are a conversation — "Falar com o Caetano" hands the post
 * (or one slide) to his chat, which stays on it. Only one-tap actions act
 * here: approve, skip, restore, and generate (now, or again).
 */

export const focusFor = (slot: AutopilotSlotView, slide?: number): PostFocus => ({
  slotId: slot.slotId,
  label: `${WEEKDAY_NAMES[slot.weekday]} ${hourLabel(slot.time)} · “${slot.hook}”`,
  slide,
  slideCount: Math.max(slot.imageUrls.length, slot.slideCount),
  imageUrl: slot.imageUrls[(slide ?? 1) - 1] ?? slot.coverUrl,
});

const publishLabel = (scheduledFor: number) =>
  new Date(scheduledFor).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

const run = (action: () => Promise<void>, after: () => void) => {
  action().then(after, showErrorToast);
};

/** Big slide with arrows, thumbnails below; a carousel reads like on Instagram. */
function Gallery({
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

export function SlotEditor({
  accountId,
  slot,
  onClose,
  onTalk,
}: {
  accountId: Id<"accounts">;
  slot: AutopilotSlotView | null;
  onClose: () => void;
  /** Hand the post to Caetano's chat; without it, open Posts automáticos focused on it. */
  onTalk?: ((focus: PostFocus) => void) | undefined;
}) {
  const navigate = useNavigate();
  const approveSlot = useMutation(api.autopilot.approveSlot);
  const skipSlot = useMutation(api.autopilot.skipSlot);
  const restoreSlot = useMutation(api.autopilot.restoreSlot);
  const regenerateSlot = useMutation(api.autopilot.regenerateSlot);
  const [index, setIndex] = useState(0);

  if (!slot) return null;

  const status = SLOT_STATUS[slot.status];
  const group = purposeGroupOf(slot.purpose);
  const GroupIcon = group.icon;
  const urls = slot.imageUrls.length > 0 ? slot.imageUrls : slot.coverUrl ? [slot.coverUrl] : [];
  const current = Math.min(index, Math.max(0, urls.length - 1));
  const open = slot.status !== "published";
  const generating = slot.status === "generating";
  const canGenerate = open && !generating && slot.status !== "skipped";

  const generate = () =>
    run(
      async () => {
        await regenerateSlot({ accountId, slotId: slot.slotId });
      },
      () => undefined,
    );

  const empty = generating ? (
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
        Criadas cerca de {PRODUCE_AHEAD_LABEL} antes ·{" "}
        {publishLabel(slot.scheduledFor - PRODUCE_AHEAD_MS)}
      </span>
      {canGenerate ? (
        <Button size="sm" onClick={generate}>
          <RefreshCw /> Gerar agora
        </Button>
      ) : null}
    </>
  );

  const talk = (focus: PostFocus) => {
    onClose();

    if (onTalk) {
      onTalk(focus);

      return;
    }

    void navigate({
      to: "/posts-automaticos",
      search: focus.slide ? { foco: focus.slotId, slide: focus.slide } : { foco: focus.slotId },
    });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-dvh max-w-3xl overflow-y-auto">
        <div className="grid gap-5 sm:grid-cols-2">
          <Gallery urls={urls} index={current} onIndex={setIndex} empty={empty} />

          <div className="grid content-start gap-4">
            <div className="grid gap-1.5 pr-6">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>
                  {WEEKDAY_NAMES[slot.weekday]} {hourLabel(slot.time)}
                </DialogTitle>
                <StatusPill tone={status.tone}>{status.label}</StatusPill>
              </div>
              <span className="text-micro text-text-4">{publishLabel(slot.scheduledFor)}</span>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-note text-text-3">
              <span className="inline-flex items-center gap-1.5">
                <GroupIcon className="size-3.5" aria-hidden="true" />
                {slot.purposeLabel}
              </span>
              <SlidePips count={slot.slideCount} type={slot.type} />
            </div>

            <p className="text-body font-medium text-text">“{slot.hook}”</p>

            {slot.caption ? (
              <p className="max-h-40 overflow-y-auto text-note whitespace-pre-line text-text-3">
                {slot.caption}
              </p>
            ) : null}

            {slot.revisionNote && (slot.status === "planned" || slot.status === "generating") ? (
              <p className="rounded-md bg-inset px-3 py-2 text-micro text-text-3">
                Refazendo: “{slot.revisionNote}”
              </p>
            ) : null}

            {slot.lastError && slot.status !== "published" ? (
              <p className="rounded-md border border-needs-border bg-needs-bg px-3 py-2 text-micro text-text-2">
                {slot.lastError}
              </p>
            ) : null}

            <div className="grid gap-2">
              <Button onClick={() => talk(focusFor(slot))}>
                <MessageCircle /> Falar com o Caetano sobre este post
              </Button>
              {urls.length > 1 ? (
                <Button variant="outline" onClick={() => talk(focusFor(slot, current + 1))}>
                  <MessageCircle /> Sobre a imagem {current + 1}
                </Button>
              ) : null}
            </div>

            {open ? (
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                {slot.status === "awaiting_approval" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      run(async () => {
                        await approveSlot({ accountId, slotId: slot.slotId });
                      }, onClose)
                    }
                  >
                    <Check /> Aprovar
                  </Button>
                ) : null}
                {canGenerate && urls.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={generate}>
                    <RefreshCw /> Gerar de novo
                  </Button>
                ) : null}
                {slot.status === "skipped" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(async () => {
                        await restoreSlot({ accountId, slotId: slot.slotId });
                      }, onClose)
                    }
                  >
                    <Undo2 /> Reativar
                  </Button>
                ) : null}
                {slot.status !== "skipped" && slot.status !== "generating" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      run(async () => {
                        await skipSlot({ accountId, slotId: slot.slotId });
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

/** The viewer for a slot known only by id (Calendário, rail, the planning card). */
export function SlotEditorById({
  accountId,
  slotId,
  onClose,
  onTalk,
}: {
  accountId: Id<"accounts">;
  slotId: Id<"autopilotSlots"> | null;
  onClose: () => void;
  onTalk?: ((focus: PostFocus) => void) | undefined;
}) {
  const slot = useQuery(api.autopilot.slot, slotId ? { accountId, slotId } : "skip");

  return (
    <SlotEditor
      key={slot?.slotId ?? "none"}
      accountId={accountId}
      slot={slotId ? (slot ?? null) : null}
      onClose={onClose}
      onTalk={onTalk}
    />
  );
}
