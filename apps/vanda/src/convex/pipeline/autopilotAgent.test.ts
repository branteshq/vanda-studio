import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";
import { ConnectedInstagramProvider, InstagramProviderFailed } from "../instagram/service";
import type { InstagramPost } from "../instagram/types";
import {
  collectAccountEvidence,
  fitOutline,
  measureAccount,
  type AccountEvidence,
} from "./autopilotAgent";

const NOW = Date.UTC(2026, 9, 7, 18, 0);

const target = { scope: "connected" as const, publisherUsername: "acc1", handle: "padaria" };

const feedPost = (
  id: string,
  mediaType: InstagramPost["mediaType"] = "carousel",
): InstagramPost => ({
  id,
  url: `https://instagram.com/p/${id}`,
  mediaType,
  publicEngagement: {},
  caption: `post ${id}`,
  publishedAt: NOW - Number(id) * 86_400_000,
});

const providerLayer = (reach: Record<string, number>) =>
  Layer.succeed(ConnectedInstagramProvider, {
    readProfile: () =>
      Effect.succeed({ data: { handle: "padaria", followers: 1200 }, completeness: "partial" }),
    listPosts: () =>
      Effect.succeed({
        data: [feedPost("1"), feedPost("2", "image"), feedPost("3", "video"), feedPost("4")],
        completeness: "complete",
      }),
    listComments: () => Effect.succeed({ data: [], completeness: "complete" }),
    readInsights: (_target, postId) =>
      postId === "4"
        ? Effect.fail(
            new InstagramProviderFailed({
              provider: "upload_post",
              operation: "post_analytics",
              message: "no insights",
            }),
          )
        : Effect.succeed({
            data: {
              kind: "post",
              postId: postId ?? "",
              publicEngagement: { shares: 3 },
              privateInsights: { reach: reach[postId ?? ""] ?? 0, saves: 5 },
            },
            completeness: "complete",
          }),
  });

describe("collectAccountEvidence", () => {
  it("merges per-post insights and keeps posts whose insights failed", async () => {
    const evidence = await Effect.runPromise(
      collectAccountEvidence(target).pipe(Effect.provide(providerLayer({ "1": 900, "2": 300 }))),
    );

    expect(evidence.followers).toBe(1200);
    expect(evidence.feedPosts.map((post) => post.id)).toEqual(["1", "2", "4"]);
    expect(evidence.posts.find((post) => post.id === "1")?.privateInsights?.reach).toBe(900);
    expect(evidence.posts.find((post) => post.id === "4")?.privateInsights).toBeUndefined();
  });
});

describe("measureAccount", () => {
  it("ranks posts by multiple of the median and states low confidence for few posts", () => {
    const evidence: AccountEvidence = {
      profile: { handle: "padaria" },
      followers: 1200,
      posts: [],
      feedPosts: [
        { ...feedPost("1"), privateInsights: { reach: 900 } },
        { ...feedPost("2", "image"), privateInsights: { reach: 300 } },
      ],
    };

    const measured = measureAccount(evidence, NOW);

    expect(measured.basis).toBe("reach");
    expect(measured.confidence).toBe("baixa");
    expect(measured.top[0]?.post.id).toBe("1");
    expect(measured.bottom[0]?.post.id).toBe("2");
  });
});

describe("fitOutline", () => {
  it("keeps one line per slide, dropping blanks and padding with the hook", () => {
    expect(fitOutline(["Capa", "", "Erro 1", "Erro 2"], 2, "Gancho")).toEqual(["Capa", "Erro 1"]);
    expect(fitOutline([], 2, "Gancho")).toEqual(["Gancho", "Resumo e chamada"]);
  });
});
