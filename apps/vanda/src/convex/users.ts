import { v } from "convex/values";
import { z } from "zod";
import { DEFAULT_IMAGE_MODEL, isKnownImageModel } from "./imageModels";
import type { Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireUser } from "./authz";
import { modelPreferencesOf, writeSetting } from "./settings/registry";

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
 * The model pickers' state. Conectado constrains both agents and image choices.
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

    return modelPreferencesOf(user);
  },
});

// The pickers write through the settings registry, the same path the agents use.

/** Choose the model Vanda thinks with. Only catalog models are accepted. */
export const setAgentModel = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, { modelId }): Promise<void> => {
    await writeSetting(ctx, await requireUser(ctx), "models.vanda", modelId);
  },
});

/** Caetano follows the same transport policy as Vanda. */
export const setCaetanoModel = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, { modelId }): Promise<void> => {
    await writeSetting(ctx, await requireUser(ctx), "models.caetano", modelId);
  },
});

/** Choose the default painter, validating the subscription transport when active. */
export const setImageModel = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, { modelId }): Promise<void> => {
    await writeSetting(ctx, await requireUser(ctx), "models.image", modelId);
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
