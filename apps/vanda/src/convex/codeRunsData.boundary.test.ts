// @vitest-environment edge-runtime
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { CODE_RUN_RATE_LIMIT } from "./codeRunsData";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const accountId = await ctx.db.insert("accounts", {
      mode: "manual",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const foreignAccountId = await ctx.db.insert("accounts", {
      mode: "manual",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const ownedImageId = await ctx.db.insert("images", {
      accountId,
      origin: "uploaded",
      externalUrl: "https://images.example/own.jpg",
      name: "foto própria",
      width: 1080,
      height: 1350,
      mimeType: "image/jpeg",
      createdAt: Date.now(),
    });
    const foreignImageId = await ctx.db.insert("images", {
      accountId: foreignAccountId,
      origin: "uploaded",
      externalUrl: "https://images.example/foreign.jpg",
      createdAt: Date.now(),
    });
    return { accountId, ownedImageId, foreignImageId };
  });
  return { t, ...ids };
};

describe("run_code identity boundary", () => {
  it("resolves owned inputs with the metadata meta.json needs", async () => {
    const { t, accountId, ownedImageId } = await setup();
    const resolved = await t.query(internal.codeRunsData.resolveCodeRunInput, {
      accountId,
      inputImageIds: [ownedImageId],
    });
    expect(resolved).toMatchObject([
      { imageId: ownedImageId, name: "foto própria", width: 1080, height: 1350 },
    ]);
  });

  it("rejects foreign input ids", async () => {
    const { t, accountId, foreignImageId } = await setup();
    await expect(
      t.query(internal.codeRunsData.resolveCodeRunInput, {
        accountId,
        inputImageIds: [foreignImageId],
      }),
    ).rejects.toThrow("image not found");
  });
});

describe("run_code rate limit and run log", () => {
  it("opens and closes a run row", async () => {
    const { t, accountId } = await setup();
    const codeRunId = await t.mutation(internal.codeRunsData.beginCodeRun, {
      accountId,
      code: "print('oi')",
      description: "teste",
    });
    await t.mutation(internal.codeRunsData.finishCodeRun, {
      codeRunId,
      status: "ok",
      stdout: "oi",
      durationMs: 1200,
    });
    const run = await t.run((ctx) => ctx.db.get(codeRunId));
    expect(run).toMatchObject({ status: "ok", stdout: "oi", durationMs: 1200 });
  });

  it("only patches rows still running", async () => {
    const { t, accountId } = await setup();
    const codeRunId = await t.mutation(internal.codeRunsData.beginCodeRun, {
      accountId,
      code: "x",
      description: "d",
    });
    await t.mutation(internal.codeRunsData.finishCodeRun, { codeRunId, status: "failed" });
    await t.mutation(internal.codeRunsData.finishCodeRun, { codeRunId, status: "ok" });
    const run = await t.run((ctx) => ctx.db.get(codeRunId));
    expect(run?.status).toBe("failed");
  });

  it("enforces the per-account rate limit", async () => {
    const { t, accountId } = await setup();
    for (let i = 0; i < CODE_RUN_RATE_LIMIT; i++) {
      await t.mutation(internal.codeRunsData.beginCodeRun, {
        accountId,
        code: `print(${i})`,
        description: "loop",
      });
    }
    await expect(
      t.mutation(internal.codeRunsData.beginCodeRun, {
        accountId,
        code: "print('além')",
        description: "estouro",
      }),
    ).rejects.toThrow("muitas execuções");
  });

  it("records a code-produced image linked to its run", async () => {
    const { t, accountId } = await setup();
    const codeRunId = await t.mutation(internal.codeRunsData.beginCodeRun, {
      accountId,
      code: "x",
      description: "d",
    });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["image"])));
    const imageId = await t.mutation(internal.imagesData.savePaintedImage, {
      accountId,
      storageId,
      prompt: "texto sobre a foto",
      mimeType: "image/png",
      width: 1080,
      height: 1350,
      model: "python/pillow",
      promptAuthor: "vanda",
      codeRunId,
    });
    const image = await t.run((ctx) => ctx.db.get(imageId));
    expect(image).toMatchObject({ origin: "generated", model: "python/pillow", codeRunId });
  });
});
