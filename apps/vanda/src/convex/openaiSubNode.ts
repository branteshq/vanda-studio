"use node";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/**
 * Node-side of the OpenAI connection: AES-256-GCM token encryption (the same
 * scheme as the Instagram tokens, its own key) and the access-token resolver
 * that transparently refreshes expiring tokens.
 */

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
/** Refresh when the access token has less than this much life left. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const RECONNECT_MESSAGE =
  "Sua conexão com a OpenAI expirou — reconecte em Perfil → Conta para continuar.";

function encryptionKey(): Buffer {
  const material = process.env.OPENAI_TOKEN_ENCRYPTION_KEY;
  if (!material) throw new Error("OPENAI_TOKEN_ENCRYPTION_KEY is not set");
  return createHash("sha256").update(material).digest();
}

function encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(ciphertext: string, iv: string, authTag: string): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export const encryptAndStore = internalAction({
  args: {
    clerkId: v.string(),
    access: v.string(),
    refresh: v.string(),
    expiresAt: v.number(),
    accountId: v.string(),
  },
  handler: async (ctx, { clerkId, access, refresh, expiresAt, accountId }) => {
    const encryptedAccess = encrypt(access);
    const encryptedRefresh = encrypt(refresh);
    await ctx.runMutation(internal.openaiSub.saveTokens, {
      clerkId,
      accountId,
      accessCiphertext: encryptedAccess.ciphertext,
      accessIv: encryptedAccess.iv,
      accessAuthTag: encryptedAccess.authTag,
      refreshCiphertext: encryptedRefresh.ciphertext,
      refreshIv: encryptedRefresh.iv,
      refreshAuthTag: encryptedRefresh.authTag,
      expiresAt,
    });
  },
});

/**
 * Resolve a usable access token for the user's ChatGPT connection,
 * refreshing (and re-encrypting) when it is close to expiry.
 */
export const getAccess = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ access: string; accountId: string }> => {
    const user = await ctx.runQuery(internal.openaiSub.tokensOf, { userId });
    if (
      !user?.openaiAccessCiphertext ||
      !user.openaiAccessIv ||
      !user.openaiAccessAuthTag ||
      !user.openaiRefreshCiphertext ||
      !user.openaiRefreshIv ||
      !user.openaiRefreshAuthTag ||
      !user.openaiAccountId
    ) {
      throw new Error(RECONNECT_MESSAGE);
    }

    const expiresAt = user.openaiTokenExpiresAt ?? 0;
    if (expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return {
        access: decrypt(user.openaiAccessCiphertext, user.openaiAccessIv, user.openaiAccessAuthTag),
        accountId: user.openaiAccountId,
      };
    }

    const refreshToken = decrypt(
      user.openaiRefreshCiphertext,
      user.openaiRefreshIv,
      user.openaiRefreshAuthTag,
    );
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    });
    if (!response.ok) throw new Error(RECONNECT_MESSAGE);
    const tokens = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!tokens.access_token || !tokens.refresh_token || typeof tokens.expires_in !== "number") {
      throw new Error(RECONNECT_MESSAGE);
    }

    const encryptedAccess = encrypt(tokens.access_token);
    const encryptedRefresh = encrypt(tokens.refresh_token);
    await ctx.runMutation(internal.openaiSub.saveRefreshedTokens, {
      userId,
      accessCiphertext: encryptedAccess.ciphertext,
      accessIv: encryptedAccess.iv,
      accessAuthTag: encryptedAccess.authTag,
      refreshCiphertext: encryptedRefresh.ciphertext,
      refreshIv: encryptedRefresh.iv,
      refreshAuthTag: encryptedRefresh.authTag,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    return { access: tokens.access_token, accountId: user.openaiAccountId };
  },
});
