import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";
import { ConnectedInstagramProvider, InstagramProviderFailed } from "../instagram/service";
import type { InstagramPost } from "../instagram/types";
import { DEFAULT_CADENCE } from "./autopilot";
import {
  auditAccount,
  classifyRejection,
  collectAccountEvidence,
  planWeek,
  type AccountEvidence,
  type AuditOutput,
  type PlanOutput,
} from "./autopilotAgent";
import { stubLanguageModelLayer } from "./testLanguageModel";

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

const auditResponse: AuditOutput = {
  summary: "Conta ativa, carrosséis vão melhor.",
  rubric: [
    { item: "nome", score: 6, max: 12, fix: "Coloque a categoria no nome" },
    { item: "atividade_recente", score: 10, max: 10, fix: "" },
  ],
  postNotes: [{ postId: "1", why: "Capa com número" }],
  findings: [{ claim: "Carrossel rende mais", evidence: "3× contra 1×", n: 3 }],
  stop: ["Promoção sem contexto"],
  doMore: ["Passo a passo"],
  needs: ["Constância"],
  recommendedCadence: [
    { weekday: 4, time: "18:00", type: "image", slideCount: 4 },
    { weekday: 2, time: "18:00", type: "carousel", slideCount: 2 },
  ],
  cadenceRationale: "Terça e quinta à noite.",
};

describe("auditAccount", () => {
  it("scores only observable rubric items and normalizes the recommended cadence", async () => {
    let prompt = "";

    const evidence: AccountEvidence = {
      profile: { handle: "padaria" },
      followers: 1200,
      posts: [],
      feedPosts: [
        { ...feedPost("1"), privateInsights: { reach: 900 } },
        { ...feedPost("2", "image"), privateInsights: { reach: 300 } },
      ],
    };

    const result = await Effect.runPromise(
      auditAccount({ brand: "Padaria em Santos", evidence, previous: [], now: NOW }).pipe(
        Effect.provide(
          stubLanguageModelLayer((input) => {
            prompt = input;

            return auditResponse;
          }),
        ),
      ),
    );

    expect(result.profileScore).toBe(73);
    expect(result.confidence).toBe("baixa");
    expect(result.top[0]?.post.id).toBe("1");
    expect(result.recommendedCadence).toEqual([
      { weekday: 2, time: "18:00", type: "carousel", slideCount: 2 },
      { weekday: 4, time: "18:00", type: "image", slideCount: 1 },
    ]);
    expect(prompt).toContain("Padaria em Santos");
    expect(prompt).toContain("rubric.json");
  });
});

describe("planWeek", () => {
  it("fills every cadence slot, keeps owner-fixed briefs and fits the slide outline", async () => {
    let prompt = "";

    const fixed = {
      purpose: "bastidores" as const,
      theme: "Forno",
      angle: "4h da manhã",
      hook: "Antes do sol nascer",
      slideOutline: ["Capa", "Forno", "Pão"],
      captionBrief: "Conte a rotina",
    };

    const response: PlanOutput = {
      strategy: "Ensinar, provar e mostrar bastidores.",
      slots: [
        {
          index: 0,
          purpose: "educacional",
          theme: "Fermentação",
          angle: "Por que o pão murcha",
          hook: "3 erros na fermentação",
          slideOutline: ["Capa", "Erro 1", "Erro 2", "Resumo"],
          captionBrief: "Peça para salvar",
        },
        {
          index: 1,
          purpose: "prova_social",
          theme: "Clientes",
          angle: "120 encomendas",
          hook: "120 encomendas em setembro",
          slideOutline: ["Print"],
          captionBrief: "Agradeça",
        },
        {
          index: 2,
          purpose: "promocional",
          theme: "ignorar",
          angle: "ignorar",
          hook: "ignorar",
          slideOutline: [],
          captionBrief: "",
        },
      ],
    };

    const plan = await Effect.runPromise(
      planWeek({
        brand: "Padaria",
        auditSummary: "Carrossel rende mais",
        cadence: DEFAULT_CADENCE,
        fixed: new Map([[2, fixed]]),
        recentThemes: ["Natal"],
        weekLabel: "12/10",
        rules: ["Não usar emojis nas legendas"],
      }).pipe(
        Effect.provide(
          stubLanguageModelLayer((input) => {
            prompt = input;

            return response;
          }),
        ),
      ),
    );

    expect(plan.briefs).toHaveLength(3);
    expect(plan.briefs[0]?.slideOutline).toEqual(["Capa", "Erro 1"]);
    expect(plan.briefs[1]?.slideOutline).toEqual(["Print"]);
    expect(plan.briefs[2]).toEqual(fixed);
    expect(prompt).toContain("REGRAS DO DONO");
    expect(prompt).toContain("Não usar emojis nas legendas");
  });
});

describe("classifyRejection", () => {
  it("sends the reason, the post and the learned rules to the model", async () => {
    let prompt = "";

    const result = await Effect.runPromise(
      classifyRejection({
        reason: "Não gosto de emoji em post de banco",
        slot: {
          type: "image",
          slideCount: 1,
          purpose: "institucional",
          theme: "Crédito",
          angle: "Rápido",
          hook: "Crédito rápido",
        },
        caption: "Crédito rápido 🚀",
        rules: ["Sem promessas de aprovação"],
      }).pipe(
        Effect.provide(
          stubLanguageModelLayer((input) => {
            prompt = input;

            return { scope: "geral", rule: "Não usar emojis", why: "preferência de tom" };
          }),
        ),
      ),
    );

    expect(result).toEqual({ scope: "geral", rule: "Não usar emojis", why: "preferência de tom" });
    expect(prompt).toContain("Não gosto de emoji em post de banco");
    expect(prompt).toContain("Sem promessas de aprovação");
  });
});
