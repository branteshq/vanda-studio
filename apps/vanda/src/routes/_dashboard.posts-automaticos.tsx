import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useQuery } from "convex-helpers/react/cache";
import caetanoWelcomeUrl from "@vanda-studio/ui/assets/caetano/caetano-expression-welcome.png?url";
import { useSidebar } from "@vanda-studio/ui/components/sidebar";
import { cn } from "@vanda-studio/ui/lib/utils";
import { useActiveAccount } from "../components/active-account";
import { SlotEditorById, focusFor } from "../components/autopilot/slot-editor";
import { PlanningPanel } from "../components/caetano/autopilot-panel";
import { PlanningDock } from "../components/caetano/planning-dock";
import {
  CaetanoChat,
  useCaetanoConversation,
  type PostFocus,
} from "../components/caetano/caetano-chat";
import { DetailsSheet } from "../components/caetano/details-sheet";
import { GuidedReplies, focusReplies, guidedReplies } from "../components/caetano/guided-replies";
import { showErrorToast } from "../components/error-feedback";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { AutopilotOverview, AutopilotSlotView } from "../convex/autopilotData";

export const Route = createFileRoute("/_dashboard/posts-automaticos")({
  component: AutomaticPostsPage,
  // Arriving from the Calendário or the post list with a post to talk about.
  validateSearch: z.object({
    foco: z.string().min(1).optional(),
    slide: z.number().int().positive().optional(),
  }),
});

/**
 * Posts automáticos: one guided conversation with Caetano, with his planning
 * laid out inside it as a live card. Everything is clickable — the card and
 * editors act directly — and everything can also be asked of Caetano, who uses
 * the same settings and helpers (writeSetting, autopilotData) through his tools.
 */

const welcomeOf = (overview: AutopilotOverview): string => {
  if (!overview.connected)
    return "Oi! Sou o Caetano. Conecte o Instagram do negócio e eu cuido dos seus posts de feed.";

  if (!overview.enabled)
    return "Oi! Sou o Caetano. Posso cuidar dos seus posts de feed: analiso a conta, planejo a semana, crio cada post e publico com o seu aceite.";

  return "Estou cuidando dos seus posts de feed. Pergunte o que quiser ou peça qualquer mudança.";
};

function AutomaticPostsPage() {
  const { activeAccount } = useActiveAccount();

  const overview = useQuery(
    api.autopilot.overview,
    activeAccount ? { accountId: activeAccount.id } : "skip",
  );

  const conversation = useCaetanoConversation();
  const sidebar = useSidebar();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [openSlot, setOpenSlot] = useState<Id<"autopilotSlots"> | null>(null);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // SAFETY: the id only selects a slot; autopilot.slot checks it belongs to the account.
  const linkedSlotId = search.foco as Id<"autopilotSlots"> | undefined;

  const linkedSlot = useQuery(
    api.autopilot.slot,
    activeAccount && linkedSlotId ? { accountId: activeAccount.id, slotId: linkedSlotId } : "skip",
  );

  /** Lock the chat on a post and open the conversation about it. */
  const talkAbout = (focus: PostFocus) => {
    conversation.setFocus(focus);
    conversation
      .send(
        focus.slide
          ? `Quero falar sobre a imagem ${focus.slide} deste post.`
          : "Quero falar sobre este post.",
        [],
        focus,
      )
      .catch(showErrorToast);
  };

  // A deep link focuses once, then leaves a clean address.
  useEffect(() => {
    if (!linkedSlot) return;

    talkAbout(focusFor(linkedSlot, search.slide));
    void navigate({ search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per linked slot
  }, [linkedSlot?.slotId]);

  if (!activeAccount) return null;

  const focusedSlot = conversation.focus
    ? overview?.weeks
        .flatMap((week) => week.slots)
        .find((slot) => slot.slotId === conversation.focus?.slotId)
    : undefined;

  const ask = (text: string) => {
    conversation.send(text).catch(showErrorToast);
  };

  const draftForCaetano = (text: string) => conversation.setDraft(text);

  /** Refusing asks for the reason: the chat locks on the post with the sentence started. */
  const rejectWithReason = (slot: AutopilotSlotView) => {
    conversation.setFocus(focusFor(slot));
    conversation.setDraft("Recuso este post porque ");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header
        className={cn(
          "flex h-14 shrink-0 items-center gap-3 border-b border-border bg-app px-4 md:px-6",
          // The collapsed sidebar floats its controls over the top-left corner.
          sidebar.state === "collapsed" && "md:pl-36",
        )}
      >
        <span
          className="flex size-7 items-center justify-center overflow-hidden rounded-full bg-brand-accent/12"
          aria-hidden="true"
        >
          <img
            src={caetanoWelcomeUrl}
            alt=""
            className="size-9 max-w-none translate-y-1 object-contain"
          />
        </span>
        <div className="mr-auto grid">
          <h1 className="text-sm font-semibold text-text">Posts automáticos</h1>
          <span className="hidden text-note text-text-4 sm:block">com o Caetano no controle</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <CaetanoChat
          conversation={conversation}
          welcome={overview ? welcomeOf(overview) : "Oi! Sou o Caetano."}
          replies={
            overview ? (
              <GuidedReplies
                replies={
                  conversation.focus
                    ? focusReplies(focusedSlot, () => conversation.setFocus(null))
                    : guidedReplies(overview)
                }
                disabled={conversation.busy}
                onSend={ask}
                onPrefill={draftForCaetano}
              />
            ) : null
          }
          pinned={
            overview ? (
              <PlanningDock overview={overview}>
                <PlanningPanel
                  overview={overview}
                  onOpenSlot={setOpenSlot}
                  onReject={rejectWithReason}
                  onDetails={() => setDetailsOpen(true)}
                />
              </PlanningDock>
            ) : null
          }
        />
      </div>

      <SlotEditorById
        accountId={activeAccount.id}
        slotId={openSlot}
        onClose={() => setOpenSlot(null)}
        onTalk={talkAbout}
      />

      {overview ? (
        <DetailsSheet overview={overview} open={detailsOpen} onOpenChange={setDetailsOpen} />
      ) : null}
    </div>
  );
}
