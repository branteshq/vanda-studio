import { describe, expect, it } from "vitest";
import type { Id } from "./_generated/dataModel";
import { capabilityResult, dedupeResources, threadResourceSchema } from "./resourceRefs";

describe("thread resources", () => {
  it("validates the channel-neutral resource variants", () => {
    expect(
      threadResourceSchema.parse({
        kind: "document",
        accountId: "account",
        path: "/runs/report/outputs/result.csv",
        title: "Resultado",
      }),
    ).toMatchObject({ kind: "document", path: "/runs/report/outputs/result.csv" });
  });

  it("keeps model context separate from resources presented to the user", () => {
    // SAFETY: Convex IDs are opaque strings; these fixed non-empty IDs are used only as fixture identities.
    const accountId = "account" as Id<"accounts">;

    // SAFETY: Convex IDs are opaque strings; this fixed non-empty ID is used only as a fixture identity.
    const imageId = "image" as Id<"images">;

    const image = {
      kind: "image" as const,
      accountId,
      imageId,
    };

    const result = capabilityResult({ ok: true }, { resources: [image] });
    expect(result.resources).toEqual([image]);
    expect(result.presented).toEqual([]);
  });

  it("deduplicates stable resource identities", () => {
    const resource = {
      kind: "link" as const,
      url: "https://app.vandastudio.app/conversa",
      title: "Conversa",
    };

    expect(dedupeResources([resource, resource])).toEqual([resource]);
  });
});
