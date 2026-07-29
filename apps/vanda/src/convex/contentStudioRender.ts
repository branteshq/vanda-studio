"use node";

import { Resvg } from "@resvg/resvg-js";
import { Jimp } from "jimp";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { renderCarouselSlideSvg, type RenderVisual } from "./pipeline/carouselRenderer";
import type { CarouselDocumentPlan } from "./pipeline/contentStudio";
import {
  ImageAssetGenerator,
  openRouterImageGeneratorLayer,
  reviewGeneratedAsset,
  type GeneratedAssetReview,
  type GeneratedVisual,
} from "./pipeline/imageGeneration";
import { PIPELINE_MODELS, PROMPT_VERSIONS } from "./pipeline/liveModel";
import { runTracked } from "./pipeline/liveTelemetry";
import type { VisualBrandPlan } from "./pipeline/visualBrand";
import { interRomanBase64 } from "./pipeline/interFont.generated";

const interFontPath = join(tmpdir(), "vanda-inter-roman.ttf");
const ensureInterFont = (): string => {
  if (!existsSync(interFontPath))
    writeFileSync(interFontPath, Buffer.from(interRomanBase64, "base64"));
  return interFontPath;
};

const asDocumentPlan = (document: {
  readonly title: string;
  readonly caption: string;
  readonly accessibilityDescription: string;
  readonly canvas: CarouselDocumentPlan["canvas"];
  readonly style: CarouselDocumentPlan["style"];
  readonly brandFactIds: CarouselDocumentPlan["brandFactIds"];
  readonly slides: CarouselDocumentPlan["slides"];
}): CarouselDocumentPlan => ({
  title: document.title,
  caption: document.caption,
  accessibilityDescription: document.accessibilityDescription,
  canvas: document.canvas,
  style: document.style,
  brandFactIds: document.brandFactIds,
  slides: document.slides,
});

const asVisualProfile = (profile: {
  readonly name: string;
  readonly rationale: string;
  readonly palette: VisualBrandPlan["palette"];
  readonly typography: VisualBrandPlan["typography"];
  readonly artDirection: string;
  readonly motifs: VisualBrandPlan["motifs"];
  readonly photoTreatment: VisualBrandPlan["photoTreatment"];
  readonly avoid: VisualBrandPlan["avoid"];
}): VisualBrandPlan => ({
  name: profile.name,
  rationale: profile.rationale,
  palette: profile.palette,
  typography: profile.typography,
  artDirection: profile.artDirection,
  motifs: profile.motifs,
  photoTreatment: profile.photoTreatment,
  avoid: profile.avoid,
});

const toDataUrl = (bytes: Uint8Array, mimeType: string): string =>
  `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

const bytesBlob = (bytes: Uint8Array, mimeType: string): Blob => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mimeType });
};

const fetchVisual = async (url: string): Promise<RenderVisual> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`visual download HTTP ${response.status}`);
  const mimeType = response.headers.get("content-type") ?? "image/jpeg";
  return {
    dataUrl: toDataUrl(new Uint8Array(await response.arrayBuffer()), mimeType),
    mimeType,
  };
};

const visualPrompt = (input: {
  readonly slidePrompt: string;
  readonly headline: string;
  readonly profile: VisualBrandPlan;
  readonly identityRefs: ReadonlyArray<string>;
}): string =>
  `Crie uma imagem editorial vertical 4:5 para servir como elemento visual de um carrossel de ` +
  `Instagram. Não inclua letras, palavras, números, logotipos, marcas d'água, interfaces ou molduras. ` +
  (input.identityRefs.length > 0
    ? `Represente EXATAMENTE a pessoa das imagens de referência fornecidas — preserve com ` +
      `fidelidade rosto, tom de pele, cabelo e traços; nunca invente outra pessoa nem inclua ` +
      `pessoas adicionais identificáveis. `
    : `Não represente pacientes, procedimentos médicos, resultados garantidos ou pessoas identificáveis. `) +
  `Deixe áreas calmas e respiro para sobreposição tipográfica posterior. Direção de arte: ` +
  `${input.profile.artDirection}. Paleta aproximada: ${Object.values(input.profile.palette).join(", ")}. ` +
  `Motivos permitidos: ${input.profile.motifs.join(", ")}. Evitar: ${input.profile.avoid.join(", ")}. ` +
  `Contexto visual do slide: ${input.slidePrompt || input.headline}.`;

const generateVisual = async (input: {
  readonly ctx: ActionCtx;
  readonly apiKey: string;
  readonly requestId: Id<"contentAssetRequests">;
  readonly prompt: string;
  readonly headline: string;
  readonly profile: VisualBrandPlan;
  readonly identityRefs: ReadonlyArray<string>;
}): Promise<RenderVisual | undefined> => {
  try {
    await input.ctx.runMutation(internal.contentStudio.startAssetRequest, {
      requestId: input.requestId,
    });
    const basePrompt = visualPrompt({
      slidePrompt: input.prompt,
      headline: input.headline,
      profile: input.profile,
      identityRefs: input.identityRefs,
    });
    const allowPerson = input.identityRefs.length > 0;
    let generated: GeneratedVisual | undefined;
    let review: GeneratedAssetReview | undefined;
    let correction = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      generated = await Effect.runPromise(
        Effect.flatMap(ImageAssetGenerator, (generator) =>
          generator.generate({
            prompt: `${basePrompt}${correction}`,
            ...(allowPerson ? { referenceUrls: input.identityRefs } : {}),
          }),
        ).pipe(
          Effect.provide(
            openRouterImageGeneratorLayer({
              apiKey: input.apiKey,
              model: PIPELINE_MODELS.studioAssetGeneration,
            }),
          ),
        ),
      );
      review = await reviewGeneratedAsset({
        apiKey: input.apiKey,
        model: PIPELINE_MODELS.studioAssetReview,
        visual: generated,
        context: `${input.headline}. ${input.prompt}`,
        ...(allowPerson ? { identityReferenceUrls: input.identityRefs } : {}),
      });
      if (review.approved) break;
      correction =
        ` CORREÇÃO OBRIGATÓRIA APÓS REVISÃO: ${review.summary}. ` +
        `Problemas a eliminar: ${[
          ...review.prohibitedSubjects,
          ...review.qualityIssues,
          ...(review.containsText ? ["qualquer texto ou caractere"] : []),
          ...(review.containsLogo ? ["qualquer logo"] : []),
          ...(review.containsPerson && !allowPerson ? ["qualquer pessoa"] : []),
        ].join(", ")}. ${
          allowPerson
            ? "Mantenha a pessoa fiel às referências autorizadas."
            : "Produza uma composição abstrata simples sem esses elementos."
        }`;
    }
    if (!generated || !review?.approved)
      throw new Error(`generated asset rejected: ${review?.summary ?? "unknown review failure"}`);
    const decoded = await Jimp.read(Buffer.from(generated.bytes));
    const storageId = await input.ctx.storage.store(bytesBlob(generated.bytes, generated.mimeType));
    await input.ctx.runMutation(internal.contentStudio.saveGeneratedAsset, {
      requestId: input.requestId,
      storageId,
      width: decoded.bitmap.width,
      height: decoded.bitmap.height,
      mimeType: generated.mimeType,
      description: input.headline,
      visualDescription: review.summary,
      containsText: review.containsText,
      containsFace: review.containsPerson,
      safeForBrandUse: review.approved,
      inspectionWarnings: [...review.prohibitedSubjects, ...review.qualityIssues],
      inspectionConfidence: review.confidence,
    });
    return { dataUrl: toDataUrl(generated.bytes, generated.mimeType), mimeType: generated.mimeType };
  } catch (error) {
    await input.ctx.runMutation(internal.contentStudio.failAssetRequest, {
      requestId: input.requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
};

export const rasterizeCarouselJpeg = async (svg: string): Promise<Uint8Array> => {
  const png = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      loadSystemFonts: false,
      fontFiles: [ensureInterFont()],
      defaultFontFamily: "Inter",
      sansSerifFamily: "Inter",
    },
  })
    .render()
    .asPng();
  const image = await Jimp.read(png);
  if (image.bitmap.width !== 1080 || image.bitmap.height !== 1350)
    throw new Error(`renderer dimensions ${image.bitmap.width}×${image.bitmap.height}`);
  return new Uint8Array(await image.getBuffer("image/jpeg", { quality: 91 }));
};

export const runRenderJob = internalAction({
  args: { renderJobId: v.id("carouselRenderJobs") },
  handler: async (ctx, { renderJobId }) => {
    const input = await ctx.runQuery(internal.contentStudio.loadRenderInput, { renderJobId });
    if (!input) throw new Error("render input is incomplete");
    if (!(await ctx.runMutation(internal.contentStudio.startRender, { renderJobId }))) return;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
    try {
      const document = asDocumentPlan(input.document);
      const profile = asVisualProfile(input.profile);
      const requestBySlide = new Map(
        input.requests.map((entry) => [entry.request.slideId, entry] as const),
      );
      const outputs = await runTracked(
        ctx,
        {
          accountId: input.project.accountId,
          stage: "studio_render",
          model: PIPELINE_MODELS.studioRender,
          promptVersion: PROMPT_VERSIONS.studioRender,
          inputIds: [input.document._id, input.profile._id],
        },
        async () => {
          const rendered = [];
          for (const slide of document.slides) {
            const asset = requestBySlide.get(slide.slideId);
            let visual: RenderVisual | undefined;
            if (asset?.outputUrl && asset.outputImage?.safeForBrandUse === true)
              visual = await fetchVisual(asset.outputUrl);
            else if (asset?.request.strategy === "available") {
              const source = input.referenceImages.find(({ image }) =>
                asset.request.sourceImageIds.includes(image._id),
              );
              if (source?.url) visual = await fetchVisual(source.url);
            } else if (asset?.request.strategy === "generate") {
              // Identity conditioning: explicit source references chosen by the
              // planner win; otherwise personal-brand photo requests use the
              // owner's authorized face references.
              const chosenRefs = input.identityReferences
                .filter(({ imageId }) => asset.request.sourceImageIds.includes(imageId))
                .map(({ url }) => url);
              const identityRefs =
                chosenRefs.length > 0
                  ? chosenRefs
                  : input.accountKind === "pessoal" && asset.request.kind === "photo"
                    ? input.identityReferences.map(({ url }) => url)
                    : [];
              visual = await generateVisual({
                ctx,
                apiKey,
                requestId: asset.request._id,
                prompt: asset.request.prompt,
                headline: slide.headline,
                profile,
                identityRefs: identityRefs.slice(0, 3),
              });
            }
            const result = renderCarouselSlideSvg({ document, slide, profile, visual });
            if (result.diagnostics.length > 0)
              throw new Error(`${slide.slideId}: ${result.diagnostics.join(", ")}`);
            const jpeg = await rasterizeCarouselJpeg(result.svg);
            const storageId = await ctx.storage.store(bytesBlob(jpeg, "image/jpeg"));
            rendered.push({
              slideId: slide.slideId,
              width: 1080,
              height: 1350,
              storageId,
              mimeType: "image/jpeg",
              description: slide.headline,
              altText: slide.visual.altText || slide.headline,
            });
          }
          return rendered;
        },
        (result) => `${result.length} slides JPEG 1080×1350`,
      );
      await ctx.runMutation(internal.contentStudio.completeRender, {
        renderJobId,
        outputs,
      });
    } catch (error) {
      await ctx.runMutation(internal.contentStudio.failRender, {
        renderJobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});
