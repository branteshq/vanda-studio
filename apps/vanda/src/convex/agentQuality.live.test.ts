// Opt-in network evaluation. Normal test runs skip it; all database state is disposable.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createThread, saveMessage } from "@convex-dev/agent";
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { brands, cases } from "../../evals/fixtures";
import { benchmarkMethods, imageBenchmarkCases } from "../../evals/imageBenchmark";
import { referenceImage } from "../../evals/references";
import {
  assertImagesWereInspected,
  assertProtectedPixelsPreserved,
  assertRejectedPaintWasReported,
  type EvalTraceStep,
} from "../../evals/assertions";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { caetano } from "./caetanoAgent";
import { requireTextModel } from "./agentModels";
import { vanda } from "./vanda";
import { messageWithImages } from "./messageImages";
import { capabilityResult } from "./resourceRefs";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const enabled = process.env.VANDA_LIVE_EVAL === "1";

const model = process.env.VANDA_EVAL_MODEL ?? "openai/gpt-5.6-terra";

const fullArtTrial = process.env.VANDA_EVAL_FULL_ART === "1";

const selected = new Set(process.env.VANDA_EVAL_CASES?.split(",").filter(Boolean));

const method = z.enum(["template", "raw"]).optional().parse(process.env.VANDA_EVAL_METHOD);

const imageModel = process.env.VANDA_EVAL_IMAGE_MODEL ?? "openai/gpt-image-2.5-flare";

const quality = z.enum(["high", "max"]).parse(process.env.VANDA_EVAL_IMAGE_QUALITY ?? "high");

const suite = (method ? imageBenchmarkCases : cases).filter((entry) =>
  selected.size ? selected.has(entry.id) : !entry.holdout,
);

const outputRoot = resolve(
  process.env.VANDA_EVAL_OUTPUT ?? "../../.amp/in/artifacts/agent-quality",
  new Date().toISOString().replaceAll(":", "-"),
);

const authSchema = z.object({
  tokens: z.object({ access_token: z.string(), refresh_token: z.string(), account_id: z.string() }),
});

it.skipIf(!enabled).each(suite)(
  "live quality: $id",
  async (entry) => {
    requireTextModel(model, true);
    const authPath = process.env.VANDA_EVAL_AUTH_FILE;

    const authJson = authPath
      ? await readFile(authPath, "utf8")
      : process.env.AMP_CODEX_CHATGPT_AUTH;

    if (!authJson)
      throw new Error(
        "Set VANDA_EVAL_AUTH_FILE or supply subscription auth in AMP_CODEX_CHATGPT_AUTH",
      );
    const auth = authSchema.parse(JSON.parse(authJson)).tokens;
    const brand = brands.find((value) => value.id === entry.brandId)!;
    const directory = resolve(outputRoot, entry.id);
    await mkdir(directory, { recursive: true });
    const t = convexTest(schema, modules);
    agentComponent.register(t);
    const startedAt = Date.now();
    const trace: EvalTraceStep[] = [];

    const imageRequests: {
      model: string;
      quality: string;
      size: string;
      prompt: string;
      references: number;
      elapsedMs: number;
      status: number;
      usage: unknown;
      returnedModel: unknown;
    }[] = [];

    const network: { host: string; path: string; status: number; error?: string }[] = [];
    const scheduleAttempts: { postId: string; scheduledFor?: string | undefined }[] = [];
    const schedules: { postId: string; scheduledFor?: string | undefined }[] = [];
    const realFetch = globalThis.fetch;
    vi.stubEnv("OPENAI_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("hex"));

    // Fail closed for external services unrelated to this evaluation. Never send publisher calls.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));

      if (url.hostname === "some-deployment.convex.cloud") {
        const bytes = await t.run(async (ctx) => {
          const rows = await ctx.db.system.query("_storage").collect();

          const row = rows.find(
            (file) =>
              url.href === `https://some-deployment.convex.cloud/api/storage/${file.sha256}`,
          );

          const blob = row ? await ctx.storage.get(row._id) : null;

          return blob ? await blob.arrayBuffer() : null;
        });

        return new Response(bytes, { status: bytes ? 200 : 404 });
      }

      if (
        url.protocol !== "data:" &&
        url.hostname !== "chatgpt.com" &&
        !url.hostname.endsWith(".e2b.dev") &&
        !url.hostname.endsWith(".e2b.app")
      )
        throw new Error(`Evaluation blocked external request to ${url.hostname}`);
      // OpenAI can fetch real Convex URLs, but not convex-test's synthetic storage host.
      // Inline those same bytes on the wire without changing the tools' output shape.
      const body = z.string().safeParse(init?.body);

      if (url.hostname === "chatgpt.com" && body.success) {
        let encoded = body.data;

        for (const storageUrl of new Set(
          encoded.match(/https:\/\/some-deployment\.convex\.cloud\/api\/storage\/[^"\\\s]+/g),
        )) {
          const file = await fetch(storageUrl);

          if (!file.ok) throw new Error("Missing evaluation image");
          encoded = encoded.replaceAll(
            storageUrl,
            `data:image/png;base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
          );
        }

        init = { ...init, body: encoded };
      }

      const isImage =
        url.hostname === "chatgpt.com" && /\/images\/(generations|edits)$/.test(url.pathname);

      const imagePayload = isImage ? JSON.parse(String(init?.body)) : undefined;

      if (imagePayload) {
        imagePayload.quality = quality;
        init = { ...init, body: JSON.stringify(imagePayload) };
      }

      const requestStarted = Date.now();
      const response = await realFetch(input, init);

      if (imagePayload) {
        const metadata = response.ok ? await response.clone().json() : {};
        imageRequests.push({
          model: imagePayload.model,
          quality: imagePayload.quality,
          size: imagePayload.size,
          prompt: imagePayload.prompt,
          references: imagePayload.images?.length ?? 0,
          elapsedMs: Date.now() - requestStarted,
          status: response.status,
          usage: metadata.usage ?? null,
          returnedModel: metadata.model ?? null,
        });
      }

      if (url.protocol !== "data:") {
        const request = { host: url.hostname, path: url.pathname, status: response.status };
        network.push(
          response.ok
            ? request
            : { ...request, error: (await response.clone().text()).slice(0, 2000) },
        );
      }

      return response;
    });

    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Fictional owner",
        email: "fixture@example.invalid",
        clerkId: "eval",
        planId: "conectado",
        orchestratorModel: model,
        caetanoModel: model,
        imageModel,
      });

      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        name: brand.name,
        handle: brand.handle.replace(/^@/, ""),
        onboardedAt: startedAt,
        createdAt: startedAt,
        updatedAt: startedAt,
      });

      await ctx.db.patch(userId, { activeAccountId: accountId });

      for (const text of brand.facts)
        await ctx.db.insert("brandCanon", {
          accountId,
          kind: "offer",
          text,
          confirmedByOwner: true,
          createdAt: startedAt,
        });

      return { userId, accountId };
    });

    // Keep the real typed scheduling schema, but replace execution, not just the publisher API.
    vi.spyOn(vanda.options.tools!.schedule_post, "execute").mockImplementation(async (raw) => {
      const input = z
        .object({ postId: z.string(), scheduledFor: z.string().optional() })
        .parse(raw);

      scheduleAttempts.push(input);

      return await t.run(async (ctx) => {
        const postId = ctx.db.normalizeId("posts", input.postId);

        if (!postId || (await ctx.db.get(postId))?.accountId !== ids.accountId)
          throw new Error("post not found");

        if (!input.scheduledFor) throw new Error("Immediate publishing disabled in evaluations");
        await ctx.db.patch(postId, { status: "scheduled" });

        const scheduled = await ctx.db
          .query("scheduledPosts")
          .withIndex("by_post", (q) => q.eq("postId", postId))
          .unique();

        if (!scheduled) throw new Error("Evaluation expects an existing schedule");
        await ctx.db.patch(scheduled._id, {
          scheduledFor: Date.parse(input.scheduledFor),
          updatedAt: Date.now(),
        });
        schedules.push(input);

        return capabilityResult({
          postId,
          scheduledPostId: scheduled._id,
          scheduledFor: Date.parse(input.scheduledFor),
          rescheduled: true,
          status: "scheduled",
        });
      });
    });

    if (entry.id === "orvalho-tool-failure")
      vi.spyOn(vanda.options.tools!.paint, "execute").mockRejectedValue(
        new Error("Gerador temporariamente indisponível; nenhuma imagem criada"),
      );

    const streamVanda = vanda.streamText.bind(vanda);
    vi.spyOn(vanda, "streamText").mockImplementation(async (ctx, thread, options, persistence) => {
      const system =
        (options.system ?? "") +
        (method
          ? `\n\n${benchmarkMethods[method]}\nEntregue rascunho, sem publicar. Inspecione todos os slides. Máximo de duas rodadas de correções concretas.`
          : "") +
        (fullArtTrial
          ? "\n\nExperimento de produção: para novas peças, use paint para gerar a arte COMPLETA, inclusive tipografia, marca e preço. Isto substitui a regra de separar texto em Python. Planeje a hierarquia, passe a grafia exata, inspecione o resultado e corrija erros concretos. Não use run_code só por hábito; reserve para precisão exigida ou correção localizada."
          : "");

      trace.push({ agent: "vanda", system });

      return streamVanda(
        ctx,
        thread,
        {
          ...options,
          system,
          onStepFinish: async (step) => {
            trace.push({
              agent: "vanda",
              text: step.text,
              calls: step.toolCalls,
              results: step.toolResults,
              errors: step.content
                .filter((part) => part.type === "tool-error")
                .map((part) => ({
                  toolName: part.toolName,
                  message: part.error instanceof Error ? part.error.message : String(part.error),
                })),
              usage: step.usage,
            });
          },
        },
        persistence,
      );
    });
    const streamCaetano = caetano.streamText.bind(caetano);
    vi.spyOn(caetano, "streamText").mockImplementation(
      async (ctx, thread, options, persistence) => {
        trace.push({ agent: "caetano", system: options.system });

        return streamCaetano(
          ctx,
          thread,
          {
            ...options,
            onStepFinish: async (step) => {
              trace.push({
                agent: "caetano",
                text: step.text,
                calls: step.toolCalls,
                results: step.toolResults,
                errors: step.content
                  .filter((part) => part.type === "tool-error")
                  .map((part) => ({
                    toolName: part.toolName,
                    message: part.error instanceof Error ? part.error.message : String(part.error),
                  })),
                usage: step.usage,
              });
            },
          },
          persistence,
        );
      },
    );

    let response = "";

    try {
      await t.action(internal.openaiSubNode.encryptAndStore, {
        clerkId: "eval",
        access: auth.access_token,
        refresh: auth.refresh_token,
        expiresAt: Date.now() + 3_600_000,
        accountId: auth.account_id,
      });

      for (const [path, content] of [
        ["/brand/kit.json", JSON.stringify(brand.kit)],
        ["/brand/notes.md", brand.notes],
        ["/memory/preferences.md", brand.preferences],
      ])
        await t.mutation(internal.workspaceData.write, {
          accountId: ids.accountId,
          path: path!,
          content: content!,
        });

      const attachments: { imageId: Id<"images">; url: string; mimeType: string }[] = [];

      let referenceBytes: Uint8Array | undefined;
      let referenceImageId: Id<"images"> | undefined;

      if (entry.kind === "revision") {
        const bytes = referenceImage(entry.referenceId ?? entry.id);
        referenceBytes = bytes;
        await writeFile(resolve(directory, "reference.png"), bytes);
        const url = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

        const imageId = await t.run((ctx) =>
          ctx.db.insert("images", {
            accountId: ids.accountId,
            name: "Peça anterior",
            origin: "uploaded",
            purpose: "post",
            externalUrl: url,
            mimeType: "image/png",
            width: 1024,
            height: 1280,
            createdAt: startedAt,
          }),
        );

        referenceImageId = imageId;
        attachments.push({ imageId, url, mimeType: "image/png" });
      }

      const turn = await t.run(async (ctx) => {
        if (entry.history) {
          const olderThread = await createThread(ctx, components.agent, {
            userId: ids.accountId,
            title: "Decisões e peças anteriores",
          });

          for (const message of entry.history)
            await saveMessage(ctx, components.agent, {
              threadId: olderThread,
              message: { role: message.role, content: message.text },
            });
        }

        if (entry.id === "prumo-explicit-reschedule") {
          const postId = await ctx.db.insert("posts", {
            accountId: ids.accountId,
            type: "image",
            imageIds: [],
            caption: "Prateleira firme",
            platform: "instagram",
            status: "scheduled",
            createdAt: startedAt,
          });

          await ctx.db.insert("scheduledPosts", {
            accountId: ids.accountId,
            postId,
            scheduledFor: Date.parse("2026-09-21T10:00:00-03:00"),
            status: "scheduled",
            createdAt: startedAt,
            updatedAt: startedAt,
          });
        }

        const threadId = await createThread(ctx, components.agent, {
          userId: entry.agent === "caetano" ? `caetano:${ids.userId}` : ids.accountId,
          title: entry.id,
        });

        const saved = await saveMessage(ctx, components.agent, {
          threadId,
          message: { role: "user", content: messageWithImages(entry.prompt, attachments) },
        });

        // Mirrors caetano.sendMessage's attachment contract. Calling that public mutation here
        // would also schedule startNext, racing this harness's explicitly traced action.
        if (entry.agent === "caetano" && attachments.length > 0) {
          await ctx.runMutation(internal.threadResources.record, {
            threadId,
            anchorMessageId: saved.messageId,
            toolCallId: `attachments:${saved.messageId}`,
            resources: attachments.map(({ imageId }) => ({
              kind: "image" as const,
              accountId: ids.accountId,
              imageId,
            })),
            presented: [],
          });

          for (const { imageId } of attachments)
            await ctx.db.patch(imageId, { lastAttachedAt: startedAt });
        }

        return { threadId, promptMessageId: saved.messageId };
      });

      if (entry.agent === "caetano") {
        if (attachments.length > 0) {
          const ingress = await t.query(internal.threadResources.forPrompt, {
            threadId: turn.threadId,
            anchorMessageId: turn.promptMessageId,
          });

          expect(ingress.resources).toEqual([
            { kind: "image", accountId: ids.accountId, imageId: referenceImageId },
          ]);
        }

        const activityId = await t.run(async (ctx) => {
          await ctx.db.patch(ids.userId, { caetanoThreadId: turn.threadId });

          const inboxId = await ctx.db.insert("caetanoInbox", {
            ...turn,
            userId: ids.userId,
            channel: "web",
            status: "running",
          });

          return ctx.db.insert("caetanoThreadActivity", {
            ...turn,
            userId: ids.userId,
            inboxId,
            startedAt,
          });
        });

        response = await t.action(internal.caetano.generateResponse, {
          ...turn,
          userId: ids.userId,
          activityId,
        });
      } else {
        const activityId = await t.run((ctx) =>
          ctx.db.insert("chatThreadActivity", {
            ...turn,
            accountId: ids.accountId,
            startedAt,
          }),
        );

        response = await t.action(internal.chat.generateResponse, {
          ...turn,
          accountId: ids.accountId,
          activityId,
        });
      }

      const state = await t.run(async (ctx) => ({
        posts: await ctx.db.query("posts").collect(),
        images: await ctx.db.query("images").collect(),
        runs: await ctx.db.query("codeRuns").collect(),
        artifacts: await ctx.db.query("codeRunArtifacts").collect(),
      }));

      const imageBytes = new Map<string, Uint8Array>();

      for (const image of state.images) {
        if (image.externalUrl?.startsWith("data:image/")) {
          imageBytes.set(image._id, Buffer.from(image.externalUrl.split(",")[1]!, "base64"));
        }

        if (!image.storageId) continue;

        const bytes = await t.run(async (ctx) => {
          const blob = await ctx.storage.get(image.storageId!);

          return blob ? await blob.arrayBuffer() : null;
        });

        if (bytes) {
          const output = new Uint8Array(bytes);
          imageBytes.set(image._id, output);
          await writeFile(resolve(directory, `${image._id}.png`), output);
        }
      }

      await writeFile(
        resolve(directory, "result.json"),
        JSON.stringify(
          {
            entry,
            brand,
            model,
            imageModel,
            quality,
            method,
            imageRequests,
            fullArtTrial,
            transport: "chatgpt-subscription",
            elapsedMs: Date.now() - startedAt,
            response,
            scheduleAttempts,
            schedules,
            network,
            state,
            trace,
            fixtureHash: createHash("sha256")
              .update(JSON.stringify({ entry, brand }))
              .digest("hex"),
            tasteLabel: null,
            reviewReason: null,
          },
          (_key, value) => {
            const imageUrl = z.string().startsWith("data:image/").safeParse(value);

            return imageUrl.success ? "[image bytes saved separately]" : value;
          },
          2,
        ),
      );
      console.info(`Evaluation artifact: ${directory}`);
      expect(response).not.toBe("");
      expect(response).not.toContain("Algo deu errado");
      expect(network.filter((request) => request.status >= 400)).toEqual([]);

      if (entry.kind === "creative" || entry.id === "caju-date-is-brief") {
        expect(state.posts).toHaveLength(1);
        expect(state.posts[0]?.status).toBe("draft");
        expect(state.posts[0]?.imageIds.length).toBeGreaterThan(0);

        if (entry.id === "orvalho-product-draft") expect(state.posts[0]?.imageIds).toHaveLength(3);
        const benchmark = imageBenchmarkCases.find((item) => item.id === entry.id);

        if (benchmark) expect(state.posts[0]?.imageIds).toHaveLength(benchmark.slides);
      }

      if (method === "raw") expect(state.runs).toHaveLength(0);

      if (method === "template") {
        expect(state.runs.length).toBeGreaterThan(0);

        if (entry.kind === "creative") {
          const templateReads = trace
            .flatMap((step) => step.calls ?? [])
            .filter((call) => {
              const input = z.object({ path: z.string() }).safeParse(call.input);

              return (
                call.toolName === "read" &&
                input.success &&
                /^\/skills\/post-instagram-template\/assets\/py\/.+\.py$/.test(input.data.path)
              );
            });

          expect(templateReads.length, "read an actual template script").toBeGreaterThan(0);
        }
      }

      const finalImageIds = state.posts.flatMap((post) => post.imageIds);

      if (entry.kind === "revision") {
        expect(state.images.length).toBeGreaterThan(1);

        const revised = state.images
          .toReversed()
          .find((image) => image._id !== referenceImageId && imageBytes.has(image._id));

        expect(revised, "revision must produce a decodable image").toBeDefined();
        finalImageIds.push(revised!._id);

        await assertProtectedPixelsPreserved(
          entry.referenceId ?? entry.id,
          referenceBytes!,
          imageBytes.get(revised!._id)!,
        );
      }

      if (entry.id === "orvalho-tool-failure") {
        expect(state.images).toEqual([]);
        expect(vanda.options.tools!.paint.execute).toHaveBeenCalled();
        assertRejectedPaintWasReported(trace, response);
      }

      if (entry.kind === "creative" || entry.kind === "revision")
        assertImagesWereInspected(trace, finalImageIds);

      if (entry.agent === "caetano")
        expect(trace.some((step) => step.agent === "vanda")).toBe(false);

      if (entry.id === "pimba-past-preference") expect(response).toContain("Bora rabiscar?");

      if (entry.id === "prumo-history-recall")
        expect([response, ...state.posts.map((post) => post.caption)].join("\n")).toContain(
          "Chame a Prumo para avaliar",
        );

      if (entry.id !== "prumo-explicit-reschedule") expect(scheduleAttempts).toEqual([]);
      else {
        expect(schedules).toHaveLength(1);
        expect(Date.parse(schedules[0]?.scheduledFor ?? "")).toBe(
          Date.parse("2026-09-22T17:00:00Z"),
        );
      }
    } catch (error) {
      await writeFile(
        resolve(directory, "failure.json"),
        JSON.stringify(
          {
            entry,
            model,
            imageModel,
            method,
            quality,
            imageRequests,
            network,
            trace,
            elapsedMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          },
          (_key, value) => {
            const imageUrl = z.string().startsWith("data:image/").safeParse(value);

            return imageUrl.success ? "[image bytes omitted]" : value;
          },
          2,
        ),
      );
      throw error;
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  },
  600_000,
);
