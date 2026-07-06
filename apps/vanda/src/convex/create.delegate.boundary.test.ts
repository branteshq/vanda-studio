// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const OWNER = "owner-clerk";
const INTRUDER = "intruder-clerk";

// ---------------------------------------------------------------------------
// workflow.start caveat (verified with a probe): both `delegate` and `approveAll`
// call `workflow.start` on the @convex-dev/workflow component. convex-test cannot
// run that component — even with `@convex-dev/workflow/test` registering it, the
// component's runtime references `process`, which is absent in the convex-test
// UDF sandbox ("process is not defined"). So the positive transition
// (actionable → "creating" + a started workflow) is NOT observable here: the
// mutation throws at `workflow.start` and the whole transaction rolls back.
//
// These tests exercise the fully reachable contract that runs BEFORE any
// workflow call: ownership, the not-found guards, and the actionability
// partition (which statuses admit a create vs. are skipped/rejected). Admission
// is pinned by proving the mutation gets PAST the partition to workflow.start
// (surfacing the component error), never a rejection or a silent skip:
//   • delegate admits suggestion|needs_you|approved (else "not actionable").
//   • approveAll delegates the review queue — suggestion, approved, and
//     needs_you whose rejectionReason is unset — scanning only those via
//     by_account_status. A belief-weakened needs_you (a rejectionReason set by
//     rethink) is scanned but skipped, and creating/dismissed/rejected are never
//     scanned. A queue of only-skipped rows is thus fully observable
//     ({ started: 0 }, every row untouched); any admitted row hits workflow.start
//     and rolls the whole batch back.
// ---------------------------------------------------------------------------

const seedOwnedAccount = async (t: TestConvex<typeof schema>): Promise<Id<"accounts">> => {
  const now = Date.now();
  return await t.run(async (ctx) => {
    const me = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: OWNER });
    await ctx.db.insert("users", { name: "Other", email: "o@e.com", clerkId: INTRUDER });
    return await ctx.db.insert("accounts", {
      ownerUserId: me,
      mode: "auto",
      createdAt: now,
      updatedAt: now,
    });
  });
};

const insertSuggestion = (
  t: TestConvex<typeof schema>,
  accountId: Id<"accounts">,
  status: Doc<"suggestions">["status"],
  rejectionReason?: string,
): Promise<Id<"suggestions">> =>
  t.run((ctx) =>
    ctx.db.insert("suggestions", {
      accountId,
      title: status,
      rationale: "r",
      themeName: "t",
      beliefStatements: [],
      signalIds: [],
      status,
      requiresApproval: false,
      createdAt: Date.now(),
      ...(rejectionReason === undefined ? {} : { rejectionReason }),
    }),
  );

describe("create.delegate — Vanda faz (the owner hands one idea to Vanda)", () => {
  it("admits actionable statuses through the guard (reaching workflow.start)", async () => {
    // For suggestion|needs_you|approved, `startCreate` passes the actionability
    // guard and calls workflow.start — which convex-test surfaces as the
    // component error. The point observed here: it is NOT the "not actionable"
    // rejection, i.e. the guard admitted the status.
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const asOwner = t.withIdentity({ subject: OWNER });

    for (const status of ["suggestion", "needs_you", "approved"] as const) {
      const suggestionId = await insertSuggestion(t, accountId, status);
      let error: Error | undefined;
      try {
        await asOwner.mutation(api.create.delegate, { suggestionId });
      } catch (e) {
        error = e as Error;
      }
      expect(error, `${status} should pass the actionability guard`).toBeDefined();
      expect(error!.message).not.toMatch(/not actionable/);
      expect(error!.message).toMatch(/not registered/); // died at workflow.start, past the guard
    }
  });

  it("rejects non-actionable statuses before any workflow call", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const asOwner = t.withIdentity({ subject: OWNER });

    for (const status of ["creating", "scheduled", "dismissed", "rejected"] as const) {
      const suggestionId = await insertSuggestion(t, accountId, status);
      await expect(asOwner.mutation(api.create.delegate, { suggestionId })).rejects.toThrow(
        /not actionable/,
      );
      // Guard rejected it; the status is untouched.
      expect((await t.run((ctx) => ctx.db.get(suggestionId)))!.status).toBe(status);
    }
  });

  it("rejects a non-owner (before touching the suggestion) and a missing suggestion", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const suggestionId = await insertSuggestion(t, accountId, "suggestion");

    await expect(
      t.withIdentity({ subject: INTRUDER }).mutation(api.create.delegate, { suggestionId }),
    ).rejects.toThrow(/account not found/);
    expect((await t.run((ctx) => ctx.db.get(suggestionId)))!.status).toBe("suggestion");

    const ghost = await insertSuggestion(t, accountId, "suggestion");
    await t.run((ctx) => ctx.db.delete(ghost));
    await expect(
      t.withIdentity({ subject: OWNER }).mutation(api.create.delegate, { suggestionId: ghost }),
    ).rejects.toThrow(/suggestion not found/);
  });
});

describe("create.approveAll — Aprovar todas (hand the review pool to Vanda)", () => {
  it("admits a needs_you with no rejectionReason (reaching workflow.start)", async () => {
    // B1: the review queue now includes needs_you whose rejectionReason is unset.
    // With only that row seeded, approveAll gets PAST the skip check to
    // workflow.start — surfacing the component error, not a silent { started: 0 }.
    // Same reachable-contract proof of inclusion as delegate's actionable test.
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    await insertSuggestion(t, accountId, "needs_you");

    let error: Error | undefined;
    try {
      await t.withIdentity({ subject: OWNER }).mutation(api.create.approveAll, { accountId });
    } catch (e) {
      error = e as Error;
    }
    expect(error, "an admitted needs_you must reach workflow.start").toBeDefined();
    expect(error!.message).toMatch(/not registered/); // reached workflow.start, past the skip
  });

  it("admits the fresh pool (suggestion|approved), reaching workflow.start", async () => {
    // A suggestion|approved item makes approveAll call startCreate → workflow.start,
    // which convex-test can't run, so the mutation throws. Pins that approveAll
    // scans and acts on the fresh pool too; the `{ started }` count for a non-empty
    // pool is not observable here (see the workflow.start caveat at the top).
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    await insertSuggestion(t, accountId, "suggestion");
    await insertSuggestion(t, accountId, "approved");

    await expect(
      t.withIdentity({ subject: OWNER }).mutation(api.create.approveAll, { accountId }),
    ).rejects.toThrow(/not registered/);
  });

  it("skips belief-weakened needs_you + never-scanned statuses: starts nothing, untouched", async () => {
    // The only-skipped queue is fully reachable (nothing hits workflow.start): a
    // needs_you with a rejectionReason (belief-weakened, left for individual
    // review) is scanned but continue'd, and creating/dismissed/rejected fall
    // outside the by_account_status scan entirely. So approveAll returns
    // { started: 0 } and every row keeps its status (and the weakened row keeps
    // its rejectionReason — startCreate would have cleared it).
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    const weakened = await insertSuggestion(t, accountId, "needs_you", "belief weakened");
    const creating = await insertSuggestion(t, accountId, "creating");
    const dismissed = await insertSuggestion(t, accountId, "dismissed");
    const rejected = await insertSuggestion(t, accountId, "rejected", "off-brand");

    const result = await t.withIdentity({ subject: OWNER }).mutation(api.create.approveAll, {
      accountId,
    });
    expect(result).toEqual({ started: 0 });
    const weakenedRow = (await t.run((ctx) => ctx.db.get(weakened)))!;
    expect(weakenedRow.status).toBe("needs_you");
    expect(weakenedRow.rejectionReason).toBe("belief weakened");
    expect((await t.run((ctx) => ctx.db.get(creating)))!.status).toBe("creating");
    expect((await t.run((ctx) => ctx.db.get(dismissed)))!.status).toBe("dismissed");
    expect((await t.run((ctx) => ctx.db.get(rejected)))!.status).toBe("rejected");
  });

  it("rejects a non-owner", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedOwnedAccount(t);
    await insertSuggestion(t, accountId, "suggestion");
    await expect(
      t.withIdentity({ subject: INTRUDER }).mutation(api.create.approveAll, { accountId }),
    ).rejects.toThrow(/account not found/);
  });
});
