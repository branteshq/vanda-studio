import { describe, expect, it } from "vitest";
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
    const image = {
      kind: "image" as const,
      accountId: "account" as never,
      imageId: "image" as never,
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
