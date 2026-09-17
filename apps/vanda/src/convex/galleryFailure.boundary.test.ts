// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "gallery-owner",
      name: "Gallery owner",
      email: "gallery@example.com",
    });
    const accountId = await ctx.db.insert("accounts", {
      ownerUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    const insertFailure = (fields: {
      generationError?: string;
      generationErrorCode?: "UNAVAILABLE";
    }) =>
      ctx.db.insert("images", {
        accountId,
        origin: "generated",
        status: "failed",
        ...fields,
        createdAt: now,
      });
    const codedId = await insertFailure({ generationErrorCode: "UNAVAILABLE" });
    const knownLegacyId = await insertFailure({ generationError: "RECONNECT_REQUIRED" });
    const rawLegacyId = await insertFailure({
      generationError: "provider leaked diagnostic: key=secret",
    });
    const scheduledId = await ctx.db.insert("images", {
      accountId,
      origin: "generated",
      status: "generating",
      createdAt: now,
    });
    return { accountId, codedId, knownLegacyId, rawLegacyId, scheduledId };
  });
  return { t, ...ids };
};

describe("gallery generation failure transport", () => {
  it("returns only catalog codes and maps raw legacy diagnostics to UNEXPECTED", async () => {
    const { t, accountId, codedId, knownLegacyId, rawLegacyId } = await setup();
    const result = await t.withIdentity({ subject: "gallery-owner" }).query(api.gallery.list, {
      accountId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const byId = new Map(result.page.map((item) => [item.id, item]));

    expect(byId.get(codedId)?.generationErrorCode).toBe("UNAVAILABLE");
    expect(byId.get(knownLegacyId)?.generationErrorCode).toBe("RECONNECT_REQUIRED");
    expect(byId.get(rawLegacyId)?.generationErrorCode).toBe("UNEXPECTED");
    expect(JSON.stringify(result)).not.toContain("provider leaked diagnostic");
    expect(result.page.every((item) => !("generationError" in item))).toBe(true);
  });

  it("keeps old scheduled arguments safe without parsing diagnostic text", async () => {
    const { t, scheduledId } = await setup();
    await t.mutation(internal.imagesData.markPaintFailed, {
      imageId: scheduledId,
      error: "quota exceeded while calling provider",
    });
    const image = await t.run((ctx) => ctx.db.get(scheduledId));

    expect(image?.generationErrorCode).toBe("UNEXPECTED");
    expect(image?.generationError).toBeUndefined();
  });

  it.each(["USAGE_LIMIT", "RECONNECT_REQUIRED", "UNAVAILABLE"] as const)(
    "retains the known %s code",
    async (generationErrorCode) => {
      const { t, scheduledId } = await setup();
      await t.mutation(internal.imagesData.markPaintFailed, {
        imageId: scheduledId,
        generationErrorCode,
      });
      expect((await t.run((ctx) => ctx.db.get(scheduledId)))?.generationErrorCode).toBe(
        generationErrorCode,
      );
    },
  );
});
