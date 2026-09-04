// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("thread resource manifests", () => {
  it("deduplicates resources across a turn and updates retried tool calls", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.run((ctx) =>
      ctx.db.insert("accounts", {
        name: "Conta",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const imageId = await t.run((ctx) =>
      ctx.db.insert("images", {
        accountId,
        origin: "generated",
        purpose: "post",
        createdAt: Date.now(),
      }),
    );
    const image = { kind: "image" as const, accountId, imageId };

    await t.mutation(internal.threadResources.record, {
      threadId: "thread",
      anchorMessageId: "prompt",
      toolCallId: "paint-1",
      resources: [image],
      presented: [image],
    });
    await t.mutation(internal.threadResources.record, {
      threadId: "thread",
      anchorMessageId: "prompt",
      toolCallId: "paint-1",
      resources: [image, image],
      presented: [image, image],
    });

    const manifest = await t.query(internal.threadResources.forPrompt, {
      threadId: "thread",
      anchorMessageId: "prompt",
    });
    expect(manifest.resources).toEqual([image]);
    expect(manifest.presented).toEqual([image]);
    expect(await t.run((ctx) => ctx.db.query("threadResourceManifests").collect())).toHaveLength(1);
  });
});
