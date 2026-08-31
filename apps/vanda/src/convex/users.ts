import { v } from "convex/values";
import { orchestratorModel, resolveOrchestratorModel } from "./agentModels";
import { DEFAULT_IMAGE_MODEL, isKnownImageModel } from "./imageModels";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireUser } from "./authz";
import { isConnectedSubscriber } from "./openaiSub";

function normalizeName(name: unknown, email: unknown): string {
  if (typeof name === "string" && name.trim()) return name.trim();
  if (typeof email === "string" && email.includes("@")) return email.split("@")[0]!.trim();
  return "User";
}

function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim() : "";
}

export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const now = Date.now();
    const name = normalizeName(identity.name, identity.email);
    const email = normalizeEmail(identity.email);
    const imageUrl = typeof identity.pictureUrl === "string" ? identity.pictureUrl : undefined;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        email,
        ...(imageUrl ? { imageUrl } : {}),
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      name,
      email,
      clerkId: identity.subject,
      ...(imageUrl ? { imageUrl } : {}),
      createdAt: now,
      updatedAt: now,
    });
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
 * The model pickers' state: who thinks (orchestrator) and who paints (image),
 * plus whether this owner is on Conectado — the flag that constrains both.
 * Conectado inference rides their ChatGPT subscription, so the orchestrator is
 * limited to OpenAI models and every paint collapses to gpt-image-2.
 */
export const modelPreferences = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ orchestrator: string; image: string; conectado: boolean } | null> => {
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
      image:
        user.imageModel && isKnownImageModel(user.imageModel)
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

/**
 * Choose the model Vanda paints with by default. Refused on Conectado, where
 * the plan itself decides (gpt-image-2 on the owner's subscription) — storing
 * a preference we'd never honour would be a lie told by the UI.
 */
export const setImageModel = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, { modelId }): Promise<void> => {
    const user = await requireUser(ctx);
    if (!isKnownImageModel(modelId)) throw new Error("modelo de imagem desconhecido");
    if (isConnectedSubscriber(user)) {
      throw new Error(
        "no plano ChatGPT toda imagem usa o GPT Image 2 pela sua assinatura — não dá para trocar",
      );
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
