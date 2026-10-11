import { createThread, saveMessage, updateThreadMetadata } from "@convex-dev/agent";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireOwnedAccount } from "./authz";
import { brandFileContent, brandGuide, writeOnboardingBrandFile } from "./brandFile";
import { brandFactArg, brandKindValidator } from "./pipeline/storage";
import { saveDocument } from "./workspace/documents";

/**
 * Resolve the connected Instagram handle (or null), whether the account is onboarded, and
 * whether its brand guide is empty, for an account the caller owns. `brandProfileNode.onboard`
 * passes its verified Clerk id; ownership is checked again here before first-party account
 * data is read through the publisher profile.
 */
/** The brand guide's sections, read from the account's brand file. */
const guideSections = async (ctx: QueryCtx, accountId: Id<"accounts">) =>
  brandGuide(await brandFileContent(ctx, accountId));

export const resolveOwnedHandle = internalQuery({
  args: { accountId: v.id("accounts"), clerkId: v.string() },
  handler: async (
    ctx,
    { accountId, clerkId },
  ): Promise<{ handle: string | null; onboarded: boolean; guideEmpty: boolean }> => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();

    const account = await ctx.db.get(accountId);

    if (!user || account === null || account.ownerUserId !== user._id) {
      throw new Error("account not found");
    }

    return {
      handle: account.handle ?? null,
      onboarded: account.onboardedAt !== undefined,
      guideEmpty: (await guideSections(ctx, accountId)).every((s) => !s.filled),
    };
  },
});

/** Caetano's greeting, opening every message he sends first in a conversation. */
export const CAETANO_HELLO = "Oi! Eu sou o Caetano.";

/** Without an Instagram read, Caetano opens the guide with the basics. */
const FALLBACK_OPENER = `${CAETANO_HELLO} Não consegui ler seu Instagram agora, mas a gente monta seu guia da marca aqui mesmo, rapidinho. Me conta: o que você vende, e pra quem?`;

/** Open Caetano's brand guide thread with his first message and link it to the account. */
const openGuideThread = async (
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  opener: string,
): Promise<string> => {
  // Threads are keyed by the account id (multi-thread model, see chat.ts).
  const threadId = await createThread(ctx, components.agent, {
    userId: String(accountId),
    title: "Guia da marca",
  });

  await saveMessage(ctx, components.agent, {
    threadId,
    agentName: "caetano",
    message: { role: "assistant", content: opener },
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

  return threadId;
};

/**
 * The end of onboarding (`brandProfileNode.onboard`): the Instagram read opens
 * the brand file, the account is marked onboarded, and Caetano opens the brand
 * guide thread with his first question (written from the posts); that
 * conversation fills the file. A business already onboarded only gets this again
 * while its brand guide is empty (a cleared file reconnected): the read refills
 * the file and a fresh guide thread opens. `note` is the read's evidence for Caetano.
 * Idempotent: a retry after finishing is a no-op.
 */
export const completeOnboarding = internalMutation({
  args: {
    accountId: v.id("accounts"),
    kind: v.union(brandKindValidator, v.null()),
    facts: v.array(brandFactArg),
    opener: v.union(v.string(), v.null()),
    note: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { accountId, kind, facts, opener, note }) => {
    const account = await ctx.db.get(accountId);

    if (account === null) return;

    const guideEmpty = (await guideSections(ctx, accountId)).every((s) => !s.filled);

    if (account.onboardedAt !== undefined && !guideEmpty) return;

    await writeOnboardingBrandFile(ctx, accountId, facts);

    if (note) await saveDocument(ctx, accountId, "/notes/leitura-instagram.md", note);
    // One question per message: the model sometimes asks two, so the opener ends at its first "?".
    const firstQuestion = opener?.trim().replace(/\?[\s\S]*$/, "?");

    await openGuideThread(ctx, accountId, firstQuestion || FALLBACK_OPENER);

    if (account.onboardedAt !== undefined) return;

    const now = Date.now();
    await ctx.db.patch(accountId, {
      kind: kind ?? "negocio",
      onboardedAt: now,
      updatedAt: now,
    });

    if (account.ownerUserId !== undefined) {
      await ctx.db.patch(account.ownerUserId, { activeAccountId: accountId, updatedAt: now });
    }
  },
});

/**
 * Caetano's brand guide thread for a business whose brand file still has gaps,
 * opened on first need for businesses onboarded before the guide existed. Null
 * when the file is complete.
 */
export const openGuide = mutation({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<string | null> => {
    const account = await requireOwnedAccount(ctx, accountId);

    const sections = await guideSections(ctx, accountId);

    if (sections.every((section) => section.filled)) return null;

    const threadId = account.brandGuideThreadId;
    // A cleared file restarts only a thread the owner already answered in; an untouched one is reused.
    const cleared = sections.every((section) => !section.filled);

    if (threadId !== undefined) {
      const page = cleared
        ? await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
            threadId,
            order: "desc",
            paginationOpts: { cursor: null, numItems: 2 },
          })
        : null;

      if (page === null || page.page.length <= 1) return threadId;
    }

    const opener = `${CAETANO_HELLO} Quero entender bem o seu negócio para cuidar do seu Instagram do jeito certo. Me conta: o que vocês fazem de melhor?`;

    return openGuideThread(ctx, accountId, opener);
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

    return ctx.db.insert("images", {
      accountId,
      origin: "uploaded",
      purpose: "reference",
      storageId,
      createdAt: Date.now(),
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

    const images = await ctx.db
      .query("images")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();

    const references = images.filter((image) => image.purpose === "reference");

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
