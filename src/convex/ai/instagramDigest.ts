"use node";

import { v } from "convex/values";
import { z } from "zod";
import { Effect } from "effect";
import { action, internalAction } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { TextGeneration, MODELS, runAiEffectOrThrow } from "./llm/index";

const DIGEST_MODEL = MODELS.KIMI_K2;

const llmBoundedStr = (max: number) =>
    z.preprocess((val) => {
        if (val == null) return "";
        if (typeof val === "string") return val.length > max ? val.slice(0, max) : val;
        return "";
    }, z.string().max(max));

const InstagramDigestSchema = z.object({
    recentThemes: z.array(z.string().max(120)).max(20),
    recentHooks: z.array(z.string().max(120)).max(12),
    avoidNext: z.array(z.string().max(200)).max(12),
    summaryForModel: llmBoundedStr(900).describe(
        "2-4 short sentences in Brazilian Portuguese summarizing recent content for downstream LLM prompts"
    ),
});

function buildCaptionBlock(
    snippets: { caption: string; timestamp: string }[]
): string {
    return snippets
        .map((s, i) => `[${i}] ${s.timestamp}\n${s.caption.slice(0, 1500)}`)
        .join("\n---\n");
}

async function runDigestLlm(captionBlock: string) {
    const system = `You are a social media analyst. Read Instagram post captions and output a single JSON object.

CRITICAL — property names MUST be exactly these four English keys (never translate keys to Portuguese):
- "recentThemes": array of short strings
- "recentHooks": array of short strings (recurring hooks/formats; flatten ideas into separate strings)
- "avoidNext": array of short strings (campaigns/holidays/angles to not repeat immediately)
- "summaryForModel": one string, 2-4 sentences

All string VALUES must be Brazilian Portuguese (pt-BR). Keys stay English as above.
Each of recentThemes, recentHooks, avoidNext MUST be a JSON array of strings, not objects.

Infer only from the captions; do not invent posts.`;

    const user = `## Legendas (mais recentes primeiro; índice 0 = mais novo)\n${captionBlock}\n\nResponda só com JSON. Chaves obrigatórias em inglês: recentThemes, recentHooks, avoidNext, summaryForModel.`;

    return await runAiEffectOrThrow(
        Effect.gen(function* () {
            const textGen = yield* TextGeneration;
            return yield* textGen.generateStructured({
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                schema: InstagramDigestSchema,
                model: DIGEST_MODEL,
                temperature: 0.35,
                maxTokens: 2048,
            });
        })
    );
}

export const rebuildDigestInternal = internalAction({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const snippets = await ctx.runQuery(internal.socialPosts.listCaptionSnippetsForDigestInternal, {
            projectId: args.projectId,
            limit: 30,
        });

        const withText = snippets.filter((s: { caption: string }) => s.caption.length > 0);
        if (withText.length === 0) {
            await ctx.runMutation(internal.projects.setInstagramContentDigestInternal, {
                projectId: args.projectId,
                digest: null,
            });
            return { ok: true as const, skipped: true, reason: "no_captions" as const };
        }

        const captionBlock = buildCaptionBlock(withText);

        try {
            const out = await runDigestLlm(captionBlock);
            const now = Date.now();
            await ctx.runMutation(internal.projects.setInstagramContentDigestInternal, {
                projectId: args.projectId,
                digest: {
                    recentThemes: out.recentThemes,
                    recentHooks: out.recentHooks,
                    avoidNext: out.avoidNext,
                    summaryForModel: out.summaryForModel,
                    postsAnalyzed: withText.length,
                    updatedAt: now,
                },
            });
            return { ok: true as const, skipped: false };
        } catch (e) {
            console.error("[instagramDigest] rebuild failed", e);
            return { ok: false as const, error: String(e) };
        }
    },
});

/** User-triggered rebuild (auth checked via projects.get). */
export const regenerateForProject = action({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args): Promise<{ ok: boolean; skipped?: boolean; error?: string }> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Não autenticado");

        const project = await ctx.runQuery(api.projects.get, { projectId: args.projectId });
        if (!project) throw new Error("Projeto não encontrado");

        return await ctx.runAction(internal.ai.instagramDigest.rebuildDigestInternal, {
            projectId: args.projectId,
        });
    },
});
