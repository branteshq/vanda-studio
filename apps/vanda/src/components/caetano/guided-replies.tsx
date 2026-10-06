import {
  CalendarRange,
  Check,
  Lightbulb,
  Power,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { AutopilotOverview, AutopilotSlotView } from "../../convex/autopilotData";
import { PURPOSE_GROUPS } from "../autopilot/visuals";
import { WEEKDAY_NAMES, hourLabel } from "../autopilot/week-strip";

/**
 * The guided path through Caetano's work: chips computed from the current
 * state. Each one is a message to Caetano ("send") or a sentence for the owner
 * to finish ("prefill") — Caetano does the work with his tools and settings.
 */

export interface GuidedReply {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly tone?: "primary" | "needs";
  /** Sent as-is to Caetano. */
  readonly send?: string;
  /** Put in the composer for the owner to complete (a rejection needs a reason). */
  readonly prefill?: string;
  /** A local action (leaving the post focus). */
  readonly action?: () => void;
}

/**
 * Ids and setting names for Caetano, hidden from the owner's bubble (the chat
 * strips <caetano_ref>) so the guided message reads naturally.
 */
export const ref = (text: string) => ` <caetano_ref>${text}</caetano_ref>`;

const when = (slot: { weekday: number; time: string }) =>
  `${WEEKDAY_NAMES[slot.weekday]?.toLowerCase() ?? ""} ${hourLabel(slot.time)}`;

const DAY = 86_400_000;

const MAX_REPLIES = 4;

/** A candidate suggestion and how urgent it is given the planning right now. */
interface Candidate extends GuidedReply {
  readonly priority: number;
}

/**
 * Suggestions derived from the client's planning, most urgent first: each
 * signal (a post to approve, a failure, an empty week, a stale diagnosis, a
 * lopsided content mix…) proposes its own next step, and only the top few
 * are shown. Nothing is a fixed menu.
 */
export const guidedReplies = (overview: AutopilotOverview, now = Date.now()): GuidedReply[] => {
  const candidates: Candidate[] = [];
  const add = (candidate: Candidate) => candidates.push(candidate);

  if (!overview.connected) {
    add({
      key: "connect",
      label: "Conectar o Instagram",
      icon: Lightbulb,
      tone: "primary",
      priority: 100,
      send: "Como conecto o Instagram do negócio para você cuidar dos posts automáticos?",
    });

    return candidates;
  }

  const audit = overview.audit;
  const auditAge = audit ? now - audit.createdAt : Infinity;

  if (!overview.enabled) {
    add({
      key: "enable",
      label: "Assuma meus posts",
      icon: Power,
      tone: "primary",
      priority: 100,
      send: `Assuma os meus posts automáticos.${ref("settings_set autopilot.enabled = ligado")}`,
    });

    if (!audit)
      add({
        key: "audit",
        label: "Analise minha conta",
        icon: Sparkles,
        priority: 80,
        send: "Analise a minha conta do Instagram e me diga do que ela precisa.",
      });

    return candidates.toSorted((x, y) => y.priority - x.priority).slice(0, MAX_REPLIES);
  }

  const slots = overview.weeks.flatMap((week) => week.slots);
  const upcoming = slots.filter((slot) => slot.scheduledFor > now);

  // 1. The owner is the bottleneck: the nearest post waiting for approval.
  const waiting = upcoming
    .filter((slot) => slot.status === "awaiting_approval")
    .toSorted((x, y) => x.scheduledFor - y.scheduledFor)[0];

  if (waiting) {
    add({
      key: `approve-${waiting.slotId}`,
      label: `Aprovar ${when(waiting)}`,
      icon: Check,
      tone: "primary",
      priority: 95,
      send: `Aprovo o post de ${when(waiting)} (“${waiting.hook}”).${ref(`slotId ${waiting.slotId}`)}`,
    });
    add({
      key: `reject-${waiting.slotId}`,
      label: `Recusar ${when(waiting)}`,
      icon: X,
      tone: "needs",
      priority: 94,
      prefill: `Recuso o post de ${when(waiting)} (“${waiting.hook}”) porque `,
    });
  }

  // 2. Something broke and still has time to be fixed.
  const failed = upcoming.find((slot) => slot.status === "failed");

  if (failed) {
    add({
      key: `retry-${failed.slotId}`,
      label: `Refazer ${when(failed)}`,
      icon: RefreshCw,
      tone: "needs",
      priority: 90,
      send: `O post de ${when(failed)} falhou. Refaça.${ref(`slotId ${failed.slotId} — autopilot_regenerate_slot`)}`,
    });
  }

  // 3. Nothing planned ahead: the next week is empty.
  const nextWeek = overview.weeks[1];

  // Not while Caetano is already planning it.
  if (nextWeek && nextWeek.slots.length === 0 && nextWeek.status !== "planning") {
    add({
      key: "plan-next",
      label: "Planejar a próxima semana",
      icon: CalendarRange,
      priority: 80,
      send: `Planeje os posts da próxima semana.${ref("autopilot_reanalyze")}`,
    });
  }

  // 4. The diagnosis is missing or old; one built on too little data is worth redoing
  // once more posts exist, not every hour (a day apart at least).
  const thin = audit?.confidence === "baixa" && auditAge > DAY;

  if (!overview.auditRunning && (!audit || auditAge > 7 * DAY || thin)) {
    add({
      key: "reanalyze",
      label: audit ? "Reanalisar a conta" : "Analisar a conta",
      icon: RefreshCw,
      priority: audit ? 50 : 75,
      send: `Reanalise a minha conta e replaneje os posts que ainda não foram criados.${ref("autopilot_reanalyze")}`,
    });
  }

  // 5. The profile itself holds the account back.
  if (
    audit?.profileScore !== null &&
    audit?.profileScore !== undefined &&
    audit.profileScore < 50
  ) {
    add({
      key: "profile",
      label: "Como melhorar meu perfil?",
      icon: Lightbulb,
      priority: 60,
      send: "Quais são as 3 mudanças no meu perfil do Instagram que mais aumentariam a nota?",
    });
  }

  // 6. The week's content mix leaves a job undone.
  const planned = (overview.weeks[0]?.slots ?? []).filter((slot) => slot.status !== "skipped");

  const missing = PURPOSE_GROUPS.find(
    (group) =>
      planned.length >= 3 && !planned.some((slot) => group.purposes.includes(slot.purpose)),
  );

  if (missing) {
    add({
      key: `mix-${missing.key}`,
      label: `Incluir “${missing.label}”`,
      icon: SlidersHorizontal,
      priority: 40,
      send: `A semana não tem nenhum post de “${missing.label}”. Inclua um nos próximos posts ainda não criados.`,
    });
  }

  // 7. Publishing without approval while the owner keeps refusing.
  const { approved, rejected } = overview.feedbackStats;

  if (overview.approval === "auto" && rejected > approved && rejected >= 2) {
    add({
      key: "require-approval",
      label: "Pedir meu aceite",
      icon: ShieldCheck,
      priority: 70,
      send: `Quero aprovar cada post antes de publicar.${ref("settings_set autopilot.approval = pedir aceite")}`,
    });
  }

  // 8. Lessons exist: show what shapes the next posts (they live in the brand file).
  if (overview.learned.length > 0) {
    add({
      key: "learned",
      label: `O que você aprendeu? (${overview.learned.length})`,
      icon: Lightbulb,
      priority: 30,
      send: "O que você já aprendeu sobre o meu gosto? Está no arquivo da marca.",
    });
  }

  // 9. The cadence is changed by talking: keep the door visible when nothing is urgent.
  add({
    key: "cadence",
    label: "Mudar a cadência",
    icon: SlidersHorizontal,
    priority: 10,
    prefill: "Quero mudar a cadência dos posts automáticos para ",
  });

  // 10. The next post coming up.
  const next = upcoming
    .filter((slot) => slot.status === "scheduled" || slot.status === "planned")
    .toSorted((x, y) => x.scheduledFor - y.scheduledFor)[0];

  if (next) {
    add({
      key: `next-${next.slotId}`,
      label: `Próximo: ${when(next)}`,
      icon: CalendarRange,
      priority: 20,
      send: `Me mostre o próximo post, de ${when(next)} (“${next.hook}”).${ref(`slotId ${next.slotId}`)}`,
    });
  }

  return candidates.toSorted((x, y) => y.priority - x.priority).slice(0, MAX_REPLIES);
};

/**
 * While a post is in focus the suggestions are about that post only: what
 * didn't work (the reason Caetano needs), approving it, moving it, changing
 * its purpose, redoing it — or leaving the focus.
 */
export const focusReplies = (
  slot: AutopilotSlotView | undefined,
  leaveFocus: () => void,
): GuidedReply[] => [
  {
    key: "dislike",
    label: "O que não gostei…",
    icon: X,
    tone: "needs",
    prefill: "Não gostei de ",
  },
  ...(slot?.status === "awaiting_approval"
    ? [
        {
          key: "approve",
          label: "Aprovar",
          icon: Check,
          tone: "primary" as const,
          send: "Aprovo este post.",
        },
      ]
    : []),
  {
    key: "time",
    label: "Mudar dia ou horário…",
    icon: CalendarRange,
    prefill: "Mude este post para ",
  },
  {
    key: "purpose",
    label: "Mudar o propósito…",
    icon: SlidersHorizontal,
    prefill: "Troque o propósito deste post para ",
  },
  {
    key: "redo",
    label: "Refazer",
    icon: RefreshCw,
    send: "Refaça este post do zero.",
  },
  {
    key: "leave",
    label: "Sair do foco",
    icon: Power,
    action: leaveFocus,
  },
];

const TONE_CLASS = {
  primary: "border-brand-accent/40 bg-creating-bg text-brand-accent hover:brightness-110",
  needs: "border-needs-border bg-needs-bg text-text-2 hover:border-border-strong",
  default: "border-border bg-surface text-text-2 hover:border-border-strong hover:bg-inset",
} as const;

export function GuidedReplies({
  replies,
  disabled,
  onSend,
  onPrefill,
}: {
  replies: readonly GuidedReply[];
  disabled: boolean;
  onSend: (text: string) => void;
  onPrefill: (text: string) => void;
}) {
  if (replies.length === 0) return null;

  return (
    <div className="px-4 pb-2 md:px-6">
      <div
        role="group"
        aria-label="Sugestões para o Caetano"
        className="mx-auto flex w-full max-w-3xl gap-1.5 overflow-x-auto md:flex-wrap"
      >
        {replies.map((reply) => {
          const Icon = reply.icon;

          return (
            <button
              key={reply.key}
              type="button"
              disabled={disabled && reply.send !== undefined}
              onClick={() => {
                if (reply.action) reply.action();
                else if (reply.send) onSend(reply.send);
                else if (reply.prefill) onPrefill(reply.prefill);
              }}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-note font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
                TONE_CLASS[reply.tone ?? "default"],
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {reply.label}
              {reply.prefill ? <span className="text-text-5">…</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
