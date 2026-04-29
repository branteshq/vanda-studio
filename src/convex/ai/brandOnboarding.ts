"use node";

import { v } from "convex/values";
import { z } from "zod";
import { Effect } from "effect";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { TextGeneration, MODELS, runAiEffectOrThrow } from "./llm/index";

/** OpenRouter model id for brand onboarding actions (structured JSON). */
const BRAND_ONBOARDING_MODEL = MODELS.KIMI_K2;
import type { Doc } from "../_generated/dataModel";

// ============================================================================
// Zod — full kit suggestion (no storage ids)
// ============================================================================
//
// LLMs (esp. via OpenRouter) often emit JSON with `null` for "empty" optional
// fields. Zod's `.optional()` only allows `undefined`, not `null`, which makes
// `generateText` + `Output.object` throw after JSON parse → MalformedResponseError.

/** Max lengths keep JSON small so OpenRouter finishes inside token budget (avoids truncated JSON). */
const MAX_ELEVATOR = 500;
const MAX_SHORT_PARA = 800;
const MAX_WHO_SERVE = 600;
const MAX_WRITING_RULES = 800;
const MAX_IMAGERY = 600;
const MAX_TYPO = 200;
const MAX_POLICY = 600;
const MAX_ARRAY_ITEM = 120;
const MAX_ARRAY_ITEMS = 16;

/** Truncate to max length instead of rejecting — models often overshoot. */
const llmBoundedStr = (max: number) =>
    z.preprocess((val) => {
        if (val == null) return undefined;
        if (typeof val === "string") return val.length > max ? val.slice(0, max) : val;
        return undefined;
    }, z.string().max(max).nullish());

/** Like llmBoundedStr but also accepts an array of strings (joins with newline). */
const llmFlexStr = (max: number) =>
    z.preprocess((val) => {
        if (val == null) return undefined;
        if (Array.isArray(val)) {
            const joined = val.filter((x): x is string => typeof x === "string").join("\n");
            return joined.length > max ? joined.slice(0, max) : joined;
        }
        if (typeof val === "string") return val.length > max ? val.slice(0, max) : val;
        return undefined;
    }, z.string().max(max).nullish());

/** Accept [], null, or a single comma-separated string from sloppy models. */
const llmOptStrArray = z.preprocess((val) => {
    if (val == null) return undefined;
    if (Array.isArray(val)) {
        return val.filter((x): x is string => typeof x === "string");
    }
    if (typeof val === "string") {
        return val
            .split(/[,;\n]/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return undefined;
}, z.array(z.string().max(MAX_ARRAY_ITEM)).max(MAX_ARRAY_ITEMS).nullish());

const BrandKitSuggestionSchema = z.object({
    elevatorPitch: llmBoundedStr(MAX_ELEVATOR).describe(
        "Pitch memorável da marca em 1-2 frases. Deve capturar essência + diferencial + emoção."
    ),
    whatWeSell: llmBoundedStr(MAX_SHORT_PARA).describe(
        "O que a marca vende ou oferece. Seja específico: produtos, serviços, formatos, faixas de preço."
    ),
    whoWeServe: llmBoundedStr(MAX_WHO_SERVE).describe(
        "Público-alvo detalhado: demografia, psicografia, comportamentos, dores e desejos. Não diga apenas 'público geral'."
    ),
    differentiators: llmBoundedStr(MAX_SHORT_PARA).describe(
        "O que torna esta marca ÚNICA vs concorrentes? Liste vantagens concretas, não repita o pitch."
    ),
    competitorsNotes: llmBoundedStr(MAX_SHORT_PARA).describe(
        "Análise breve do cenário competitivo: quem são os concorrentes, como se posicionam, onde há oportunidade."
    ),
    toneAdjectives: llmOptStrArray.describe(
        "4-6 adjetivos que definem a personalidade verbal da marca (ex: 'irreverente', 'sofisticado', 'acolhedor')."
    ),
    writingRules: llmFlexStr(MAX_WRITING_RULES).describe(
        "3-5 regras práticas para redatores. Inclua exemplos de FAÇA/NÃO FAÇA. Ex: 'Use primeira pessoa do plural (nós). Evite jargão corporativo.'"
    ),
    languages: llmOptStrArray.describe("Idiomas do conteúdo (ex: 'Português Brasileiro')"),
    emojiPolicy: llmBoundedStr(MAX_POLICY).describe(
        "Como a marca usa emojis: frequência, estilo, exemplos específicos de emojis preferidos."
    ),
    ctaStyle: llmBoundedStr(MAX_POLICY).describe(
        "Estilo de chamada para ação: tom, verbos preferidos, exemplos concretos de CTAs da marca."
    ),
    primaryColors: llmOptStrArray.describe(
        "3-5 cores hex primárias que formam uma paleta ÚNICA para esta marca. Evite paletas genéricas. Considere a personalidade e o setor."
    ),
    secondaryColors: llmOptStrArray.describe(
        "2-4 cores hex secundárias/de apoio que complementam as primárias."
    ),
    typographyPrimary: llmBoundedStr(MAX_TYPO).describe(
        "Família de fonte do Google Fonts para títulos (ex: 'Playfair Display', 'DM Serif Display', 'Sora'). Escolha com base na personalidade da marca."
    ),
    typographySecondary: llmBoundedStr(MAX_TYPO).describe(
        "Família de fonte do Google Fonts para corpo de texto (ex: 'Source Sans 3', 'Lato', 'Nunito'). Deve harmonizar com a primária."
    ),
    imageryGuidelines: llmBoundedStr(MAX_IMAGERY).describe(
        "Diretrizes de fotografia/imagem: estilo visual, iluminação, composição, cores dominantes, mood. Seja específico."
    ),
});

const PositioningSectionSchema = z.object({
    elevatorPitch: llmBoundedStr(MAX_ELEVATOR),
    whatWeSell: llmBoundedStr(MAX_SHORT_PARA),
    whoWeServe: llmBoundedStr(MAX_WHO_SERVE),
    differentiators: llmBoundedStr(MAX_SHORT_PARA),
    competitorsNotes: llmBoundedStr(MAX_SHORT_PARA),
});

const VoiceSectionSchema = z.object({
    toneAdjectives: llmOptStrArray,
    writingRules: llmFlexStr(MAX_WRITING_RULES),
    languages: llmOptStrArray,
    emojiPolicy: llmBoundedStr(MAX_POLICY),
    ctaStyle: llmBoundedStr(MAX_POLICY),
});

const VisualSectionSchema = z.object({
    primaryColors: llmOptStrArray,
    secondaryColors: llmOptStrArray,
    typographyPrimary: llmBoundedStr(MAX_TYPO),
    typographySecondary: llmBoundedStr(MAX_TYPO),
    imageryGuidelines: llmBoundedStr(MAX_IMAGERY),
});

/** Appended to system prompts to keep output focused without starving fields of depth. */
const BREVITY_RULE =
    "REGRA DE QUALIDADE: Preencha TODOS os campos. Cada campo deve ser substantivo (3-5 frases quando necessário), " +
    "mas nunca repetitivo. Listas: 3-8 itens. NUNCA repita a mesma ideia em campos diferentes. " +
    "Se perceber repetição, PARE e feche o JSON.";

export type BrandKitSuggestion = z.infer<typeof BrandKitSuggestionSchema>;

function summarizeProjectForPrompt(project: Doc<"projects">): string {
    const parts: string[] = [`Nome: ${project.name}`];
    if (project.accountDescription) parts.push(`Descrição: ${project.accountDescription}`);
    if (project.brandTraits?.length) parts.push(`Traços: ${project.brandTraits.join(", ")}`);
    if (project.additionalContext) parts.push(`Contexto: ${project.additionalContext}`);
    if (project.brandKit) {
        const k = project.brandKit;
        if (k.elevatorPitch) parts.push(`Pitch: ${k.elevatorPitch}`);
        if (k.whatWeSell) parts.push(`Oferta: ${k.whatWeSell}`);
        if (k.whoWeServe) parts.push(`Público: ${k.whoWeServe}`);
        if (k.toneAdjectives?.length) parts.push(`Tom: ${k.toneAdjectives.join(", ")}`);
        if (k.primaryColors?.length) parts.push(`Cores: ${k.primaryColors.join(", ")}`);
    }
    return parts.join("\n");
}

// ============================================================================
// Actions
// ============================================================================

const SECTION_VALIDATOR = v.union(
    v.literal("positioning"),
    v.literal("voice"),
    v.literal("visual")
);

export const suggestBrandKitFromDescription = action({
    args: {
        description: v.string(),
        nicheHint: v.optional(v.string()),
        audienceHint: v.optional(v.string()),
        referenceBrands: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<BrandKitSuggestion> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Você precisa estar autenticado");
        }

        let userPrompt = `## Briefing do usuário\n${args.description.trim()}\n`;
        if (args.nicheHint?.trim()) userPrompt += `\n## Nicho\n${args.nicheHint.trim()}\n`;
        if (args.audienceHint?.trim()) userPrompt += `\n## Público\n${args.audienceHint.trim()}\n`;
        if (args.referenceBrands?.trim()) {
            userPrompt += `\n## Marcas de referência\n${args.referenceBrands.trim()}\n`;
        }
        userPrompt +=
            "\nCrie uma identidade de marca COMPLETA e RICA em português brasileiro. Preencha TODOS os campos do JSON. Cores em hex.";

        const system = `Você é um estrategista sênior de marca e diretor criativo para redes sociais. Sua missão é criar identidades de marca memoráveis e completas.

RETORNE APENAS JSON VÁLIDO seguindo o schema. Preencha TODOS os campos — nenhum deve ficar vazio.

DIRETRIZES POR CAMPO:
- elevatorPitch: Frase poderosa que captura a essência da marca. Deve ser memorável.
- whatWeSell: Descreva produtos/serviços com especificidade — formatos, categorias, faixa.
- whoWeServe: Perfil DETALHADO do público: idade, estilo de vida, valores, dores, aspirações. NUNCA diga "público geral".
- differentiators: O que torna esta marca DIFERENTE? Cite vantagens concretas vs concorrentes. Não repita o pitch.
- competitorsNotes: Cite o cenário competitivo real, oportunidades de posicionamento.
- toneAdjectives: 4-6 adjetivos de personalidade verbal (não genéricos como "profissional").
- writingRules: 3-5 regras ACIONÁVEIS para redatores com exemplos de FAÇA/NÃO FAÇA.
- emojiPolicy: Como, quando e quais emojis usar — com exemplos concretos.
- ctaStyle: Tom e exemplos de CTAs típicas da marca.
- primaryColors: 3-5 cores hex que formem uma paleta ÚNICA e coerente com a personalidade da marca. Evite paletas óbvias/clichê do setor.
- secondaryColors: 2-4 cores de apoio que complementem.
- typographyPrimary: Nome EXATO de uma família do Google Fonts para títulos. Escolha uma fonte com personalidade que reflita a marca.
- typographySecondary: Nome EXATO de uma família do Google Fonts para corpo. Deve harmonizar com a primária.
- imageryGuidelines: Estilo visual detalhado — iluminação, composição, mood, referências estéticas.

${BREVITY_RULE}`;

        return await runAiEffectOrThrow(
            Effect.gen(function* () {
                const textGen = yield* TextGeneration;
                return yield* textGen.generateStructured({
                    messages: [
                        { role: "system", content: system },
                        { role: "user", content: userPrompt },
                    ],
                    schema: BrandKitSuggestionSchema,
                    model: BRAND_ONBOARDING_MODEL,
                    temperature: 0.75,
                    maxTokens: 4096,
                });
            })
        );
    },
});

export const suggestBrandSection = action({
    args: {
        projectId: v.optional(v.id("projects")),
        /** When no project yet (wizard), pass accumulated brand notes as text. */
        draftContext: v.optional(v.string()),
        section: SECTION_VALIDATOR,
        extraHint: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Você precisa estar autenticado");
        }

        if (!args.projectId && !args.draftContext?.trim()) {
            throw new Error("Informe o projeto ou um rascunho de contexto");
        }

        let base: string;
        if (args.projectId) {
            const project = await ctx.runQuery(api.projects.get, { projectId: args.projectId });
            if (!project) {
                throw new Error("Projeto não encontrado");
            }
            base = summarizeProjectForPrompt(project);
        } else {
            base = args.draftContext!.trim();
        }
        let userPrompt = `## Contexto atual do projeto\n${base}\n`;
        if (args.extraHint?.trim()) userPrompt += `\n## Instrução extra\n${args.extraHint.trim()}\n`;

        if (args.section === "positioning") {
            userPrompt +=
                "\nSugira apenas posicionamento: elevatorPitch, whatWeSell, whoWeServe, differentiators, competitorsNotes (todos opcionais no JSON). pt-BR. Cada texto: poucas frases; não liste públicos infinitos em whoWeServe.";
            const system = `Você é estrategista de marca. Responda só com JSON válido para o schema pedido. ${BREVITY_RULE}`;
            return await runAiEffectOrThrow(
                Effect.gen(function* () {
                    const textGen = yield* TextGeneration;
                    return yield* textGen.generateStructured({
                        messages: [
                            { role: "system", content: system },
                            { role: "user", content: userPrompt },
                        ],
                        schema: PositioningSectionSchema,
                        model: BRAND_ONBOARDING_MODEL,
                        temperature: 0.7,
                        maxTokens: 2048,
                    });
                })
            );
        }

        if (args.section === "voice") {
            userPrompt +=
                "\nSugira apenas voz/estilo verbal: toneAdjectives, writingRules, languages, emojiPolicy, ctaStyle. pt-BR. JSON. Listas curtas.";
            const system = `Você é redator de marca. Responda só com JSON válido para o schema pedido. ${BREVITY_RULE}`;
            return await runAiEffectOrThrow(
                Effect.gen(function* () {
                    const textGen = yield* TextGeneration;
                    return yield* textGen.generateStructured({
                        messages: [
                            { role: "system", content: system },
                            { role: "user", content: userPrompt },
                        ],
                        schema: VoiceSectionSchema,
                        model: BRAND_ONBOARDING_MODEL,
                        temperature: 0.75,
                        maxTokens: 2048,
                    });
                })
            );
        }

        userPrompt +=
            "\nSugira apenas identidade visual: primaryColors, secondaryColors (hex), typographyPrimary, typographySecondary, imageryGuidelines. JSON. Poucas cores e frases.";
        const system = `Você é designer de marca. Responda só com JSON válido para o schema pedido. ${BREVITY_RULE}`;
        return await runAiEffectOrThrow(
            Effect.gen(function* () {
                const textGen = yield* TextGeneration;
                return yield* textGen.generateStructured({
                    messages: [
                        { role: "system", content: system },
                        { role: "user", content: userPrompt },
                    ],
                    schema: VisualSectionSchema,
                    model: BRAND_ONBOARDING_MODEL,
                    temperature: 0.65,
                    maxTokens: 2048,
                });
            })
        );
    },
});
