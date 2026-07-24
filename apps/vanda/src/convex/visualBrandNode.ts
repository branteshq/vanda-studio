"use node";

import { v } from "convex/values";
import * as Effect from "effect/Effect";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import {
  languageModelLayer,
  PIPELINE_MODELS,
  PROMPT_VERSIONS,
  type Mutable,
} from "./pipeline/liveModel";
import { runTracked } from "./pipeline/liveTelemetry";
import {
  AssetInspector,
  contrastRatio,
  openRouterAssetInspectorLayer,
  planVisualBrand,
  validateVisualBrand,
  type VisualAssetInspection,
  type VisualBrandPlan,
} from "./pipeline/visualBrand";

const HEX = /^#[0-9a-f]{6}$/i;

const readableOn = (background: string): string =>
  contrastRatio("#FFFFFF", background) >= contrastRatio("#111111", background)
    ? "#FFFFFF"
    : "#111111";

const repairPlan = (plan: VisualBrandPlan): VisualBrandPlan => {
  const background = HEX.test(plan.palette.background) ? plan.palette.background : "#F5F2EE";
  const accent = HEX.test(plan.palette.accent) ? plan.palette.accent : "#8A2859";
  const textCandidate = HEX.test(plan.palette.text) ? plan.palette.text : "#171417";
  const contrastCandidate = HEX.test(plan.palette.accentContrast)
    ? plan.palette.accentContrast
    : readableOn(accent);
  return {
    ...plan,
    palette: {
      background,
      surface: HEX.test(plan.palette.surface) ? plan.palette.surface : "#FFFFFF",
      text:
        contrastRatio(textCandidate, background) >= 4.5 ? textCandidate : readableOn(background),
      muted: HEX.test(plan.palette.muted) ? plan.palette.muted : "#6F696D",
      accent,
      accentContrast:
        contrastRatio(contrastCandidate, accent) >= 4.5 ? contrastCandidate : readableOn(accent),
    },
    motifs:
      plan.motifs.length >= 2
        ? plan.motifs.slice(0, 4)
        : ["linhas editoriais", "formas geométricas"],
  };
};

const inspectionFromImage = (image: {
  readonly visualDescription?: string | undefined;
  readonly visualSubjects?: ReadonlyArray<string> | undefined;
  readonly dominantColors?: ReadonlyArray<string> | undefined;
  readonly containsText?: boolean | undefined;
  readonly containsFace?: boolean | undefined;
  readonly containsProduct?: boolean | undefined;
  readonly safeForBrandUse?: boolean | undefined;
  readonly allowedRoles?: ReadonlyArray<string> | undefined;
  readonly inspectionWarnings?: ReadonlyArray<string> | undefined;
  readonly inspectionConfidence?: number | undefined;
}): VisualAssetInspection | null =>
  image.visualDescription === undefined
    ? null
    : {
        description: image.visualDescription,
        subjects: image.visualSubjects ?? [],
        dominantColors: image.dominantColors ?? [],
        containsText: image.containsText ?? false,
        containsFace: image.containsFace ?? false,
        containsProduct: image.containsProduct ?? false,
        safeForBrandUse: image.safeForBrandUse ?? false,
        allowedRoles: (image.allowedRoles ?? []).filter(
          (
            role,
          ): role is
            | "style_reference"
            | "background"
            | "subject"
            | "product"
            | "portrait"
            | "logo" =>
            ["style_reference", "background", "subject", "product", "portrait", "logo"].includes(
              role,
            ),
        ),
        warnings: image.inspectionWarnings ?? [],
        confidence: image.inspectionConfidence ?? 0,
      };

const ensureProfile = async (
  ctx: ActionCtx,
  accountId: Id<"accounts">,
  force: boolean,
): Promise<Id<"brandVisualProfiles">> => {
  if (!force) {
    const existing = await ctx.runQuery(internal.visualBrand.latestInternal, { accountId });
    if (existing?.status === "ready") return existing._id;
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set on the Convex deployment");
  const input = await ctx.runQuery(internal.visualBrand.loadInput, { accountId });
  if (!input) throw new Error("visual brand input not found");
  const inspectedAssets: Array<{ id: string; inspection: VisualAssetInspection }> = [];
  for (const reference of input.references) {
    let inspection = inspectionFromImage(reference.image);
    if (!inspection && reference.url) {
      try {
        const response = await fetch(reference.url);
        if (!response.ok) throw new Error(`asset download HTTP ${response.status}`);
        const image = await response.blob();
        inspection = await Effect.runPromise(
          Effect.flatMap(AssetInspector, (service) =>
            service.inspect({
              image,
              context: `${input.account.name}; ${input.facts.map((fact) => fact.text).join("; ")}`,
            }),
          ).pipe(Effect.provide(openRouterAssetInspectorLayer(apiKey))),
        );
        await ctx.runMutation(internal.visualBrand.saveInspection, {
          imageId: reference.image._id,
          description: inspection.description,
          subjects: [...inspection.subjects],
          dominantColors: [...inspection.dominantColors],
          containsText: inspection.containsText,
          containsFace: inspection.containsFace,
          containsProduct: inspection.containsProduct,
          safeForBrandUse: inspection.safeForBrandUse,
          allowedRoles: [...inspection.allowedRoles],
          warnings: [...inspection.warnings],
          confidence: inspection.confidence,
        });
      } catch (error) {
        await ctx.runMutation(internal.visualBrand.markInspectionFailed, {
          imageId: reference.image._id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (inspection) inspectedAssets.push({ id: String(reference.image._id), inspection });
  }
  const planned = await runTracked(
    ctx,
    {
      accountId,
      stage: "studio_visual_brand",
      model: PIPELINE_MODELS.studioVisualBrand,
      promptVersion: PROMPT_VERSIONS.studioVisualBrand,
      inputIds: input.references.map((reference) => reference.image._id),
    },
    () =>
      Effect.runPromise(
        planVisualBrand({
          accountName: input.account.name ?? "Marca",
          kind: input.account.kind ?? "negocio",
          facts: input.facts,
          assets: inspectedAssets,
        }).pipe(Effect.provide(languageModelLayer(apiKey, PIPELINE_MODELS.studioVisualBrand))),
      ),
    (result) => result.name,
  );
  const profile = repairPlan(planned);
  const validation = validateVisualBrand(profile);
  if (!validation.valid)
    throw new Error(`visual profile remained invalid: ${validation.issues.join(", ")}`);
  return ctx.runMutation(internal.visualBrand.saveProfile, {
    accountId,
    referenceImageIds: input.references.map((reference) => reference.image._id),
    validationIssues: [...validateVisualBrand(planned).issues],
    textContrast: validation.textContrast,
    accentContrast: validation.accentContrast,
    model: PIPELINE_MODELS.studioVisualBrand,
    promptVersion: PROMPT_VERSIONS.studioVisualBrand,
    ...(profile as Mutable<VisualBrandPlan>),
  });
};

export const ensureInternal = internalAction({
  args: { accountId: v.id("accounts"), force: v.optional(v.boolean()) },
  handler: (ctx, { accountId, force }) => ensureProfile(ctx, accountId, force ?? false),
});

export const ensure = action({
  args: { accountId: v.id("accounts"), force: v.optional(v.boolean()) },
  handler: async (ctx, { accountId, force }) => {
    await ctx.runQuery(internal.visualBrand.requireAccountOwner, { accountId });
    return ensureProfile(ctx, accountId, force ?? false);
  },
});
