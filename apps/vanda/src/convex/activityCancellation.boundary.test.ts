// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("tool output activity identity", () => {
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
});
