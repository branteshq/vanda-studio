import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { AutopilotOverview, AutopilotSlotView } from "../../convex/autopilotData";
import { guidedReplies } from "./guided-replies";

// SAFETY: fixture ids only travel through the pure suggestion logic, never to Convex.
const slotId = (value: string) => value as Id<"autopilotSlots">;

// SAFETY: as above — a fixture account id for the pure logic.
const accountId = (value: string) => value as Id<"accounts">;

const NOW = Date.UTC(2026, 9, 7, 18, 0);

const DAY = 86_400_000;

const slot = (overrides: Partial<AutopilotSlotView>): AutopilotSlotView => ({
  slotId: slotId("slot1"),
  scheduledFor: NOW + DAY,
  weekday: 4,
  time: "18:00",
  type: "image",
  slideCount: 1,
  purpose: "educacional",
  purposeLabel: "Educacional",
  theme: "tema",
  angle: "ângulo",
  hook: "gancho",
  slideOutline: ["capa"],
  captionBrief: "legenda",
  status: "planned",
  ownerEdited: false,
  postId: null,
  caption: null,
  coverUrl: null,
  imageUrls: [],
  permalink: null,
  lastError: null,
  revisionNote: null,
  results: null,
  ...overrides,
});

const overview = (overrides: Partial<AutopilotOverview> = {}): AutopilotOverview => ({
  accountId: accountId("acc"),
  handle: "padaria",
  connected: true,
  enabled: true,
  cadence: [],
  cadenceSource: "agent",
  cadenceRationale: null,
  cadenceSummary: "",
  approval: "required",
  feedbackStats: { approved: 0, rejected: 0, windowDays: 30 },
  learned: [],
  auditRunning: false,
  audit: null,
  weeks: [
    { weekStart: NOW - 2 * DAY, label: "05/10", status: "planned", strategy: null, slots: [] },
    { weekStart: NOW + 5 * DAY, label: "12/10", status: "planned", strategy: null, slots: [] },
  ],
  ...overrides,
});

const keys = (input: AutopilotOverview) => guidedReplies(input, NOW).map((reply) => reply.key);

describe("guidedReplies follows the planning state", () => {
  it("only offers to connect when Instagram is not connected", () => {
    expect(keys(overview({ connected: false }))).toEqual(["connect"]);
  });

  it("offers to take over (and to analyse first) while off", () => {
    expect(keys(overview({ enabled: false }))).toEqual(["enable", "audit"]);
  });

  it("puts the nearest post awaiting approval first, then failures and an empty next week", () => {
    const weeks = overview().weeks.map((week, index) =>
      index === 0
        ? {
            ...week,
            slots: [
              slot({
                slotId: slotId("late"),
                status: "awaiting_approval",
                scheduledFor: NOW + 3 * DAY,
              }),
              slot({
                slotId: slotId("soon"),
                status: "awaiting_approval",
                scheduledFor: NOW + DAY,
              }),
              slot({ slotId: slotId("broken"), status: "failed" }),
            ],
          }
        : week,
    );

    expect(keys(overview({ weeks }))).toEqual([
      "approve-soon",
      "reject-soon",
      "retry-broken",
      "plan-next",
    ]);
  });

  it("suggests asking for approval again when publishing direct keeps being refused", () => {
    const replies = keys(
      overview({ approval: "auto", feedbackStats: { approved: 1, rejected: 3, windowDays: 30 } }),
    );

    expect(replies).toContain("require-approval");
  });
});
