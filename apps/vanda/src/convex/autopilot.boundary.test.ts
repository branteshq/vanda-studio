// @vitest-environment edge-runtime
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { applyApprovalMode } from "./autopilotData";
import { saveBrandFile } from "./brandFile";
import { listPath } from "./workspace";
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

  agentComponent.register(t);

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
      approval: "auto",
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

  /**
   * Runs a post's work as Caetano's turn would: the job is queued, create_post
   * links the post to the slot, and the finished turn settles the job.
   */
  const produce = async (slotId: Id<"autopilotSlots">) => {
    await t.mutation(internal.autopilotData.startProduction, { slotId });
    const claimed = await t.run((ctx) => ctx.db.get(slotId));

    expect(claimed?.status).toBe("generating");

    const postId = await t.mutation(internal.posts.createPostInternal, {
      accountId: ids.accountId,
      imageIds: ids.imageIds.slice(0, claimed!.slideCount),
      caption: "3 erros na fermentação\n\nSalve esse post.",
      type: claimed!.type,
      format: "4:5",
      purpose: claimed!.purpose,
      autopilotSlotId: slotId,
    });

    await t.mutation(internal.autopilotData.completeJob, {
      job: { kind: "post", accountId: ids.accountId, slotId },
    });

    const status = (await t.run((ctx) => ctx.db.get(slotId)))?.status;

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
    await t.mutation(internal.autopilotData.startProduction, { slotId: tuesday._id });
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

    await t.mutation(internal.autopilotData.completeJob, {
      job: { kind: "post", accountId, slotId: tuesday._id },
    });

    expect((await t.run((ctx) => ctx.db.get(tuesday._id)))?.status).toBe("skipped");
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
    // A new hook makes the old outline stale: Caetano writes the slides again.
    expect(reset?.slideOutline).toEqual([]);
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

describe("autopilot in the rest of the product", () => {
  it("shows autopilot posts in the rail, the calendar and /posts, marked as Caetano's", async () => {
    const { t, accountId, imageIds, plan, slots, produce } = await setup();

    await plan(NEXT_WEEK);
    const [tuesday, thursday] = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor);

    vi.setSystemTime(tuesday!.scheduledFor - 20 * 3_600_000);
    const { postId } = await produce(tuesday!._id);

    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

    expect(jobs.map((job) => job.name)).toContain("autopilotChat:notifyProduced");

    const manualId = await t.mutation(internal.posts.createPostInternal, {
      accountId,
      imageIds: [imageIds[0]!],
      caption: "post manual",
    });

    await t.mutation(internal.posts.schedulePostInternal, {
      accountId,
      postId: manualId,
      scheduledFor: tuesday!.scheduledFor + 3_600_000,
    });

    const owner = t.withIdentity({ subject: "me" });
    const rail = await owner.query(api.posts.listForRail, { accountId });

    expect(rail.find((post) => post.postId === postId)?.autopilotSlotId).toBe(tuesday!._id);
    expect(rail.find((post) => post.postId === manualId)?.autopilotSlotId).toBeNull();

    const calendar = await owner.query(api.calendar.range, {
      accountId,
      start: NEXT_WEEK,
      end: NEXT_WEEK + 7 * 86_400_000,
    });

    expect(calendar.map((item) => [item.status, item.autopilot?.slotId ?? null])).toEqual([
      ["scheduled", tuesday!._id],
      ["scheduled", null],
      ["planned", thursday!._id],
      ["planned", expect.any(String)],
    ]);

    const listing = await t.query(internal.workspaceData.list, { accountId, path: "/posts" });

    const planFile = await t.query(internal.workspaceData.read, {
      accountId,
      path: "/autopilot/plan.md",
    });

    expect(JSON.stringify(listing)).toContain("post automático do Caetano");
    expect(JSON.stringify(planFile)).toContain(tuesday!._id);
  });
});

describe("autopilot approval and learning", () => {
  const requireApproval = (t: Awaited<ReturnType<typeof setup>>["t"], accountId: Id<"accounts">) =>
    t.run(async (ctx) => {
      const config = await ctx.db
        .query("autopilotConfigs")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .unique();

      await ctx.db.patch(config!._id, { approval: "required" });
    });

  it("waits for approval, and approving arms the post", async () => {
    const { t, accountId, plan, slots, produce } = await setup();

    await requireApproval(t, accountId);
    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    const { postId, status } = await produce(tuesday._id);

    expect(status).toBe("awaiting_approval");
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe("draft");

    await t.withIdentity({ subject: "me" }).mutation(api.autopilot.approveSlot, {
      accountId,
      slotId: tuesday._id,
    });

    expect((await t.run((ctx) => ctx.db.get(tuesday._id)))?.status).toBe("scheduled");
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe("scheduled");

    const feedback = await t.run((ctx) => ctx.db.query("autopilotFeedback").collect());

    expect(feedback.map((row) => row.decision)).toEqual(["approved"]);
  });

  it("requires a reason to reject, redoes the post with it and records the owner's scope", async () => {
    const { t, accountId, plan, slots, produce } = await setup();

    await requireApproval(t, accountId);
    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    await produce(tuesday._id);

    await expect(
      t.mutation(internal.autopilotData.rejectSlotInternal, {
        accountId,
        slotId: tuesday._id,
        reason: "não",
        scope: "post",
      }),
    ).rejects.toThrow();

    const status = await t.mutation(internal.autopilotData.rejectSlotInternal, {
      accountId,
      slotId: tuesday._id,
      reason: "Não use emoji em post de banco",
      scope: "geral",
    });

    expect(status).toBe("planned");

    const slot = await t.run((ctx) => ctx.db.get(tuesday._id));

    expect(slot?.revisionNote).toBe("Não use emoji em post de banco");
    expect(slot?.postId).toBeUndefined();

    const [feedback] = await t.run((ctx) => ctx.db.query("autopilotFeedback").collect());

    expect(feedback).toMatchObject({ decision: "rejected", scope: "geral" });

    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

    expect(jobs.map((job) => job.name)).toContain("autopilotData:startProduction");
  });

  it("shows what the owner taught from the brand file", async () => {
    const { t, accountId } = await setup();
    const owner = t.withIdentity({ subject: "me" });

    await t.run((ctx) =>
      saveBrandFile(
        ctx,
        accountId,
        "# Marca\n\n## Preferências\n\n- Legendas curtas (dono)\n\n## Nunca fazer\n\n- Não usar emojis nas legendas (dono)\n",
        "owner",
      ),
    );

    const overview = await owner.query(api.autopilot.overview, { accountId });

    expect(overview.learned).toEqual([
      { section: "Preferências", text: "Legendas curtas (dono)" },
      { section: "Nunca fazer", text: "Não usar emojis nas legendas (dono)" },
    ]);
  });

  it("does not publish a post left without approval", async () => {
    const { t, accountId, plan, slots, produce } = await setup();

    await requireApproval(t, accountId);
    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    await produce(tuesday._id);
    await t.mutation(internal.autopilotData.expireStale, { now: tuesday.scheduledFor });

    expect((await t.run((ctx) => ctx.db.get(tuesday._id)))?.status).toBe("skipped");
  });
});

describe("autopilot approval cannot be bypassed", () => {
  const requireApproval = (t: Awaited<ReturnType<typeof setup>>["t"], accountId: Id<"accounts">) =>
    t.run((ctx) => applyApprovalMode(ctx, accountId, "required"));

  const awaiting = async () => {
    const env = await setup();
    await env.t.run(async (ctx) => {
      const config = await ctx.db
        .query("autopilotConfigs")
        .withIndex("by_account", (q) => q.eq("accountId", env.accountId))
        .unique();

      await ctx.db.patch(config!._id, { approval: "required" });
    });
    await env.plan(NEXT_WEEK);
    const tuesday = (await env.slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    const { postId, status } = await env.produce(tuesday._id);

    expect(status).toBe("awaiting_approval");

    return { ...env, tuesday, postId };
  };

  it("restoring a skipped, unapproved post puts it back up for approval", async () => {
    const { t, accountId, tuesday, postId } = await awaiting();
    const owner = t.withIdentity({ subject: "me" });

    await owner.mutation(api.autopilot.skipSlot, { accountId, slotId: tuesday._id });

    const status = await owner.mutation(api.autopilot.restoreSlot, {
      accountId,
      slotId: tuesday._id,
    });

    expect(status).toBe("awaiting_approval");
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe("draft");
  });

  it("generic scheduling refuses an autopilot post", async () => {
    const { t, accountId, postId } = await awaiting();

    await expect(
      t.mutation(internal.posts.schedulePostInternal, { accountId, postId }),
    ).rejects.toThrow(/posts automáticos/);
  });

  it("the publisher holds an autopilot post whose slot is not armed", async () => {
    const { t, accountId, tuesday, postId } = await awaiting();

    // A schedule row that got there some other way, while the slot still waits for approval.
    const scheduledPostId = await t.run(async (ctx) => {
      await ctx.db.patch(postId, { status: "scheduled" });

      return ctx.db.insert("scheduledPosts", {
        accountId,
        postId,
        scheduledFor: tuesday.scheduledFor,
        status: "scheduled",
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    expect(await t.mutation(internal.publishScheduled.holdUnapproved, { scheduledPostId })).toBe(
      true,
    );
    expect(await t.run((ctx) => ctx.db.get(scheduledPostId))).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe("draft");
  });

  it("deleting or cancelling through generic post tools keeps the slot true", async () => {
    const { t, accountId, tuesday, postId } = await awaiting();

    await t.withIdentity({ subject: "me" }).mutation(api.autopilot.approveSlot, {
      accountId,
      slotId: tuesday._id,
    });
    await t.mutation(internal.posts.cancelScheduleInternal, { accountId, postId });
    expect((await t.run((ctx) => ctx.db.get(tuesday._id)))?.status).toBe("awaiting_approval");

    await t.mutation(internal.posts.deletePostInternal, { accountId, postId });
    const slot = await t.run((ctx) => ctx.db.get(tuesday._id));

    expect(slot?.status).toBe("skipped");
    expect(slot?.postId).toBeUndefined();
    // Pausing afterwards no longer trips over the missing post.
    await t.mutation(internal.autopilotData.setEnabledInternal, { accountId, enabled: false });
  });

  it("turning approval on holds posts that were armed without it", async () => {
    const { t, accountId, plan, slots, produce } = await setup();

    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    const { postId, status } = await produce(tuesday._id);

    expect(status).toBe("scheduled");

    await requireApproval(t, accountId);

    expect((await t.run((ctx) => ctx.db.get(tuesday._id)))?.status).toBe("awaiting_approval");
    expect((await t.run((ctx) => ctx.db.get(postId)))?.status).toBe("draft");
  });
});

describe("autopilot settings", () => {
  it("lets the agents turn it off and rewrite the cadence through settings_set", async () => {
    const { t, accountId } = await setup();

    const userId = await t.run(async (ctx) => {
      const account = await ctx.db.get(accountId);

      await ctx.db.patch(account!.ownerUserId!, { activeAccountId: accountId });

      return account!.ownerUserId!;
    });

    await t.mutation(internal.settingsData.set, {
      userId,
      id: "autopilot.cadence",
      value: "seg 9h imagem; qua 19h30 carrossel 4",
    });

    const config = await t.run((ctx) =>
      ctx.db
        .query("autopilotConfigs")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .unique(),
    );

    expect(config?.cadenceSource).toBe("owner");
    expect(config?.cadence).toEqual([
      { weekday: 1, time: "09:00", type: "image", slideCount: 1 },
      { weekday: 3, time: "19:30", type: "carousel", slideCount: 4 },
    ]);

    await t.mutation(internal.settingsData.set, {
      userId,
      id: "autopilot.enabled",
      value: "desligado",
    });

    const settings = await t.query(internal.settingsData.get, { userId, id: "autopilot.enabled" });

    expect(JSON.stringify(settings)).toContain('"enabled":false');
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

describe("autopilot work in Caetano's thread", () => {
  const inbox = (t: Awaited<ReturnType<typeof setup>>["t"]) =>
    t.run((ctx) => ctx.db.query("caetanoInbox").collect());

  it("asks Caetano for each post as a queued turn of his own thread", async () => {
    const { t, plan, slots } = await setup();

    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    await t.mutation(internal.autopilotData.startProduction, { slotId: tuesday._id });

    const [row] = await inbox(t);

    expect(row).toMatchObject({
      channel: "web",
      status: "queued",
      autopilotJob: { kind: "post", slotId: tuesday._id },
    });

    const [prompt] = await t.run((ctx) =>
      ctx.runQuery(components.agent.messages.getMessagesByIds, {
        messageIds: [row!.promptMessageId],
      }),
    );

    expect(prompt?.message?.content).toEqual(expect.stringContaining("Gancho da capa: gancho 0"));
    expect(prompt?.message?.content).toEqual(expect.stringContaining(`autopilot tarefa=post`));
  });

  it("shows a regenerated post's old draft as discarded in /posts", async () => {
    const { t, accountId, plan, slots, produce } = await setup();

    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    await produce(tuesday._id);

    const listing = () =>
      t.run(async (ctx) => {
        const result = await listPath(ctx, accountId, "/posts");

        return result.ok ? result.entries.map((entry) => entry.summary ?? "") : [];
      });

    expect(await listing()).toEqual([expect.stringContaining("post automático do Caetano")]);

    await t.mutation(internal.autopilotData.regenerateSlotInternal, {
      accountId,
      slotId: tuesday._id,
    });

    expect(await listing()).toEqual([expect.stringContaining("versão descartada")]);
  });

  it("fails the post when the turn ends without create_post", async () => {
    const { t, accountId, plan, slots } = await setup();

    await plan(NEXT_WEEK);
    const tuesday = (await slots()).toSorted((a, b) => a.scheduledFor - b.scheduledFor)[0]!;

    vi.setSystemTime(tuesday.scheduledFor - 20 * 3_600_000);
    await t.mutation(internal.autopilotData.startProduction, { slotId: tuesday._id });
    await t.mutation(internal.autopilotData.completeJob, {
      job: { kind: "post", accountId, slotId: tuesday._id },
    });

    const slot = await t.run((ctx) => ctx.db.get(tuesday._id));

    expect(slot?.status).toBe("failed");
    expect(slot?.lastError).toBe("O Caetano não concluiu o post.");
  });

  it("queues the diagnosis and both weeks' plans, and settles what was not saved", async () => {
    const { t, accountId } = await setup();

    await t.mutation(internal.autopilotData.reanalyzeInternal, { accountId });

    expect((await inbox(t)).map((row) => row.autopilotJob?.kind)).toEqual([
      "audit",
      "plan",
      "plan",
    ]);

    const weeks = await t.run((ctx) => ctx.db.query("autopilotWeeks").collect());

    expect(weeks.map((week) => week.status)).toEqual(["planning", "planning"]);

    await t.mutation(internal.autopilotData.completeJob, { job: { kind: "audit", accountId } });
    await t.mutation(internal.autopilotData.completeJob, {
      job: { kind: "plan", accountId, weekStart: NEXT_WEEK },
    });

    const audit = await t.run((ctx) => ctx.db.query("accountAudits").first());

    expect(audit?.status).toBe("failed");
    expect(
      (await t.run((ctx) => ctx.db.query("autopilotWeeks").collect())).find(
        (week) => week.weekStart === NEXT_WEEK,
      )?.status,
    ).toBe("failed");
  });

  it("saves Caetano's plan over the cadence and keeps what the owner fixed", async () => {
    const { t, accountId } = await setup();

    const slots = [0, 1, 2].map((index) => ({ index, ...brief(`gancho ${index}`) }));

    await expect(
      t.mutation(internal.autopilotData.savePlanFromJob, {
        accountId,
        weekStart: NEXT_WEEK,
        strategy: "ensinar",
        slots: slots.slice(0, 2),
      }),
    ).rejects.toThrow(/faltam os slots 2/);

    const created = await t.mutation(internal.autopilotData.savePlanFromJob, {
      accountId,
      weekStart: NEXT_WEEK,
      strategy: "ensinar",
      slots: slots.map((slot) => ({ ...slot, slideOutline: ["só uma linha"] })),
    });

    expect(created).toBe(3);

    const saved = await t.run((ctx) => ctx.db.query("autopilotSlots").collect());

    expect(saved.every((slot) => slot.slideOutline.length === slot.slideCount)).toBe(true);
  });

  it("completes a measured diagnosis with Caetano's judgement", async () => {
    const { t, accountId } = await setup();

    await t.mutation(internal.autopilotData.reanalyzeInternal, { accountId });

    const judgement = {
      accountId,
      rubric: [
        { item: "nome", score: 6, max: 12 },
        { item: "atividade", score: 10, max: 10 },
      ],
      postNotes: [{ postId: "p1", why: "Capa com número" }],
      findings: [{ claim: "Carrossel rende mais", evidence: "3× contra 1×", n: 3 }],
      stop: [],
      doMore: ["Passo a passo"],
      needs: ["Constância"],
      summary: "Conta ativa, carrosséis vão melhor.",
      recommendedCadence: [{ weekday: 2, time: "18:00", type: "carousel" as const, slideCount: 3 }],
      cadenceRationale: "Terça à noite.",
    };

    await expect(t.mutation(internal.autopilotData.saveAuditJudgement, judgement)).rejects.toThrow(
      /autopilot_measure_account/,
    );

    await t.mutation(internal.autopilotData.saveMeasurement, {
      accountId,
      confidence: "baixa",
      metrics: { sampleSize: 2, byFormat: [], byHour: [] },
      top: [{ externalPostId: "p1", caption: "c", format: "carousel", outlier: 2 }],
      bottom: [],
    });

    expect(await t.mutation(internal.autopilotData.saveAuditJudgement, judgement)).toBe(73);

    const audit = await t.run((ctx) => ctx.db.query("accountAudits").first());

    expect(audit).toMatchObject({ status: "ready", profileScore: 73 });
    expect(audit?.top?.[0]?.why).toBe("Capa com número");
  });
});
