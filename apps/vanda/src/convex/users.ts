import { v } from "convex/values";
import { DEFAULT_ORCHESTRATOR_MODEL, orchestratorModel } from "./agentModels";
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
 * The orchestrator picker's state: the chosen model plus whether this owner is
 * on Conectado — which is what makes the Anthropic options unavailable (their
 * ChatGPT subscription can only serve OpenAI models).
 */
export const agentModel = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ modelId: string; conectado: boolean } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return null;
    return {
      modelId: orchestratorModel(user.orchestratorModel)?.id ?? DEFAULT_ORCHESTRATOR_MODEL,
      conectado: isConnectedSubscriber(user),
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

