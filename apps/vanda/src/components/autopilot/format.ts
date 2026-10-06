import type { AutopilotSlotView } from "../../convex/autopilotData";

export const SLOT_STATUS = {
  planned: { label: "Planejado", tone: "suggestion" },
  generating: { label: "Criando", tone: "creating" },
  awaiting_approval: { label: "Aguardando aprovação", tone: "needs" },
  scheduled: { label: "Agendado", tone: "scheduled" },
  published: { label: "Publicado", tone: "done" },
  skipped: { label: "Pulado", tone: "neutral" },
  failed: { label: "Não saiu", tone: "needs" },
} as const satisfies Record<
  AutopilotSlotView["status"],
  {
    label: string;
    tone: "suggestion" | "creating" | "scheduled" | "done" | "neutral" | "needs";
  }
>;

export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

/** "18h" or "18h30". */
export const hourLabel = (time: string): string => {
  const [hh = "0", mm = "00"] = time.split(":");

  return mm === "00" ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
};

/** "Qui 18h", the way the owner talks about a post. */
export const slotWhen = (slot: Pick<AutopilotSlotView, "weekday" | "time">): string =>
  `${WEEKDAY_SHORT[slot.weekday]} ${hourLabel(slot.time)}`;

/** "Qui, 09/10 às 18:00", for the post itself. */
export const publishLabel = (scheduledFor: number): string =>
  new Date(scheduledFor).toLocaleString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

export const formatLabel = (slot: Pick<AutopilotSlotView, "type" | "slideCount">): string =>
  slot.type === "carousel" ? `Carrossel de ${slot.slideCount}` : "Imagem";

/** What to write to Vanda to change a post: she finds it by day, time and hook. */
export const changeDraft = (slot: Pick<AutopilotSlotView, "weekday" | "time" | "hook">): string =>
  `Sobre o post automático de ${slotWhen(slot)} ("${slot.hook}"): `;
