// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import * as instagramCache from "./instagram/cache";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("tool output activity identity", () => {
  it.each(["vanda", "caetano"])(
    "accounts for a completed Instagram read after its %s turn is cancelled",
    async (agent) => {
      vi.stubEnv("APIFY_API_TOKEN", "test-only");
      // Isolate cancellation from the pre-existing stable() recursion on string cache inputs.
      vi.spyOn(instagramCache, "instagramRequestKey").mockReturnValue("search:late-profile");
      const t = convexTest(schema, modules);

      const setup = await t.run(async (ctx) => {
        const now = Date.now();

        const ownerUserId = await ctx.db.insert("users", {
          clerkId: "instagram-owner",
          name: "Owner",
          email: "instagram-owner@example.com",
          createdAt: now,
        });

        const accountId = await ctx.db.insert("accounts", {
          ownerUserId,
          createdAt: now,
          updatedAt: now,
        });

        const activityA =
          agent === "caetano"
            ? await ctx.db.insert("caetanoThreadActivity", {
                userId: ownerUserId,
                threadId: "instagram-thread",
                promptMessageId: "instagram-request-a",
                startedAt: now,
              })
            : await ctx.db.insert("chatThreadActivity", {
                accountId,
                threadId: "instagram-thread",
                promptMessageId: "instagram-prompt-a",
                requestId: "instagram-request-a",
                startedAt: now,
              });

        return { accountId, activityA, now };
      });

      let started!: () => void;

      const requestStarted = new Promise<void>((resolve) => {
        started = resolve;
      });

      let finish!: (response: Response) => void;

      const providerResponse = new Promise<Response>((resolve) => {
        finish = resolve;
      });

      const fetch = vi.fn(() => {
        started();

        return providerResponse;
      });

      vi.stubGlobal("fetch", fetch);

      const read = t.action(internal.instagramActions.searchProfiles, {
        accountId: setup.accountId,
        activityId: setup.activityA,
        query: "late profile",
        limit: 1,
      });

      const cancelled = expect(read).rejects.toThrow("leitura do Instagram interrompida");
      await Promise.race([requestStarted, read]);

      const activityB = await t.run(async (ctx) => {
        await ctx.db.delete(setup.activityA);

        return ctx.db.insert("chatThreadActivity", {
          accountId: setup.accountId,
          threadId: "instagram-thread",
          promptMessageId: "instagram-prompt-b",
          requestId: "instagram-request-b",
          startedAt: setup.now + 1,
        });
      });

      finish(Response.json([{ id: "profile-1", username: "late-profile" }]));
      await cancelled;
      expect(fetch).toHaveBeenCalledTimes(1);

      expect(await t.run((ctx) => ctx.db.query("instagramObservations").collect())).toEqual([]);
      const reads = await t.run((ctx) => ctx.db.query("instagramReadEvents").collect());
      expect(reads).toHaveLength(1);
      expect(reads[0]).toMatchObject({ accountId: setup.accountId, source: "apify", itemCount: 1 });
      const charges = await t.run((ctx) => ctx.db.query("usageEvents").collect());
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({
        requestId: "instagram-request-a",
        threadId: "instagram-thread",
        kind: "instagram_apify",
        microUsd: 2_700,
      });
      expect(await t.run((ctx) => ctx.db.get(activityB))).not.toBeNull();
      expect(await t.run((ctx) => ctx.db.query("threadResourceManifests").collect())).toEqual([]);
    },
  );

  it("aborts A's in-flight image request while B remains active", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = convexTest(schema, modules);

    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", { createdAt: now, updatedAt: now });

      const activityA = await ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId: "same",
        promptMessageId: "a",
        startedAt: now,
      });

      const activityB = await ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId: "same",
        promptMessageId: "b",
        startedAt: now,
      });

      return { accountId, activityA, activityB };
    });

    let started!: () => void;

    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });

    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: RequestInfo | URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("aborted test request"));
            });
            started();
          }),
      ),
    );

    const paint = t.action(internal.images.paint, {
      accountId: setup.accountId,
      activityId: setup.activityA,
      threadId: "same",
      prompt: "test",
      aspectRatio: "1:1",
    });

    const rejected = expect(paint).rejects.toThrow("geração interrompida");
    await Promise.race([
      requestStarted,
      paint.then(() => {
        throw new Error("paint unexpectedly finished before cancellation");
      }),
    ]);
    await t.run((ctx) => ctx.db.delete(setup.activityA));
    await rejected;
    expect(aborted).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(setup.activityB))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("images").collect())).toEqual([]);
  });

  it("rejects expired turn A even while turn B on the same thread is active", async () => {
    const t = convexTest(schema, modules);

    const setup = await t.run(async (ctx) => {
      const now = Date.now();
      const accountId = await ctx.db.insert("accounts", { createdAt: now, updatedAt: now });
      const threadId = "same-thread";

      const activityA = await ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId,
        promptMessageId: "prompt-a",
        startedAt: now,
      });

      const activityB = await ctx.db.insert("chatThreadActivity", {
        accountId,
        threadId,
        promptMessageId: "prompt-b",
        startedAt: now + 1,
      });

      await ctx.db.delete(activityA);
      const storageA = await ctx.storage.store(new Blob(["a"]));
      const storageB = await ctx.storage.store(new Blob(["b"]));

      return { accountId, activityA, activityB, storageA, storageB };
    });

    const imageArgs = {
      accountId: setup.accountId,
      prompt: "resultado",
      mimeType: "image/png",
      width: 1,
      height: 1,
    };

    await expect(
      t.mutation(internal.imagesData.savePaintedImage, {
        ...imageArgs,
        storageId: setup.storageA,
        activityId: setup.activityA,
      }),
    ).rejects.toThrow("activity expired");

    const imageB = await t.mutation(internal.imagesData.savePaintedImage, {
      ...imageArgs,
      storageId: setup.storageB,
      activityId: setup.activityB,
    });

    expect(await t.run((ctx) => ctx.db.get(imageB))).not.toBeNull();

    const runA = await t.mutation(internal.codeRunsData.beginCodeRun, {
      accountId: setup.accountId,
      code: "print('a')",
      description: "A",
    });

    const runB = await t.mutation(internal.codeRunsData.beginCodeRun, {
      accountId: setup.accountId,
      code: "print('b')",
      description: "B",
    });

    const artifactArgs = {
      filename: "result.txt",
      mimeType: "text/plain",
      content: "result",
    };

    await expect(
      t.mutation(internal.codeRunsData.saveCodeRunArtifact, {
        ...artifactArgs,
        codeRunId: runA,
        activityId: setup.activityA,
      }),
    ).rejects.toThrow("activity expired");

    const artifactB = await t.mutation(internal.codeRunsData.saveCodeRunArtifact, {
      ...artifactArgs,
      codeRunId: runB,
      activityId: setup.activityB,
    });

    expect((await t.run((ctx) => ctx.db.get(artifactB)))?.content).toBe("result");
    await expect(
      t.mutation(internal.codeRunsData.finishCodeRun, {
        codeRunId: runA,
        status: "ok",
        activityId: setup.activityA,
      }),
    ).rejects.toThrow("activity expired");
    await t.mutation(internal.codeRunsData.finishCodeRun, {
      codeRunId: runB,
      status: "ok",
      activityId: setup.activityB,
    });
    expect((await t.run((ctx) => ctx.db.get(runA)))?.status).toBe("running");
    expect((await t.run((ctx) => ctx.db.get(runB)))?.status).toBe("ok");
  });

  it("bounds Caetano persistence and charges to the exact owned activity", async () => {
    const t = convexTest(schema, modules);

    const setup = await t.run(async (ctx) => {
      const now = Date.now();

      const ownerId = await ctx.db.insert("users", {
        clerkId: "owner",
        name: "Owner",
        email: "owner@example.com",
        createdAt: now,
      });

      const foreignId = await ctx.db.insert("users", {
        clerkId: "foreign",
        name: "Foreign",
        email: "foreign@example.com",
        createdAt: now,
      });

      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: ownerId,
        createdAt: now,
        updatedAt: now,
      });

      const activityA = await ctx.db.insert("caetanoThreadActivity", {
        userId: ownerId,
        threadId: "same-caetano-thread",
        promptMessageId: "prompt-a",
        startedAt: now,
      });

      const activityB = await ctx.db.insert("caetanoThreadActivity", {
        userId: ownerId,
        threadId: "same-caetano-thread",
        promptMessageId: "prompt-b",
        startedAt: now + 1,
      });

      const foreignActivity = await ctx.db.insert("caetanoThreadActivity", {
        userId: foreignId,
        threadId: "foreign-thread",
        promptMessageId: "foreign-prompt",
        startedAt: now,
      });

      await ctx.db.delete(activityA);

      return {
        accountId,
        activityA,
        activityB,
        foreignActivity,
        storageId: await ctx.storage.store(new Blob(["image"])),
      };
    });

    const imageArgs = {
      accountId: setup.accountId,
      storageId: setup.storageId,
      prompt: "resultado",
      mimeType: "image/png",
      width: 1,
      height: 1,
      costUsd: 0.01,
    };

    await expect(
      t.mutation(internal.imagesData.savePaintedImage, {
        ...imageArgs,
        activityId: setup.activityA,
      }),
    ).rejects.toThrow("activity expired");
    await expect(
      t.mutation(internal.imagesData.savePaintedImage, {
        ...imageArgs,
        activityId: setup.foreignActivity,
      }),
    ).rejects.toThrow("activity expired");

    const imageId = await t.mutation(internal.imagesData.savePaintedImage, {
      ...imageArgs,
      activityId: setup.activityB,
    });

    expect(await t.run((ctx) => ctx.db.get(imageId))).not.toBeNull();

    const runId = await t.mutation(internal.codeRunsData.beginCodeRun, {
      accountId: setup.accountId,
      code: "print('ok')",
      description: "Caetano run",
    });

    await expect(
      t.mutation(internal.codeRunsData.finishCodeRun, {
        codeRunId: runId,
        status: "ok",
        costUsd: 0.02,
        activityId: setup.activityA,
      }),
    ).rejects.toThrow("activity expired");
    await expect(
      t.mutation(internal.codeRunsData.finishCodeRun, {
        codeRunId: runId,
        status: "ok",
        costUsd: 0.02,
        activityId: setup.foreignActivity,
      }),
    ).rejects.toThrow("activity expired");
    await t.mutation(internal.codeRunsData.finishCodeRun, {
      codeRunId: runId,
      status: "ok",
      costUsd: 0.02,
      activityId: setup.activityB,
    });

    const events = await t.run((ctx) => ctx.db.query("usageEvents").collect());
    expect(events).toHaveLength(2);
    expect(events.map(({ requestId, threadId }) => ({ requestId, threadId }))).toEqual([
      { requestId: "prompt-b", threadId: "same-caetano-thread" },
      { requestId: "prompt-b", threadId: "same-caetano-thread" },
    ]);
  });
});
