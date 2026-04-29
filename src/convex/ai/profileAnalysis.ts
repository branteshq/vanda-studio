"use node";

import { v } from "convex/values";
import { z } from "zod";
import { Effect } from "effect";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { TextGeneration, MODELS, runAiEffectOrThrow } from "./llm/index";

// ============================================================================
// Schema
// ============================================================================

const ProfileAnalysisSchema = z.object({
    accountDescription: z.string(),
    brandTraits: z.array(z.string()).min(1).max(10),
    additionalContext: z.string(),
});

type ProfileAnalysisResult = z.infer<typeof ProfileAnalysisSchema>;

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `Você é um especialista em análise de perfis de redes sociais. Sua tarefa é analisar os dados de um perfil do Instagram (bio e legendas de posts) para extrair informações úteis sobre a marca/conta.

## Sua Tarefa

Analise os dados fornecidos e retorne um JSON com:

1. **accountDescription**: Uma descrição clara e concisa (2-4 frases) sobre:
   - Qual é o nicho ou área de atuação da conta
   - Quem é o público-alvo
   - Qual é a proposta de valor ou diferencial

2. **brandTraits**: Uma lista de 3 a 8 características que definem o tom e personalidade da marca, baseado nas legendas. Exemplos:
   - Tom: "profissional", "descontraído", "inspirador", "educativo", "humorístico"
   - Estilo: "direto", "storytelling", "emocional", "técnico", "coloquial"
   - Valores: "autenticidade", "qualidade", "inovação", "tradição", "exclusividade"

3. **additionalContext**: Observações adicionais úteis para geração de conteúdo:
   - Padrões de postagem (tipos de conteúdo, formatos preferidos)
   - Temas recorrentes ou tópicos frequentes
   - Estilo de hashtags (se usa muitas, poucas, específicas do nicho)
   - Chamadas para ação comuns (se houver)
   - Qualquer outro padrão relevante identificado

## Diretrizes

- Escreva tudo em português brasileiro
- Seja específico e baseado nos dados fornecidos
- Se os dados forem insuficientes para algum campo, faça inferências razoáveis
- Mantenha as características da marca (brandTraits) como palavras/frases curtas
- A descrição deve ser útil para que uma IA entenda o contexto ao gerar legendas

## Formato de Resposta

Responda APENAS com JSON válido no formato especificado.`;

// ============================================================================
// Action
// ============================================================================

export const analyzeProfileForConfig = action({
    args: {
        projectId: v.id("projects"),
    },
    handler: async (ctx, args): Promise<ProfileAnalysisResult> => {
        // 1. Auth check
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Você precisa estar autenticado");
        }

        // 2. Get project data
        const project = await ctx.runQuery(api.projects.get, {
            projectId: args.projectId,
        });
        if (!project) {
            throw new Error("Projeto não encontrado");
        }

        // 3. Get Instagram posts
        const posts = await ctx.runQuery(api.socialPosts.listByProject, {
            projectId: args.projectId,
        });

        // 4. Check if we have enough data
        const bio = project.bio;
        const captions = posts
            .filter((post) => post.caption && post.caption.trim().length > 0)
            .map((post) => ({
                caption: post.caption!,
                likeCount: post.likeCount ?? 0,
                commentsCount: post.commentsCount ?? 0,
            }));

        if (!bio && captions.length === 0) {
            throw new Error(
                "Dados insuficientes para análise. Certifique-se de que o perfil do Instagram foi sincronizado."
            );
        }

        // 5. Sort captions by engagement and take top 30
        const sortedCaptions = captions
            .sort((a, b) => {
                const engagementA = a.likeCount + a.commentsCount * 2;
                const engagementB = b.likeCount + b.commentsCount * 2;
                return engagementB - engagementA;
            })
            .slice(0, 30);

        // 6. Build user prompt with data
        let userPrompt = "## Dados do Perfil\n\n";

        if (bio) {
            userPrompt += `### Bio do Perfil\n"${bio}"\n\n`;
        }

        if (sortedCaptions.length > 0) {
            userPrompt += `### Legendas Recentes (${sortedCaptions.length} posts, ordenados por engajamento)\n\n`;
            sortedCaptions.forEach((post, index) => {
                userPrompt += `**Post ${index + 1}** (${post.likeCount} curtidas, ${post.commentsCount} comentarios):\n"${post.caption}"\n\n`;
            });
        }

        userPrompt += "\nAnalise estes dados e retorne o JSON com accountDescription, brandTraits e additionalContext.";

        // 7. Call AI
        const result = await runAiEffectOrThrow(
            Effect.gen(function* () {
                const textGen = yield* TextGeneration;
                return yield* textGen.generateStructured({
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: userPrompt },
                    ],
                    schema: ProfileAnalysisSchema,
                    model: MODELS.GEMINI_2_5_FLASH,
                    temperature: 0.7,
                    maxTokens: 2048,
                });
            })
        );

        return result;
    },
});
