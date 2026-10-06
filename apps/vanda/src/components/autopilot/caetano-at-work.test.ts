import { expect, it } from "vitest";
import type { AutopilotOverview } from "../../convex/autopilotData";
import { workStage } from "./caetano-at-work";

type Week = AutopilotOverview["weeks"][number];

type Slot = Week["slots"][number];

const week = (
  status: Week["status"],
  slots: Partial<Slot>[] = [],
  lastError: string | null = null,
) => ({ status, lastError, slots });

const overview = (fields: {
  enabled?: boolean;
  auditRunning?: boolean;
  auditError?: string | null;
  weeks?: ReturnType<typeof week>[];
}) =>
  // SAFETY: workStage reads only these fields of the overview.
  ({
    enabled: fields.enabled ?? true,
    auditRunning: fields.auditRunning ?? false,
    auditError: fields.auditError ?? null,
    weeks: fields.weeks ?? [week("planned")],
  }) as AutopilotOverview;

it("follows the start: analyzing, then planning, then nothing to show", () => {
  expect(workStage(overview({ auditRunning: true, weeks: [week("planning")] }))).toEqual({
    kind: "analyzing",
  });
  expect(workStage(overview({ weeks: [week("planning"), week("planned")] }))).toEqual({
    kind: "planning",
  });
  expect(workStage(overview({ weeks: [week("planned")] }))).toBeNull();
  expect(workStage(overview({ enabled: false, auditRunning: true }))).toBeNull();
});

it("shows the post being made and why the start failed", () => {
  expect(
    workStage(
      overview({ weeks: [week("planned", [{ status: "generating", weekday: 4, time: "18:00" }])] }),
    ),
  ).toEqual({ kind: "creating", when: "Qui 18h" });
  expect(workStage(overview({ auditError: "limite de uso atingido" }))).toEqual({
    kind: "failed",
    reason: "limite de uso atingido",
  });
  expect(
    workStage(overview({ weeks: [week("failed", [], "o planejamento não terminou")] })),
  ).toEqual({ kind: "failed", reason: "o planejamento não terminou" });
});
