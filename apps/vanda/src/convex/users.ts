import { v } from "convex/values";
import { z } from "zod";
import { orchestratorModel, resolveCaetanoModel, resolveOrchestratorModel } from "./agentModels";
import {
  DEFAULT_IMAGE_MODEL,
  isKnownImageModel,
  isConnectedImageModel,
  resolveConnectedImageModel,
} from "./imageModels";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireUser } from "./authz";
import { isConnectedSubscriber } from "./openaiSub";

const identityProfileSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  pictureUrl: z.string().optional(),
});

interface UserIdentityPatch {
  name: string;
  email: string;
  updatedAt: number;
  imageUrl?: string;
}

interface NewUser extends UserIdentityPatch {
  clerkId: string;
  createdAt: number;
}

function normalizeName(name: string | undefined, email: string | undefined): string {
  if (name?.trim()) return name.trim();

  if (email?.includes("@")) return email.split("@")[0]!.trim();

  return "User";
}

function normalizeEmail(email: string | undefined): string {
  return email?.trim() ?? "";
}

export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) throw new Error("Not authenticated");

    const now = Date.now();
    const profile = identityProfileSchema.parse(identity);
    const name = normalizeName(profile.name, profile.email);
    const email = normalizeEmail(profile.email);
    const imageUrl = profile.pictureUrl;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (existing) {
      const patch: UserIdentityPatch = {
        name,
        email,
        updatedAt: now,
      };

      if (imageUrl) patch.imageUrl = imageUrl;
      await ctx.db.patch(existing._id, patch);

      return existing._id;
    }

    const user: NewUser = {
      name,
      email,
      clerkId: identity.subject,
      createdAt: now,
      updatedAt: now,
    };

    if (imageUrl) user.imageUrl = imageUrl;

    return await ctx.db.insert("users", user);
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) return null;

    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
  },
});

/**
 * The model pickers' state. Conectado constrains Vanda's text/image choices,
 * while Caetano keeps using Vanda's OpenRouter budget on every plan.
 * Conectado inference rides their ChatGPT subscription, so the orchestrator is
 * limited to supported OpenAI text and image models.
 */
export const modelPreferences = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    orchestrator: string;
    caetano: string;
    image: string;
    conectado: boolean;
  } | null> => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) return null;
    const conectado = isConnectedSubscriber(user);

    return {
      orchestrator: resolveOrchestratorModel(user.orchestratorModel, { conectado }),
      caetano: resolveCaetanoModel(user.caetanoModel),
      image: conectado
        ? resolveConnectedImageModel(user.imageModel)
        : user.imageModel && isKnownImageModel(user.imageModel)
          ? user.imageModel
          : DEFAULT_IMAGE_MODEL,
      conectado,
    };
  },
});

/** Choose the model Vanda thinks with. Only catalog ids are accepted. */
export const setAgentModel = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, { modelId }): Promise<void> => {
    const user = await requireUser(ctx);
    const model = orchestratorModel(modelId);

    if (!model) throw new Error("modelo desconhecido");

    if (!model.codexCapable && isConnectedSubscriber(user)) {
      throw new Error(
        "este modelo não roda pela sua assinatura do ChatGPT — escolha um modelo OpenAI ou mude de plano",
      );
    }

    await ctx.db.patch(user._id, { orchestratorModel: model.id, updatedAt: Date.now() });
  },
});

/** Caetano always uses OpenRouter, independently of Vanda's transport. */
export const setCaetanoModel = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, { modelId }): Promise<void> => {
    const user = await requireUser(ctx);
    const model = orchestratorModel(modelId);

    if (!model) throw new Error("modelo desconhecido");
    await ctx.db.patch(user._id, { caetanoModel: model.id, updatedAt: Date.now() });
  },
});

/**
 * Choose the default painter, validating the subscription transport when active.
 */
export const setImageModel = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, { modelId }): Promise<void> => {
    const user = await requireUser(ctx);

    if (!isKnownImageModel(modelId)) throw new Error("modelo de imagem desconhecido");

    if (isConnectedSubscriber(user) && !isConnectedImageModel(modelId)) {
      throw new Error("modelo indisponível pela assinatura do ChatGPT");
    }

    await ctx.db.patch(user._id, { imageModel: modelId, updatedAt: Date.now() });
  },
});

/** The account owner's chosen model — the agent turn reads this. */
export const orchestratorModelForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<string | undefined> => {
    const account = await ctx.db.get(accountId);
    const ownerId: Id<"users"> | undefined = account?.ownerUserId;

    if (!ownerId) return undefined;
    const user = await ctx.db.get(ownerId);

    return user?.orchestratorModel;
  },
});

/**
 * The account owner's default painter — what `paint` falls back to when the
 * caller names no model. Unknown/absent collapses to the catalog default.
 */
export const imageModelForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<string> => {
    const account = await ctx.db.get(accountId);
    const ownerId: Id<"users"> | undefined = account?.ownerUserId;

    if (!ownerId) return DEFAULT_IMAGE_MODEL;
    const user = await ctx.db.get(ownerId);

    return user?.imageModel && isKnownImageModel(user.imageModel)
      ? user.imageModel
      : DEFAULT_IMAGE_MODEL;
  },
});
