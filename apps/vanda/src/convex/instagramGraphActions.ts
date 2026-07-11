"use node";

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const GRAPH_VERSION = "v23.0";
const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

type MetaError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  user_id?: number;
  error?: MetaError;
};

type ProfileResponse = {
  id: string;
  username?: string;
  name?: string;
  account_type?: string;
  media_count?: number;
  error?: MetaError;
};

type SubscribeResponse = {
  success?: boolean;
  error?: MetaError;
};

function requireFirstEnv(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing ${names.join(" or ")}`);
}

function encodeState(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeState(value: string): { clerkId: string; createdAt: number } {
  const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
    clerkId?: unknown;
    createdAt?: unknown;
  };
  if (typeof parsed.clerkId !== "string" || typeof parsed.createdAt !== "number") {
    throw new Error("Invalid Instagram state");
  }
  return { clerkId: parsed.clerkId, createdAt: parsed.createdAt };
}

function encryptToken(token: string) {
  const keyMaterial = requireFirstEnv(["INSTAGRAM_TOKEN_ENCRYPTION_KEY"]);
  const key = createHash("sha256").update(keyMaterial).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return {
    tokenCiphertext: encrypted.toString("base64"),
    tokenIv: iv.toString("base64"),
    tokenAuthTag: cipher.getAuthTag().toString("base64"),
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T;
  const error = (data as { error?: MetaError }).error;
  if (!response.ok || error) {
    throw new Error(error?.message ?? `Meta API request failed with ${response.status}`);
  }
  return data;
}

async function subscribeToInstagramWebhooks(
  igUserId: string,
  accessToken: string,
): Promise<string | undefined> {
  try {
    const response = await fetchJson<SubscribeResponse>(
      `${INSTAGRAM_GRAPH_BASE}/${igUserId}/subscribed_apps?` +
        new URLSearchParams({
          subscribed_fields: "comments,mentions",
          access_token: accessToken,
        }),
      { method: "POST" },
    );
    return response.success === true ? undefined : "Instagram webhook subscription failed";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export const getConnectUrl = action({
  args: {
    redirectUri: v.string(),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const clientId = requireFirstEnv(["INSTAGRAM_APP_ID", "META_APP_ID"]);
    const state = encodeState({
      clerkId: identity.subject,
      nonce: randomBytes(18).toString("base64url"),
      createdAt: Date.now(),
    });

    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", args.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set(
      "scope",
      [
        "instagram_business_basic",
        "instagram_business_content_publish",
        "instagram_business_manage_insights",
        "instagram_business_manage_comments",
      ].join(","),
    );
    url.searchParams.set("response_type", "code");
    url.searchParams.set("enable_fb_login", "0");
    url.searchParams.set("force_authentication", "1");

    return { url: url.toString() };
  },
});

export const completeOAuth = action({
  args: {
    code: v.string(),
    state: v.string(),
    redirectUri: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    connected: boolean;
    accountId: Id<"accounts">;
    externalAccountId: string;
    handle?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const state = decodeState(args.state);
    if (state.clerkId !== identity.subject) throw new Error("Invalid Instagram session");
    if (Date.now() - state.createdAt > 15 * 60 * 1000) throw new Error("Instagram session expired");

    const clientId = requireFirstEnv(["INSTAGRAM_APP_ID", "META_APP_ID"]);
    const clientSecret = requireFirstEnv(["INSTAGRAM_APP_SECRET", "META_APP_SECRET"]);

    const shortToken = await fetchJson<TokenResponse>(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          redirect_uri: args.redirectUri,
          code: args.code,
        }),
      },
    );
    if (!shortToken.access_token || !shortToken.user_id) {
      throw new Error("Instagram did not return an access token");
    }

    const longToken = await fetchJson<TokenResponse>(
      "https://graph.instagram.com/access_token?" +
        new URLSearchParams({
          grant_type: "ig_exchange_token",
          client_id: clientId,
          client_secret: clientSecret,
          access_token: shortToken.access_token,
        }),
    );

    const accessToken = longToken.access_token ?? shortToken.access_token;
    const profile = await fetchJson<ProfileResponse>(
      `${INSTAGRAM_GRAPH_BASE}/me?` +
        new URLSearchParams({
          fields: "id,username,name,account_type,media_count",
          access_token: accessToken,
        }),
    );

    const webhookSubscriptionError = await subscribeToInstagramWebhooks(profile.id, accessToken);

    const encrypted = encryptToken(accessToken);
    const connection = await ctx.runMutation(internal.instagramGraph.upsertConnectionInternal, {
      clerkId: identity.subject,
      externalAccountId: profile.id || String(shortToken.user_id),
      ...(profile.name ? { externalAccountName: profile.name } : {}),
      ...(profile.username ? { handle: profile.username } : {}),
      ...(profile.account_type ? { accountType: profile.account_type } : {}),
      ...(profile.media_count !== undefined ? { mediaCount: profile.media_count } : {}),
      scopes: [
        "instagram_business_basic",
        "instagram_business_content_publish",
        "instagram_business_manage_insights",
        "instagram_business_manage_comments",
      ],
      ...encrypted,
      ...(longToken.expires_in ? { tokenExpiresAt: Date.now() + longToken.expires_in * 1000 } : {}),
    });

    await ctx.runMutation(internal.instagramWebhook.recordSubscriptionError, {
      connectionId: connection._id,
      error:
        webhookSubscriptionError === undefined
          ? null
          : `Webhook subscription failed: ${webhookSubscriptionError}`,
    });

    // Bridge the connection into the pipeline: a business `accounts` row the
    // observe cron can pick up. Idempotent, so reconnecting never duplicates.
    const accountId = await ctx.runMutation(internal.observe.promoteConnection, {
      connectionId: connection._id,
    });

    return {
      connected: true,
      accountId,
      externalAccountId: connection.externalAccountId,
      ...(connection.handle ? { handle: connection.handle } : {}),
    };
  },
});
