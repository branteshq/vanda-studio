// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { DEFAULT_CADENCE, slotTimestamp, weekStartOf } from "./pipeline/autopilot";

const modules = import.meta.glob("./**/*.ts");

// Wednesday 2026-10-07 15:00 São Paulo.
const NOW = Date.UTC(2026, 9, 7, 18, 0);

const WEEK = weekStartOf(NOW);

const NEXT_WEEK = WEEK + 7 * 86_400_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

const brief = (hook: string) => ({
  purpose: "educacional" as const,
  theme: `tema ${hook}`,
  angle: `ângulo ${hook}`,
  hook,
  slideOutline: ["capa", "conteúdo", "resumo"],
  captionBrief: "peça para salvar",
});

const setup = async () => {
  const t = convexTest(schema, modules);

  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Me", email: "me@e.com", clerkId: "me" });

    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      handle: "padaria",
      publisherConnectedAt: NOW,
      onboardedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await ctx.db.insert("autopilotConfigs", {
      accountId,
      enabled: true,
      cadence: [...DEFAULT_CADENCE],
      cadenceSource: "agent",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const imageIds = await Promise.all(
      [1, 2, 3].map((n) =>
        ctx.db.insert("images", {
          accountId,
          origin: "generated",
          purpose: "post",
          externalUrl: `https://img/${n}.jpg`,
          createdAt: NOW,
        }),
      ),
    );

    return { accountId, imageIds };
  });

  const plan = (weekStart: number, entries = DEFAULT_CADENCE) =>
    t.mutation(internal.autopilotData.savePlan, {
      accountId: ids.accountId,
      weekStart,
      auditId: null,
      strategy: "ensinar e provar",
      entries: entries.map((entry, index) => ({ ...entry, ...brief(`gancho ${index}`) })),
    });

  const slots = () =>
    t.run((ctx) =>
      ctx.db
        .query("autopilotSlots")
        .withIndex("by_account_scheduledFor", (q) => q.eq("accountId", ids.accountId))
        .collect(),
    );

  /** Runs claim → post → finishProduction for a slot, as the producer does. */
  const produce = async (slotId: Id<"autopilotSlots">) => {
    const claimed = await t.mutation(internal.autopilotData.claimSlot, { slotId });

    expect(claimed).not.toBeNull();

    const postId = await t.mutation(internal.posts.createPostInternal, {
      accountId: ids.accountId,
      imageIds: ids.imageIds.slice(0, claimed!.slideCount),
      caption: "3 erros na fermentação\n\nSalve esse post.",
      type: claimed!.type,
      format: "4:5",
      purpose: claimed!.purpose,
      autopilotSlotId: slotId,
    });

    const status = await t.mutation(internal.autopilotData.finishProduction, { slotId, postId });

    return { postId, status };
  };

  return { t, ...ids, plan, slots, produce };
};

describe("autopilot plan", () => {
  it("creates one slot per remaining cadence entry in São Paulo time", async () => {
    const { t, plan, slots } = await setup();

    // Tuesday already passed this week; Thursday and Saturday remain.
    expect((await plan(WEEK)).created).toBe(2);
    expect((await plan(NEXT_WEEK)).created).toBe(3);

    const all = await slots();

    expect(all.map((slot) => slot.scheduledFor).toSorted((a, b) => a - b)).toEqual([
      slotTimestamp(WEEK, 4, "18:00"),
      slotTimestamp(WEEK, 6, "12:00"),
      slotTimestamp(NEXT_WEEK, 2, "18:00"),
      slotTimestamp(NEXT_WEEK, 4, "18:00"),
      slotTimestamp(NEXT_WEEK, 6, "12:00"),
    ]);
    expect(all.every((slot) => slot.status === "planned")).toBe(true);

    // Thursday 18h is 27h away: outside the 24h window, so nothing is produced yet.
    const scheduledJobs = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );

    expect(scheduledJobs.filter((job) => job.name.includes("produceSlot"))).toHaveLength(0);
  });

  it("keeps owner-edited and produced slots on replan and replaces the rest", async () => {
    const { t, accountId, plan, slots, produce } = await setup();

    await plan(NEXT_WEEK);

    const [tuesday, thursday, saturday] = (await slots()).toSorted(
      (a, b) => a.scheduledFor - b.scheduledFor,
    );

    await t.mutation(internal.autopilotData.updateSlotInternal, {
      accountId,
      slotId: tuesday!._id,
      change: { hook: "fixado pelo dono" },
    });

    vi.setSystemTime(thursday!.scheduledFor - 20 * 3_600_000);
    await produce(thursday!._id);

    const replanned = await plan(NEXT_WEEK);

    expect(replanned.created).toBe(1);

    const after = await slots();

    expect(after.find((slot) => slot._id === tuesday!._id)?.hook).toBe("fixado pelo dono");
    expect(after.find((slot) => slot._id === thursday!._id)?.status).toBe("scheduled");
    expect(after.some((slot) => slot._id === saturday!._id)).toBe(false);
    expect(after).toHaveLength(3);
  });

  it("disarms a produced slot the new cadence dropped", async () => {
    const { t, plan, slots, produce } = await setup();

    await plan(NEXT_WEEK);

    const thursday = (await slots()).find(
      (slot) => slot.scheduledFor === slotTimestamp(NEXT_WEEK, 4, "18:00"),
    )!;

    vi.setSystemTime(thursday.scheduledFor - 20 * 3_600_000);
    const { postId } = await produce(thursday._id);

    await plan(NEXT_WEEK, [{ weekday: 5, time: "19:00", type: "image", slideCount: 1 }]);

    const dropped = await t.run((ctx) => ctx.db.get(thursday._id));

    expect(dropped?.status).toBe("skipped");
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe("draft");
  });
});

describe("autopilot production and veto", () => {
  it("schedules the produced post, and skip/restore disarm and re-arm it", async () => {
    const { t, accountId, plan, slots, produce } = await setup();

    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);

    const { postId, status } = await produce(tuesday._id);

    expect(status).toBe("scheduled");

    const scheduled = await t.run((ctx) =>
      ctx.db
        .query("scheduledPosts")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .first(),
    );

    expect(scheduled?.scheduledFor).toBe(tuesday.scheduledFor);

    const post = await t.run((ctx) => ctx.db.get(postId));

    expect(post?.origin).toBe("autopilot");

    await t.withIdentity({ subject: "me" }).mutation(api.autopilot.skipSlot, {
      accountId,
      slotId: tuesday._id,
    });

    const afterSkip = await t.run(async (ctx) => ({
      slot: await ctx.db.get(tuesday._id),
      post: await ctx.db.get(postId),
      scheduled: await ctx.db
        .query("scheduledPosts")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .first(),
    }));

    expect(afterSkip.slot?.status).toBe("skipped");
    expect(afterSkip.post?.status).toBe("draft");
    expect(afterSkip.scheduled).toBeNull();

    const restored = await t
      .withIdentity({ subject: "me" })
      .mutation(api.autopilot.restoreSlot, { accountId, slotId: tuesday._id });

    expect(restored).toBe("scheduled");
  });

  it("does not schedule a post the owner vetoed while it was being produced", async () => {
    const { t, accountId, plan, slots } = await setup();

    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    await t.mutation(internal.autopilotData.claimSlot, { slotId: tuesday._id });
    await t.mutation(internal.autopilotData.skipSlotInternal, { accountId, slotId: tuesday._id });

    const { imageIds } = await t.run(async (ctx) => ({
      imageIds: (await ctx.db.query("images").collect()).map((image) => image._id),
    }));

    const postId = await t.mutation(internal.posts.createPostInternal, {
      accountId,
      imageIds: imageIds.slice(0, 2),
      caption: "legenda",
      type: "carousel",
      format: "4:5",
      autopilotSlotId: tuesday._id,
    });

    const status = await t.mutation(internal.autopilotData.finishProduction, {
      slotId: tuesday._id,
      postId,
    });

    expect(status).toBe("skipped");
    expect((await t.run((ctx) => ctx.db.get(tuesday._id)))?.postId).toBe(postId);
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe("draft");
  });

  it("re-aims a time change and resets a content change", async () => {
    const { t, accountId, plan, slots, produce } = await setup();

    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    const { postId } = await produce(tuesday._id);

    await t.mutation(internal.autopilotData.updateSlotInternal, {
      accountId,
      slotId: tuesday._id,
      change: { time: "19:30" },
    });

    const moved = await t.run((ctx) =>
      ctx.db
        .query("scheduledPosts")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .first(),
    );

    expect(moved?.scheduledFor).toBe(slotTimestamp(NEXT_WEEK, 2, "19:30"));

    const status = await t.mutation(internal.autopilotData.updateSlotInternal, {
      accountId,
      slotId: tuesday._id,
      change: { hook: "novo gancho", slideCount: 3 },
    });

    expect(status).toBe("planned");

    const reset = await t.run((ctx) => ctx.db.get(tuesday._id));

    expect(reset?.postId).toBeUndefined();
    expect(reset?.slideOutline).toHaveLength(3);
    expect(reset?.ownerEdited).toBe(true);
  });

  it("follows publication status and only produces slots inside the window", async () => {
    const { t, plan, slots, produce } = await setup();

    await plan(NEXT_WEEK);
    const [tuesday, thursday] = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor);

    vi.setSystemTime(tuesday!.scheduledFor - 20 * 3_600_000);

    expect(await t.query(internal.autopilotData.dueSlots, { now: Date.now() })).toEqual([
      tuesday!._id,
    ]);

    const { postId } = await produce(tuesday!._id);

    const scheduledPostId = (await t.run((ctx) =>
      ctx.db
        .query("scheduledPosts")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .first(),
    ))!._id;

    await t.mutation(internal.publishScheduled.setScheduledStatus, {
      scheduledPostId,
      status: "published",
      externalPostId: "ig_1",
    });

    expect((await t.run((ctx) => ctx.db.get(tuesday!._id)))?.status).toBe("published");
    expect((await t.run((ctx) => ctx.db.get(thursday!._id)))?.status).toBe("planned");
  });

  it("stops pending publications when the owner turns the autopilot off", async () => {
    const { t, accountId, plan, slots, produce } = await setup();

    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    const { postId } = await produce(tuesday._id);

    await t.mutation(internal.autopilotData.setEnabledInternal, { accountId, enabled: false });

    expect((await slots()).every((slot) => slot.status === "skipped")).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe("draft");
  });
});

describe("autopilot access", () => {
  it("shows the overview to the owner only", async () => {
    const { t, accountId, plan } = await setup();

    await plan(NEXT_WEEK);

    const overview = await t
      .withIdentity({ subject: "me" })
      .query(api.autopilot.overview, { accountId });

    expect(overview.cadenceSummary).toBe("3 por semana · Ter e Qui 18h · Sáb 12h");
    expect(overview.weeks[1]?.slots).toHaveLength(3);
    expect(overview.weeks[1]?.slots[0]).toMatchObject({ weekday: 2, time: "18:00" });

    await expect(
      t.withIdentity({ subject: "other" }).query(api.autopilot.overview, { accountId }),
    ).rejects.toThrow();
  });
});
