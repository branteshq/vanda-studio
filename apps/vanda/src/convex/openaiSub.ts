import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireUser } from "./authz";
import { tierOfPlan } from "./billing/plans";

/**
 * The Conectado plan's OpenAI connection: the ChatGPT device-code OAuth flow
 * (the web equivalent of pi's flow — OpenAI holds the PKCE verifier and hands
 * it back when the user approves the code), plus the queries that decide when
 * inference routes through the user's subscription instead of OpenRouter.
 *
 * Token encryption/decryption lives in openaiSubNode.ts ("use node" crypto);
 * this module only ever handles ciphertext.
 */

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTH_BASE_URL = "https://auth.openai.com";
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
export const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

/** The tier whose inference rides the user's ChatGPT subscription. */
export const CONNECTED_TIER = "conectado";

const decodeAccountId = (accessToken: string): string | null => {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload)) as {
      [JWT_CLAIM_PATH]?: { chatgpt_account_id?: string };
    };
    return decoded[JWT_CLAIM_PATH]?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
};

/** Step 1: request a device code the user types at openai.com. */
export const startDeviceAuth = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    deviceAuthId: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds: number;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const response = await fetch(DEVICE_USER_CODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    });
    if (!response.ok) {
      throw new Error(`Falha ao iniciar a conexão com a OpenAI (HTTP ${response.status})`);
    }
    const json = (await response.json()) as {
      device_auth_id?: string;
      user_code?: string;
      interval?: number | string;
    };
    const interval = typeof json.interval === "string" ? Number(json.interval) : json.interval;
    if (!json.device_auth_id || !json.user_code) {
      throw new Error("Resposta inválida da OpenAI ao iniciar a conexão");
    }
    return {
      deviceAuthId: json.device_auth_id,
      userCode: json.user_code,
      verificationUri: DEVICE_VERIFICATION_URI,
      intervalSeconds: Number.isFinite(interval) ? Math.max(interval as number, 3) : 5,
    };
  },
});

/**
 * Step 2: the UI polls this until the user approves the code. On approval,
 * exchanges the authorization code for tokens and stores them encrypted.
 */
export const pollDeviceAuth = action({
  args: { deviceAuthId: v.string(), userCode: v.string() },
  handler: async (
    ctx,
    { deviceAuthId, userCode },
  ): Promise<{ status: "pending" | "complete" | "failed"; message?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const response = await fetch(DEVICE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    });
    if (response.status === 403 || response.status === 404) return { status: "pending" };
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let code: unknown;
      try {
        const parsed = JSON.parse(body) as { error?: string | { code?: string } };
        code = typeof parsed.error === "object" ? parsed.error?.code : parsed.error;
      } catch {
        // non-JSON error body
      }
      if (code === "deviceauth_authorization_pending" || code === "slow_down") {
        return { status: "pending" };
      }
      return { status: "failed", message: `OpenAI respondeu HTTP ${response.status}` };
    }
    const approved = (await response.json()) as {
      authorization_code?: string;
      code_verifier?: string;
    };
    if (!approved.authorization_code || !approved.code_verifier) {
      return { status: "failed", message: "Resposta de aprovação inválida" };
    }

    const exchange = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code: approved.authorization_code,
        code_verifier: approved.code_verifier,
        redirect_uri: DEVICE_REDIRECT_URI,
      }),
    });
    if (!exchange.ok) {
      return { status: "failed", message: `Troca de tokens falhou (HTTP ${exchange.status})` };
    }
    const tokens = (await exchange.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token || !tokens.refresh_token || typeof tokens.expires_in !== "number") {
      return { status: "failed", message: "Tokens ausentes na resposta da OpenAI" };
    }
    const accountId = decodeAccountId(tokens.access_token);
    if (!accountId) return { status: "failed", message: "Conta ChatGPT não identificada no token" };

    await ctx.runAction(internal.openaiSubNode.encryptAndStore, {
      clerkId: identity.subject,
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      accountId,
    });
    return { status: "complete" };
  },
});

/** Ciphertext write path for encryptAndStore (node actions can't touch db). */
export const saveTokens = internalMutation({
  args: {
    clerkId: v.string(),
    accountId: v.string(),
    accessCiphertext: v.string(),
    accessIv: v.string(),
    accessAuthTag: v.string(),
    refreshCiphertext: v.string(),
    refreshIv: v.string(),
    refreshAuthTag: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
    if (!user) throw new Error("user not found");
    await ctx.db.patch(user._id, {
      openaiAccountId: args.accountId,
      openaiAccessCiphertext: args.accessCiphertext,
      openaiAccessIv: args.accessIv,
      openaiAccessAuthTag: args.accessAuthTag,
      openaiRefreshCiphertext: args.refreshCiphertext,
      openaiRefreshIv: args.refreshIv,
      openaiRefreshAuthTag: args.refreshAuthTag,
      openaiTokenExpiresAt: args.expiresAt,
      openaiConnectedAt: user.openaiConnectedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  },
});

/** Refresh writes new ciphertexts by userId (no identity in background). */
export const saveRefreshedTokens = internalMutation({
  args: {
    userId: v.id("users"),
    accessCiphertext: v.string(),
    accessIv: v.string(),
    accessAuthTag: v.string(),
    refreshCiphertext: v.string(),
    refreshIv: v.string(),
    refreshAuthTag: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { userId, ...fields }) => {
    await ctx.db.patch(userId, {
      openaiAccessCiphertext: fields.accessCiphertext,
      openaiAccessIv: fields.accessIv,
      openaiAccessAuthTag: fields.accessAuthTag,
      openaiRefreshCiphertext: fields.refreshCiphertext,
      openaiRefreshIv: fields.refreshIv,
      openaiRefreshAuthTag: fields.refreshAuthTag,
      openaiTokenExpiresAt: fields.expiresAt,
      updatedAt: Date.now(),
    });
  },
});

export const tokensOf = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Doc<"users"> | null> => ctx.db.get(userId),
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, {
      openaiAccountId: undefined,
      openaiAccessCiphertext: undefined,
      openaiAccessIv: undefined,
      openaiAccessAuthTag: undefined,
      openaiRefreshCiphertext: undefined,
      openaiRefreshIv: undefined,
      openaiRefreshAuthTag: undefined,
      openaiTokenExpiresAt: undefined,
      openaiConnectedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const connectionStatus = query({
  args: {},
  handler: async (ctx): Promise<{ connected: boolean; connectedAt: number | null } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (!user) return null;
    return {
      connected: user.openaiAccessCiphertext !== undefined,
      connectedAt: user.openaiConnectedAt ?? null,
    };
  },
});

export const isConnectedSubscriber = (user: Doc<"users">): boolean =>
  user.planId !== undefined &&
  tierOfPlan(user.planId) === CONNECTED_TIER &&
  user.openaiAccessCiphertext !== undefined;

/**
 * The routing decision the choke points consult: does this account's owner
 * ride their own ChatGPT subscription?
 */
export const subscriberState = internalQuery({
  args: { accountId: v.optional(v.id("accounts")), userId: v.optional(v.id("users")) },
  handler: async (
    ctx: QueryCtx,
    args: { accountId?: Id<"accounts">; userId?: Id<"users"> },
  ): Promise<{ active: boolean; userId: Id<"users"> | null }> => {
    let userId = args.userId ?? null;
    if (!userId && args.accountId) {
      const account = await ctx.db.get(args.accountId);
      userId = account?.ownerUserId ?? null;
    }
    if (!userId) return { active: false, userId: null };
    const user = await ctx.db.get(userId);
    if (!user) return { active: false, userId: null };
    return { active: isConnectedSubscriber(user), userId };
  },
});
