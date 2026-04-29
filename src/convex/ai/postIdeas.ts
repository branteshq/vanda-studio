"use node";

import { v } from "convex/values";
import { z } from "zod";
import { Effect } from "effect";
import { action, type ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { TextGeneration, MODELS, DEFAULT_IMAGE_MODEL, runAiEffectOrThrow } from "./llm/index";
import {
    estimateCaptionUsage,
    estimateImageBatchUsage,
    estimateImageLineItem,
    sumUsageLineItemCredits,
} from "../../lib/billing/aiCredits";
import { refundAiUsage, reserveAiUsage } from "../billing/autumnUsage";
import { persistSingleGeneratedImage } from "./imageGenerationPersist";
import { coerceImageGenerationSettings } from "../../lib/studio/imageGenerationCapabilities";

const POST_IDEAS_MODEL = MODELS.KIMI_K2;
const LAUNCH_POST_COUNT = 5;
const LAUNCH_POST_HOUR = 12;
const LAUNCH_POST_MINUTE = 0;
const LAUNCH_POST_REMINDER_MINUTES = 30;
const SAO_PAULO_OFFSET_HOURS = -3;
const LAUNCH_POST_ASPECT_RATIO = "3:4";
const LAUNCH_POST_RESOLUTION = "standard";

type InstagramSnippet = {
    _id: Id<"social_posts">;
    caption: string;
    timestamp: string;
};

type RecommendationContextPost = {
    caption?: string;
    mediaType: string;
    publishedAt: number;
    likeCount?: number;
    commentsCount?: number;
    engagementScore?: number;
    intelligence?: {
        topic: string;
        hook: string;
        format: string;
        visualSignals: string[];
        performanceNotes: string[];
        recommendationWeight: number;
        analyzedAt: number;
    };
};

const llmBoundedStr = (max: number) =>
    z.preprocess((val) => {
        if (val == null) return undefined;
        if (typeof val === "string") return val.length > max ? val.slice(0, max) : val;
        return undefined;
    }, z.string().max(max));

const PostIdeaSchema = z.object({
    title: llmBoundedStr(120).optional().describe("Short working title for the idea, pt-BR"),
    caption: llmBoundedStr(2200).describe("Full Instagram caption in pt-BR, ready to publish"),
    reasoning: llmBoundedStr(500)
        .optional()
        .describe("Why this idea fits the brand and differs from recent posts"),
    imagePrompt: llmBoundedStr(900).describe(
        "English image generation brief aligned with the caption and brand visual rules"
    ),
    sourcePostIndices: z
        .array(z.number().int().min(0).max(49))
        .max(6)
        .optional()
        .describe("Indices of Instagram posts this idea builds on, or omits if none"),
});

type PostIdea = z.infer<typeof PostIdeaSchema>;

const PostIdeasResponseSchema = z.object({
    ideas: z.array(PostIdeaSchema).min(1).max(5),
});

function projectContextBlock(project: Doc<"projects">): string {
    if (project.brandContextMarkdown?.trim()) {
        return `## Contexto da marca (markdown)\n${project.brandContextMarkdown.trim()}`;
    }
    const parts: string[] = [`Nome: ${project.name}`];
    if (project.accountDescription) parts.push(`Descrição: ${project.accountDescription}`);
    if (project.brandTraits?.length) parts.push(`Traços: ${project.brandTraits.join(", ")}`);
    if (project.additionalContext) parts.push(`Contexto extra: ${project.additionalContext}`);
    if (project.brandKit) {
        const k = project.brandKit;
        if (k.elevatorPitch) parts.push(`Pitch: ${k.elevatorPitch}`);
        if (k.whatWeSell) parts.push(`Oferta: ${k.whatWeSell}`);
        if (k.whoWeServe) parts.push(`Público: ${k.whoWeServe}`);
        if (k.toneAdjectives?.length) parts.push(`Tom: ${k.toneAdjectives.join(", ")}`);
    }
    return `## Contexto do projeto\n${parts.join("\n")}`;
}

function digestSection(d: NonNullable<Doc<"projects">["instagramContentDigest"]>): string {
    const lines = [
        "## O que já apareceu no Instagram (digest automático)",
        d.summaryForModel,
        "",
        `Temas recentes: ${d.recentThemes.length ? d.recentThemes.join(", ") : "(nenhum)"}`,
        `Ganchos/formatos: ${d.recentHooks.length ? d.recentHooks.join(", ") : "(nenhum)"}`,
        `Evitar repetir em seguida: ${d.avoidNext.length ? d.avoidNext.join(" | ") : "(nada específico)"}`,
    ];
    return lines.join("\n");
}

function brandIntelligenceSection(
    intelligence: NonNullable<Doc<"projects">["brandIntelligence"]>
): string {
    return [
        "## Inteligência de marca gerada pela Vanda",
        intelligence.summary,
        `Pilares de conteúdo: ${intelligence.contentPillars.join(", ")}`,
        `Sinais de audiência: ${intelligence.audienceSignals.join(", ") || "(nenhum)"}`,
        `Direção visual: ${intelligence.visualDirection.join(", ") || "(nenhuma)"}`,
        `Notas para recomendações: ${intelligence.recommendationNotes.join(" | ") || "(nenhuma)"}`,
    ].join("\n");
}

function buildSnippetsPrompt(snippets: InstagramSnippet[]): string {
    if (snippets.length === 0) return "(Nenhuma legenda sincronizada — não invente posts passados.)";
    return snippets
        .map((s, i) => `[${i}] (${s.timestamp})\n${s.caption.slice(0, 1200)}`)
        .join("\n---\n");
}

function buildRecommendationContextPrompt(posts: RecommendationContextPost[]): string {
    if (posts.length === 0) {
        return "(Sem posts importados com métricas suficientes ainda.)";
    }
    return posts.map((post, index) => {
        const intelligence = post.intelligence;
        return [
            `[${index}] ${new Date(post.publishedAt).toISOString()} ${post.mediaType}`,
            `Métricas: likes=${post.likeCount ?? "?"}, comments=${post.commentsCount ?? "?"}, engagement=${post.engagementScore ?? "?"}`,
            intelligence
                ? `Análise: tema=${intelligence.topic}; gancho=${intelligence.hook}; formato=${intelligence.format}; peso=${intelligence.recommendationWeight}`
                : null,
            intelligence?.performanceNotes.length
                ? `Aprendizados: ${intelligence.performanceNotes.join(" | ")}`
                : null,
            post.caption ? `Legenda: ${post.caption.slice(0, 700)}` : null,
        ].filter(Boolean).join("\n");
    }).join("\n---\n");
}

function buildIdeasUserPrompt(args: {
    project: Doc<"projects">;
    snippets: InstagramSnippet[];
    recommendationPosts: RecommendationContextPost[];
    userIntent: string | undefined;
    avoidRecentThemes: boolean | undefined;
    extraExclusions: string | undefined;
    count: number;
}) {
    const avoid = args.avoidRecentThemes !== false;
    const digest = args.project.instagramContentDigest;

    let user = projectContextBlock(args.project);
    user += "\n\n";
    if (digest) {
        user += `${digestSection(digest)}\n\n`;
    } else {
        user +=
            "## Instagram\nNão há digest ainda — sincronize o Instagram do projeto para a Vanda evitar repetir temas recentes.\n\n";
    }

    if (args.project.brandIntelligence) {
        user += `${brandIntelligenceSection(args.project.brandIntelligence)}\n\n`;
    }

    user += `## Amostra de legendas (índice 0 = mais recente)\n${buildSnippetsPrompt(args.snippets)}\n\n`;

    const recommendationContext = args.project.brandIntelligence
        ? "Use a inteligência de marca acima como filtro principal das recomendações."
        : "Use principalmente as legendas e métricas abaixo para inferir padrões.";
    user += `## Posts com métricas e análises para aprender recomendações\n${recommendationContext}\n${buildRecommendationContextPrompt(args.recommendationPosts)}\n\n`;

    if (args.userIntent?.trim()) {
        user += `## Pedido do usuário\n${args.userIntent.trim()}\n\n`;
    }
    if (args.extraExclusions?.trim()) {
        user += `## Exclusões explícitas do usuário\n${args.extraExclusions.trim()}\n\n`;
    }

    user += `## Tarefa\nGere exatamente ${args.count} ideias de posts NOVOS para Instagram em pt-BR.\n`;
    if (avoid && digest) {
        user +=
            "Não repita campanhas, datas comemorativas ou ângulos listados em 'Evitar repetir' nem duplique os temas recentes, salvo se o usuário pediu explicitamente o contrário acima.\n";
    } else if (avoid) {
        user +=
            "Evite repetir assuntos óbvios que já aparecem nas legendas da amostra; traga ângulos frescos.\n";
    }
    user +=
        "Cada legenda deve soar natural no feed do criador. imagePrompt em inglês para modelo de imagem.\n";
    user += "Use sourcePostIndices apenas se a ideia ecoar posts específicos da lista (opcional).\n";

    return user;
}

async function generateIdeasWithModel(
    ctx: ActionCtx,
    args: {
        projectId: Id<"projects">;
        userIntent: string | undefined;
        avoidRecentThemes: boolean | undefined;
        extraExclusions: string | undefined;
        count: number;
    }
): Promise<{ project: Doc<"projects">; snippets: InstagramSnippet[]; ideas: PostIdea[] }> {
    const project = await ctx.runQuery(api.projects.get, { projectId: args.projectId });
    if (!project) throw new Error("Projeto não encontrado");

    const snippets = await ctx.runQuery(internal.socialPosts.listCaptionSnippetsForDigestInternal, {
        projectId: args.projectId,
        limit: 30,
    });
    const recommendationPosts = await ctx.runQuery(internal.socialPosts.listRecommendationContextInternal, {
        projectId: args.projectId,
        limit: 12,
    }) as RecommendationContextPost[];

    const system = `You are Vanda, an editorial assistant. Output valid JSON only for the schema. Captions and titles in Brazilian Portuguese; imagePrompt in English.`;
    const user = buildIdeasUserPrompt({
        project,
        snippets,
        recommendationPosts,
        userIntent: args.userIntent,
        avoidRecentThemes: args.avoidRecentThemes,
        extraExclusions: args.extraExclusions,
        count: args.count,
    });

    const out = await runAiEffectOrThrow(
        Effect.gen(function* () {
            const textGen = yield* TextGeneration;
            return yield* textGen.generateStructured({
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                schema: PostIdeasResponseSchema,
                model: POST_IDEAS_MODEL,
                temperature: 0.75,
                maxTokens: 8192,
            });
        })
    );

    return {
        project,
        snippets,
        ideas: out.ideas,
    };
}

function buildLaunchPostPrompt(idea: PostIdea): string {
    const sections = [
        idea.title ? `## Título de trabalho\n${idea.title}` : null,
        `## Legenda de referência\n${idea.caption}`,
        idea.reasoning ? `## Ângulo editorial\n${idea.reasoning}` : null,
        `## Pedido de imagem\n${idea.imagePrompt}`,
        "## Instruções finais\nCrie uma imagem única para feed do Instagram que reflita a legenda acima e preserve a identidade da marca.",
    ].filter(Boolean);

    return sections.join("\n\n");
}

function getNextWeekdaySlots(count: number): number[] {
    const nowInSaoPaulo = new Date(Date.now() + SAO_PAULO_OFFSET_HOURS * 60 * 60 * 1000);
    let cursor = new Date(
        Date.UTC(
            nowInSaoPaulo.getUTCFullYear(),
            nowInSaoPaulo.getUTCMonth(),
            nowInSaoPaulo.getUTCDate(),
            0,
            0,
            0,
            0
        )
    );

    const slots: number[] = [];
    while (slots.length < count) {
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
        const day = cursor.getUTCDay();
        if (day === 0 || day === 6) {
            continue;
        }

        slots.push(
            Date.UTC(
                cursor.getUTCFullYear(),
                cursor.getUTCMonth(),
                cursor.getUTCDate(),
                LAUNCH_POST_HOUR - SAO_PAULO_OFFSET_HOURS,
                LAUNCH_POST_MINUTE,
                0,
                0
            )
        );
    }

    return slots;
}

const PROGRESS_TEXT_MAX = 520;

function truncateForProgress(text: string, max = PROGRESS_TEXT_MAX): string {
    const t = text.trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
}

function buildLaunchPostsState(args: {
    status: "generating" | "completed" | "partial" | "error";
    startedAt: number;
    completedPosts: number;
    generatedPostIds: Id<"generated_posts">[];
    errorMessage?: string;
    completedAt?: number;
    phase?: "ideas" | "image" | "post" | "schedule";
    activePostNumber?: number;
    currentImagePrompt?: string;
    currentCaption?: string;
    scheduledFor?: number;
}) {
    const base = {
        status: args.status,
        totalPosts: LAUNCH_POST_COUNT,
        completedPosts: args.completedPosts,
        generatedPostIds: args.generatedPostIds,
        startedAt: args.startedAt,
        updatedAt: Date.now(),
        ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
        ...(args.completedAt ? { completedAt: args.completedAt } : {}),
    };
    if (args.status !== "generating") {
        return base;
    }
    return {
        ...base,
        ...(args.phase ? { phase: args.phase } : {}),
        ...(args.activePostNumber != null ? { activePostNumber: args.activePostNumber } : {}),
        ...(args.currentImagePrompt ? { currentImagePrompt: args.currentImagePrompt } : {}),
        ...(args.currentCaption ? { currentCaption: args.currentCaption } : {}),
        ...(args.scheduledFor != null ? { scheduledFor: args.scheduledFor } : {}),
    } as const;
}

export const generateIdeas = action({
    args: {
        projectId: v.id("projects"),
        userIntent: v.optional(v.string()),
        avoidRecentThemes: v.optional(v.boolean()),
        extraExclusions: v.optional(v.string()),
        count: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Não autenticado");

        const reservation = await reserveAiUsage(ctx, estimateCaptionUsage(POST_IDEAS_MODEL));

        try {
            const n = Math.min(5, Math.max(1, args.count ?? 3));
            const { snippets, ideas } = await generateIdeasWithModel(ctx, {
                projectId: args.projectId,
                userIntent: args.userIntent,
                avoidRecentThemes: args.avoidRecentThemes,
                extraExclusions: args.extraExclusions,
                count: n,
            });

            const postIds: Id<"generated_posts">[] = [];
            for (const idea of ideas) {
                const sourcePostIds = (idea.sourcePostIndices ?? [])
                    .map((i) => snippets[i]?._id)
                    .filter((id): id is Id<"social_posts"> => Boolean(id));

                const id = await ctx.runMutation(api.generatedPosts.create, {
                    projectId: args.projectId,
                    platform: "instagram",
                    ...(idea.title && { title: idea.title }),
                    caption: idea.caption,
                    ...(idea.reasoning && { reasoning: idea.reasoning }),
                    ...(idea.imagePrompt && { imagePrompt: idea.imagePrompt }),
                    ...(sourcePostIds.length > 0 ? { sourcePostIds } : {}),
                    model: POST_IDEAS_MODEL,
                    status: "generated",
                });
                postIds.push(id);
            }

            return {
                postIds,
                creditsUsed: sumUsageLineItemCredits(estimateCaptionUsage(POST_IDEAS_MODEL)),
            };
        } catch (error) {
            await refundAiUsage(ctx, reservation);
            throw error;
        }
    },
});

export const generateLaunchPostsForProject = action({
    args: {
        projectId: v.id("projects"),
    },
    handler: async (ctx, args): Promise<{
        success: boolean;
        postIds: Id<"generated_posts">[];
        scheduledCount: number;
        creditsUsed: number;
    }> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Não autenticado");
        }

        const existingProject = await ctx.runQuery(api.projects.get, { projectId: args.projectId });
        if (!existingProject) {
            throw new Error("Projeto não encontrado");
        }
        if (!existingProject.lastInstagramSyncAt || !existingProject.instagramContentDigest) {
            throw new Error("Capture o Instagram do projeto antes de gerar os 5 posts.");
        }
        if (existingProject.launchPostsGeneration) {
            throw new Error("Os 5 posts deste projeto já foram gerados.");
        }

        const user = await ctx.runMutation(api.users.ensureCurrent, {});
        const contextImages = await ctx.runQuery(api.contextImages.list, {
            projectId: args.projectId,
        });
        const contextImageUrls = contextImages
            .map((image) => image.url)
            .filter((url): url is string => !!url);

        const normalizedSettings = coerceImageGenerationSettings(
            [DEFAULT_IMAGE_MODEL],
            LAUNCH_POST_ASPECT_RATIO,
            LAUNCH_POST_RESOLUTION
        );
        const aspectRatio = normalizedSettings.aspectRatio;
        const resolution = normalizedSettings.resolution;

        const reservationItems = [
            ...estimateCaptionUsage(POST_IDEAS_MODEL),
            ...estimateImageBatchUsage(
                Array.from({ length: LAUNCH_POST_COUNT }, () => DEFAULT_IMAGE_MODEL)
            ),
        ];
        const reservation = await reserveAiUsage(ctx, reservationItems);

        const startedAt = Date.now();
        await ctx.runMutation(internal.projects.setLaunchPostsGenerationInternal, {
            projectId: args.projectId,
            state: buildLaunchPostsState({
                status: "generating",
                startedAt,
                completedPosts: 0,
                generatedPostIds: [],
                phase: "ideas",
            }),
        });

        let project: Doc<"projects">;
        let ideas: PostIdea[];

        try {
            const result = await generateIdeasWithModel(ctx, {
                projectId: args.projectId,
                userIntent:
                    "Monte um pacote inicial de demonstração com 5 posts distintos, prontos para agendamento, variando ângulo editorial e evitando repetição de tema.",
                avoidRecentThemes: true,
                extraExclusions: undefined,
                count: LAUNCH_POST_COUNT,
            });
            project = result.project;
            ideas = result.ideas;
        } catch (error) {
            await refundAiUsage(ctx, reservation);
            await ctx.runMutation(internal.projects.setLaunchPostsGenerationInternal, {
                projectId: args.projectId,
                state: buildLaunchPostsState({
                    status: "error",
                    startedAt,
                    completedPosts: 0,
                    generatedPostIds: [],
                    completedAt: Date.now(),
                    errorMessage:
                        error instanceof Error ? error.message : "Falha ao montar ideias para os posts.",
                }),
            });
            throw error;
        }

        if (ideas.length !== LAUNCH_POST_COUNT) {
            await refundAiUsage(ctx, reservation);
            await ctx.runMutation(internal.projects.setLaunchPostsGenerationInternal, {
                projectId: args.projectId,
                state: buildLaunchPostsState({
                    status: "error",
                    startedAt,
                    completedPosts: 0,
                    generatedPostIds: [],
                    completedAt: Date.now(),
                    errorMessage: "A geração de ideias não retornou os 5 posts esperados.",
                }),
            });
            throw new Error("A geração de ideias não retornou os 5 posts esperados.");
        }

        const createdPostIds: Id<"generated_posts">[] = [];
        const failedImageRefunds: ReturnType<typeof estimateImageLineItem>[] = [];
        let creditsUsed = sumUsageLineItemCredits(reservationItems);
        let attemptedIdeas = 0;

        try {
            const brandContextMarkdown = project.brandContextMarkdown?.trim();
            const scheduleSlots = getNextWeekdaySlots(LAUNCH_POST_COUNT);

            for (const idea of ideas) {
                attemptedIdeas += 1;
                const postNumber = attemptedIdeas;
                let imageCreated = false;

                try {
                    const cap = truncateForProgress(idea.caption);
                    const imgBrief = truncateForProgress(idea.imagePrompt);

                    await ctx.runMutation(internal.projects.setLaunchPostsGenerationInternal, {
                        projectId: args.projectId,
                        state: buildLaunchPostsState({
                            status: "generating",
                            startedAt,
                            completedPosts: createdPostIds.length,
                            generatedPostIds: createdPostIds,
                            phase: "image",
                            activePostNumber: postNumber,
                            currentImagePrompt: imgBrief,
                            currentCaption: cap,
                        }),
                    });

                    const imagePrompt = buildLaunchPostPrompt(idea);
                    const augmentedMessage = brandContextMarkdown
                        ? `${brandContextMarkdown}\n\n${imagePrompt}`
                        : imagePrompt;

                    const imageResult = await persistSingleGeneratedImage({
                        ctx,
                        userId: user._id,
                        projectId: args.projectId,
                        message: augmentedMessage,
                        userPrompt: idea.imagePrompt,
                        model: DEFAULT_IMAGE_MODEL,
                        aspectRatio,
                        resolution,
                        layoutReferenceUrls: [],
                        productReferenceUrls: [],
                        styleReferenceUrls: contextImageUrls,
                    });

                    if (!imageResult.success) {
                        failedImageRefunds.push(estimateImageLineItem(DEFAULT_IMAGE_MODEL));
                        continue;
                    }
                    imageCreated = true;

                    await ctx.runMutation(internal.projects.setLaunchPostsGenerationInternal, {
                        projectId: args.projectId,
                        state: buildLaunchPostsState({
                            status: "generating",
                            startedAt,
                            completedPosts: createdPostIds.length,
                            generatedPostIds: createdPostIds,
                            phase: "post",
                            activePostNumber: postNumber,
                            currentImagePrompt: imgBrief,
                            currentCaption: cap,
                        }),
                    });

                    const postId = await ctx.runMutation(api.generatedPosts.saveComposedDraft, {
                        projectId: args.projectId,
                        platform: "instagram",
                        ...(idea.title ? { title: idea.title } : {}),
                        caption: idea.caption,
                        mediaItemIds: [imageResult.mediaItemId],
                    });

                    const scheduledFor = scheduleSlots[createdPostIds.length];
                    if (scheduledFor === undefined) {
                        throw new Error("Não foi possível calcular a próxima data de agendamento.");
                    }

                    await ctx.runMutation(internal.projects.setLaunchPostsGenerationInternal, {
                        projectId: args.projectId,
                        state: buildLaunchPostsState({
                            status: "generating",
                            startedAt,
                            completedPosts: createdPostIds.length,
                            generatedPostIds: createdPostIds,
                            phase: "schedule",
                            activePostNumber: postNumber,
                            currentImagePrompt: imgBrief,
                            currentCaption: cap,
                            scheduledFor,
                        }),
                    });

                    await ctx.runMutation(api.scheduledPosts.schedulePost, {
                        postId,
                        scheduledFor,
                        reminderMinutes: LAUNCH_POST_REMINDER_MINUTES,
                    });

                    createdPostIds.push(postId);
                    await ctx.runMutation(internal.projects.setLaunchPostsGenerationInternal, {
                        projectId: args.projectId,
                        state: buildLaunchPostsState({
                            status: "generating",
                            startedAt,
                            completedPosts: createdPostIds.length,
                            generatedPostIds: createdPostIds,
                        }),
                    });
                } catch (error) {
                    console.error("[LAUNCH_POSTS] Failed to generate one launch post:", error);
                    if (!imageCreated) {
                        failedImageRefunds.push(estimateImageLineItem(DEFAULT_IMAGE_MODEL));
                    }
                }
            }

            if (failedImageRefunds.length > 0) {
                await refundAiUsage(ctx, failedImageRefunds);
                creditsUsed -= sumUsageLineItemCredits(failedImageRefunds);
            }

            const completedAt = Date.now();
            const finalStatus =
                createdPostIds.length === LAUNCH_POST_COUNT
                    ? "completed"
                    : createdPostIds.length > 0
                      ? "partial"
                      : "error";

            const errorMessage =
                finalStatus === "completed"
                    ? undefined
                    : finalStatus === "partial"
                      ? `${LAUNCH_POST_COUNT - createdPostIds.length} de ${LAUNCH_POST_COUNT} posts falharam durante a geração.`
                      : "Nenhum dos 5 posts pôde ser gerado.";

            await ctx.runMutation(internal.projects.setLaunchPostsGenerationInternal, {
                projectId: args.projectId,
                state: buildLaunchPostsState({
                    status: finalStatus,
                    startedAt,
                    completedPosts: createdPostIds.length,
                    generatedPostIds: createdPostIds,
                    completedAt,
                    ...(errorMessage ? { errorMessage } : {}),
                }),
            });

            return {
                success: finalStatus !== "error",
                postIds: createdPostIds,
                scheduledCount: createdPostIds.length,
                creditsUsed,
            };
        } catch (error) {
            const remainingImageRefunds = Array.from(
                { length: Math.max(0, LAUNCH_POST_COUNT - attemptedIdeas) },
                () => estimateImageLineItem(DEFAULT_IMAGE_MODEL)
            );
            const refunds = [...failedImageRefunds, ...remainingImageRefunds];
            if (refunds.length > 0) {
                await refundAiUsage(ctx, refunds);
            }

            const completedAt = Date.now();
            await ctx.runMutation(internal.projects.setLaunchPostsGenerationInternal, {
                projectId: args.projectId,
                state: buildLaunchPostsState({
                    status: createdPostIds.length > 0 ? "partial" : "error",
                    startedAt,
                    completedPosts: createdPostIds.length,
                    generatedPostIds: createdPostIds,
                    completedAt,
                    errorMessage:
                        error instanceof Error
                            ? error.message
                            : "Falha ao gerar os 5 posts automáticos.",
                }),
            });

            throw error;
        }
    },
});
