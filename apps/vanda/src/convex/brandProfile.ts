import { createThread, saveMessage, updateThreadMetadata } from "@convex-dev/agent";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import {
  brandFileContent,
  brandGuide,
  confirmBrandGuesses,
  saveBrandFile,
  writeOnboardingBrandFile,
} from "./brandFile";
import { startThreadActivity } from "./chat";
import { isPlatformTurn, platformTurn } from "./platformTurn";
import { loadReferences } from "./references";

/** The brand guide's sections, read from the account's brand file. */
const guideSections = async (ctx: QueryCtx, accountId: Id<"accounts">) =>
  brandGuide(await brandFileContent(ctx, accountId));

/** The hidden message that starts the guide: Caetano reads the account, then asks. */
export const GUIDE_START = platformTurn(
  "O dono acabou de abrir o guia da marca. Leia o Instagram conectado e comece a conversa.",
);

/**
 * Open Caetano's brand guide thread and link it to the account. The first turn is
 * Caetano's: he reads the connected Instagram with his tools and writes the first message.
 */
const openGuideThread = async (ctx: MutationCtx, accountId: Id<"accounts">): Promise<string> => {
  // Threads are keyed by the account id (multi-thread model, see chat.ts).
  const threadId = await createThread(ctx, components.agent, {
    userId: String(accountId),
    title: "Guia da marca",
  });

  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId,
    message: { role: "user", content: GUIDE_START },
  });

  // The replaced guide is archived so it leaves the conversation list.
  const previous = (await ctx.db.get(accountId))?.brandGuideThreadId;

  if (previous !== undefined) {
    await updateThreadMetadata(ctx, components.agent, {
      threadId: previous,
      patch: { status: "archived" },
    });
  }

  await ctx.db.patch(accountId, { brandGuideThreadId: threadId });

  const activityId = await startThreadActivity(ctx, accountId, threadId, messageId);
  await ctx.scheduler.runAfter(0, internal.chat.generateResponse, {
    accountId,
    threadId,
    promptMessageId: messageId,
    activityId,
  });

  return threadId;
};

/**
 * The end of onboarding, once Instagram is connected: the account gets an empty
 * brand file and becomes the owner's active business. Caetano's guide (`openGuide`)
 * fills the file from there. Idempotent.
 */
export const onboard = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<void> => {
    const account = await requireOwnedAccount(ctx, accountId);

    if (account.onboardedAt !== undefined) return;

    await writeOnboardingBrandFile(ctx, accountId, []);

    const now = Date.now();
    await ctx.db.patch(accountId, { onboardedAt: now, updatedAt: now });

    if (account.ownerUserId !== undefined) {
      await ctx.db.patch(account.ownerUserId, { activeAccountId: accountId, updatedAt: now });
    }
  },
});

/**
 * Caetano's brand guide thread until the owner approves his draft of the brand
 * file: opened on first need, and again when the file was cleared after the
 * owner answered. Null once the guide is done.
 */
export const openGuide = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<string | null> => {
    const account = await requireOwnedAccount(ctx, accountId);

    const sections = await guideSections(ctx, accountId);
    // A cleared file restarts only a thread the owner already answered in; an untouched one is reused.
    const cleared = sections.every((section) => !section.filled);

    if (account.brandGuideDoneAt !== undefined) {
      if (!cleared) return null;
      // The owner emptied an approved file: the guide starts over.
      await ctx.db.patch(accountId, { brandGuideDoneAt: undefined });
    }

    const threadId = account.brandGuideThreadId;

    if (threadId !== undefined) {
      const page = cleared
        ? await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
            threadId,
            order: "desc",
            // Caetano's reading turn is a few tool steps; an answer shows up within these.
            paginationOpts: { cursor: null, numItems: 50 },
          })
        : null;

      const answered =
        page?.page.some(
          (message) =>
            message.message?.role === "user" && !isPlatformTurn(message.text ?? GUIDE_START),
        ) ?? false;

      if (!answered) return threadId;
    }

    return openGuideThread(ctx, accountId);
  },
});

/**
 * The owner approved Caetano's draft in the guide thread: his (Vanda) guesses
 * become (dono) and the guide ends (the onboarding page shows "Guia pronto.").
 * Only the account's guide thread may end it.
 */
export const finishGuide = internalMutation({
  args: { accountId: v.id("accounts"), threadId: v.string() },
  handler: async (
    ctx,
    { accountId, threadId },
  ): Promise<{ ok: true; confirmed: number } | { ok: false; error: string }> => {
    const account = await ctx.db.get(accountId);

    if (!account || account.brandGuideThreadId !== threadId) {
      return { ok: false, error: "só a conversa do guia da marca pode encerrar o guia" };
    }

    const { content, confirmed } = confirmBrandGuesses(await brandFileContent(ctx, accountId));

    if (confirmed > 0) {
      const saved = await saveBrandFile(ctx, accountId, content, "vanda");

      if (!saved.ok) return { ok: false, error: saved.error };
    }

    if (account.brandGuideDoneAt === undefined) {
      await ctx.db.patch(accountId, { brandGuideDoneAt: Date.now() });
    }

    return { ok: true, confirmed };
  },
});

// --- Reference photos (brand reference images for personal brands) ----------

/**
 * A short-lived upload URL for a reference photo. Auth-gated; the uploaded file is
 * linked to an account by `addReferencePhoto` once the client finishes the upload.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) throw new Error("Not authenticated");

    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Link an uploaded file to an account as a brand reference photo (personal brands).
 * Validates the upload exists and is unlinked first: a double-submit (or a reused
 * id) would otherwise create rows sharing one blob, so removing one breaks the
 * rest. Idempotent — relinking the same upload returns the existing row.
 */
export const addReferencePhoto = mutation({
  args: {
    accountId: v.id("accounts"),
    storageId: v.id("_storage"),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    kind: v.optional(
      v.union(v.literal("face"), v.literal("product"), v.literal("place"), v.literal("style")),
    ),
  },
  handler: async (ctx, { accountId, storageId, width, height, kind }) => {
    await requireOwnedAccount(ctx, accountId);

    // getUrl is null for an unknown/expired upload — reject before linking a dead id.
    if ((await ctx.storage.getUrl(storageId)) === null) throw new Error("upload not found");

    const existing = await ctx.db
      .query("images")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();

    if (existing !== null) return existing._id;

    const now = Date.now();

    return ctx.db.insert("images", {
      accountId,
      origin: "uploaded",
      purpose: "reference",
      storageId,
      createdAt: now,
      referenceLabels: [kind ?? "style"],
      referenceAddedBy: "owner",
      referenceAddedAt: now,
      referenceSource: "enviada",
      ...(kind !== undefined && { referenceKind: kind }),
      ...(width !== undefined && { width }),
      ...(height !== undefined && { height }),
    });
  },
});

/** The owner's brand reference photos, with resolved URLs for display. */
export const listReferencePhotos = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }) => {
    await requireOwnedAccount(ctx, accountId);

    const references = (await loadReferences(ctx, accountId)).filter(
      (image) => image.purpose === "reference",
    );

    return Promise.all(
      references.map(async (image) => ({
        id: image._id,
        url: image.storageId === undefined ? null : await ctx.storage.getUrl(image.storageId),
      })),
    );
  },
});

/** Remove a reference photo the caller owns (deletes the row; the blob only when
 *  no other image row still references it). */
export const removeReferencePhoto = mutation({
  args: { imageId: v.id("images") },
  handler: async (ctx, { imageId }) => {
    const image = await ctx.db.get(imageId);

    if (image === null || image.purpose !== "reference") {
      throw new Error("reference photo not found");
    }

    await requireOwnedAccount(ctx, image.accountId);
    await ctx.db.delete(imageId);

    if (image.storageId !== undefined) {
      const stillLinked = await ctx.db
        .query("images")
        .withIndex("by_storage", (q) => q.eq("storageId", image.storageId))
        .first();

      if (stillLinked === null) await ctx.storage.delete(image.storageId);
    }
  },
});
