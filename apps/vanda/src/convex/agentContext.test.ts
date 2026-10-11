import { expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import { requireOwnerTurn } from "./agentContext";

it("refuses owner-only actions inside posts automáticos work turns only", () => {
  // SAFETY: a placeholder id; the guard only checks whether a job is attached.
  const accountId = "account" as Id<"accounts">;

  expect(() => requireOwnerTurn({})).not.toThrow();
  expect(() => requireOwnerTurn({ autopilotJob: { kind: "post", accountId } })).toThrow(
    /só o dono decide/,
  );
});
