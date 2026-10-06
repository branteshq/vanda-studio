import type { AutopilotSlotView } from "../../convex/autopilotData";

type QueueSlot = Pick<AutopilotSlotView, "status" | "scheduledFor">;

export interface AutopilotQueue<Slot extends QueueSlot> {
  /** Made and waiting for the owner's yes. */
  readonly approval: Slot[];
  /** Still to go out: planned, being made, armed, or skipped (shown muted). */
  readonly upcoming: Slot[];
  /** Already on Instagram, or what did not make it out, newest first. */
  readonly past: Slot[];
}

/** The page's three lists from every slot of the weeks it reads. */
export function groupQueue<Slot extends QueueSlot>(
  slots: readonly Slot[],
  now: number,
): AutopilotQueue<Slot> {
  const byTime = slots.toSorted((a, b) => a.scheduledFor - b.scheduledFor);
  const done = (slot: Slot) => slot.status === "published" || slot.scheduledFor < now;

  return {
    approval: byTime.filter((slot) => slot.status === "awaiting_approval" && !done(slot)),
    upcoming: byTime.filter((slot) => slot.status !== "awaiting_approval" && !done(slot)),
    past: byTime.filter((slot) => done(slot) && slot.status !== "skipped").reverse(),
  };
}
