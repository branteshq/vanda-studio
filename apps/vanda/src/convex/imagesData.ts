import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { chargeUsage } from "./usage";
import { isErrorCode } from "../errors";
import { errorCodeValidator } from "./publicErrors";

interface PaintCharge {
  accountId: Id<"accounts">;
  kind: string;
  usd: number;
  ref?: string;
  activityId?: Id<"chatThreadActivity">;
}

const loadOwnedImage = async (ctx: QueryCtx, accountId: Id<"accounts">, imageId: Id<"images">) => {
  const image = await ctx.db.get(imageId);

  if (!image || image.accountId !== accountId) throw new Error("image not found");

  return image;
};

/** Resolve rows only after enforcing account ownership and reference purpose. */
export const resolvePaintInput = internalQuery({
  args: {
    accountId: v.id("accounts"),
    referenceImageIds: v.array(v.id("images")),
    editOfImageId: v.optional(v.id("images")),
  },
  handler: async (ctx, { accountId, referenceImageIds, editOfImageId }) => {
    if (!(await ctx.db.get(accountId))) throw new Error("account not found");

    const references = await Promise.all(
      referenceImageIds.map(async (imageId) => {
        // Account ownership is the boundary — any image the account owns (an
        // attached upload, a painted asset, or a Perfil reference) may condition
        // generation. The model can only reproduce a person's likeness from a
        // photo already in this account, so `purpose` is not a security gate.
        const image = await loadOwnedImage(ctx, accountId, imageId);

        return {
          imageId: image._id,
          externalUrl: image.externalUrl ?? null,
          storageId: image.storageId ?? null,
          referenceKind: image.referenceKind ?? null,
        };
      }),
    );

    const editSource = editOfImageId
      ? await loadOwnedImage(ctx, accountId, editOfImageId).then((image) => ({
          imageId: image._id,
          externalUrl: image.externalUrl ?? null,
          storageId: image.storageId ?? null,
        }))
      : null;

    return { references, editSource };
  },
});

/** Record a loose painted image asset; it intentionally has no post/project link. */
export const savePaintedImage = internalMutation({
  args: {
    accountId: v.id("accounts"),
    storageId: v.id("_storage"),
    prompt: v.string(),
    mimeType: v.string(),
    width: v.number(),
    height: v.number(),
    model: v.optional(v.string()),
    costUsd: v.optional(v.number()),
    generationMs: v.optional(v.number()),
    name: v.optional(v.string()),
    promptAuthor: v.optional(v.union(v.literal("vanda"), v.literal("user"))),
    // Links a run_code output back to its execution record.
    codeRunId: v.optional(v.id("codeRuns")),
    // Links a paint edit back to the image it modified.
    editOfImageId: v.optional(v.id("images")),
    // Gallery fan-outs pre-insert a "generating" row; passing it here fills
    // that row in place (keeping its grid position) instead of inserting.
    placeholderId: v.optional(v.id("images")),
    // Chat output may persist only while its exact originating turn is active.
    activityId: v.optional(v.id("chatThreadActivity")),
  },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.accountId))) throw new Error("account not found");

    if (args.activityId) {
      const activity = await ctx.db.get(args.activityId);

      if (!activity || activity.accountId !== args.accountId) {
        throw new Error("activity expired");
      }
    }

    const fields: Pick<
      Doc<"images">,
      "storageId" | "prompt" | "mimeType" | "width" | "height" | "description" | "altText"
    > &
      Partial<
        Pick<
          Doc<"images">,
          | "name"
          | "model"
          | "costUsd"
          | "generationMs"
          | "promptAuthor"
          | "codeRunId"
          | "editOfImageId"
        >
      > = {
      storageId: args.storageId,
      prompt: args.prompt,
      mimeType: args.mimeType,
      width: args.width,
      height: args.height,
      description: args.prompt,
      altText: args.name ?? args.prompt,
    };

    if (args.name) fields.name = args.name;

    if (args.model) fields.model = args.model;

    if (args.costUsd !== undefined) fields.costUsd = args.costUsd;

    if (args.generationMs !== undefined) fields.generationMs = args.generationMs;

    if (args.promptAuthor) fields.promptAuthor = args.promptAuthor;

    if (args.codeRunId) fields.codeRunId = args.codeRunId;

    if (args.editOfImageId) fields.editOfImageId = args.editOfImageId;

    // run_code images carry a share of the sandbox cost for display, but the
    // sandbox itself is charged once in finishCodeRun — only paints bill here.
    if (args.costUsd && !args.codeRunId) {
      const charge: PaintCharge = {
        accountId: args.accountId,
        kind: "paint",
        usd: args.costUsd,
      };

      if (args.model) charge.ref = args.model;

      if (args.activityId) charge.activityId = args.activityId;

      await chargeUsage(ctx, charge);
    }

    if (args.placeholderId) {
      const placeholder = await ctx.db.get(args.placeholderId);

      if (!placeholder || placeholder.accountId !== args.accountId) {
        throw new Error("placeholder not found");
      }

      await ctx.db.patch(args.placeholderId, {
        ...fields,
        status: undefined,
        generationError: undefined,
        generationErrorCode: undefined,
      });

      return args.placeholderId;
    }

    return ctx.db.insert("images", {
      accountId: args.accountId,
      origin: "generated",
      purpose: "post",
      ...fields,
      createdAt: Date.now(),
    });
  },
});

/** Mark a gallery placeholder as failed so the grid can show why. */
export const markPaintFailed = internalMutation({
  args: {
    imageId: v.id("images"),
    generationErrorCode: v.optional(errorCodeValidator),
    // Compatibility for already-scheduled calls. Only exact catalog codes are
    // accepted; arbitrary diagnostics are never parsed or persisted.
    error: v.optional(v.string()),
  },
  handler: async (ctx, { imageId, generationErrorCode, error }) => {
    const image = await ctx.db.get(imageId);

    if (!image || image.status !== "generating") return;
    await ctx.db.patch(imageId, {
      status: "failed",
      generationError: undefined,
      generationErrorCode: generationErrorCode ?? (isErrorCode(error) ? error : "UNEXPECTED"),
    });
  },
});
