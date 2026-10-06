import { expect, it } from "vitest";
import type { AutopilotSlotView } from "../../convex/autopilotData";
import { groupQueue } from "./queue";

const HOUR = 3_600_000;

const NOW = Date.UTC(2026, 9, 7, 18);

const slot = (slotId: string, offsetHours: number, status: AutopilotSlotView["status"]) => ({
  slotId,
  scheduledFor: NOW + offsetHours * HOUR,
  status,
});

it("puts approvals first, then what is coming in time order, then what went out newest first", () => {
  const queue = groupQueue(
    [
      slot("later", 48, "planned"),
      slot("approve", 30, "awaiting_approval"),
      slot("soon", 20, "scheduled"),
      slot("skipped", 72, "skipped"),
      slot("old", -48, "published"),
      slot("recent", -2, "published"),
      slot("missed", -24, "skipped"),
    ],
    NOW,
  );

  expect(queue.approval.map((item) => item.slotId)).toEqual(["approve"]);
  expect(queue.upcoming.map((item) => item.slotId)).toEqual(["soon", "later", "skipped"]);
  // A skipped post whose time passed simply drops off.
  expect(queue.past.map((item) => item.slotId)).toEqual(["recent", "old"]);
});

it("does not ask to approve a post whose time already passed", () => {
  const queue = groupQueue([slot("late", -1, "awaiting_approval")], NOW);

  expect(queue.approval).toEqual([]);
});
