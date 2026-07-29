"use node";

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
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
  fbtrace_id?: string;
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

export class MetaTransportError extends Data.TaggedError("MetaTransportError")<{
  readonly operation: string;
  readonly message: string;
}> {}

export class MetaResponseError extends Data.TaggedError("MetaResponseError")<{
  readonly operation: string;
  readonly status: number;
  readonly message: string;
  readonly type?: string;
  readonly code?: number;
  readonly subcode?: number;
  readonly traceId?: string;
}> {}

type MetaRequestError = MetaTransportError | MetaResponseError;

export interface TokenUpgradeResult {
  readonly accessToken: string;
  readonly expiresIn?: number;
  readonly warning?: string;
}

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
  const parsed = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  ) as {
    clerkId?: unknown;
    createdAt?: unknown;
  };
  if (
    typeof parsed.clerkId !== "string" ||
    typeof parsed.createdAt !== "number"
  ) {
    throw new Error("Invalid Instagram state");
  }
  return { clerkId: parsed.clerkId, createdAt: parsed.createdAt };
}

function encryptToken(token: string) {
  const keyMaterial = requireFirstEnv(["INSTAGRAM_TOKEN_ENCRYPTION_KEY"]);
  const key = createHash("sha256").update(keyMaterial).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return {
    tokenCiphertext: encrypted.toString("base64"),
    tokenIv: iv.toString("base64"),
    tokenAuthTag: cipher.getAuthTag().toString("base64"),
  };
}

const fetchJson = <T>(
  operation: string,
  url: string,
  init?: RequestInit,
): Effect.Effect<T, MetaRequestError> =>
  Effect.tryPromise({
    try: () => fetch(url, init),
    catch: (error) =>
      new MetaTransportError({
        operation,
        message: error instanceof Error ? error.message : String(error),
      }),
  }).pipe(
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json() as Promise<T>,
        catch: (error) =>
          new MetaTransportError({
            operation,
            message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
          }),
      }).pipe(Effect.map((data) => ({ data, response }))),
    ),
    Effect.flatMap(({ data, response }) => {
      const error = (data as { error?: MetaError }).error;
      if (response.ok && error === undefined) return Effect.succeed(data);
      return Effect.fail(
        new MetaResponseError({
          operation,
          status: response.status,
          message:
            error?.message ?? `Meta API request failed with ${response.status}`,
          ...(error?.type ? { type: error.type } : {}),
          ...(error?.code !== undefined ? { code: error.code } : {}),
          ...(error?.error_subcode !== undefined
            ? { subcode: error.error_subcode }
            : {}),
          ...(error?.fbtrace_id ? { traceId: error.fbtrace_id } : {}),
        }),
      );
    }),
  );

const formatMetaError = (error: MetaRequestError) =>
  JSON.stringify({
    tag: error._tag,
    operation: error.operation,
    message: error.message,
    ...(error._tag === "MetaResponseError"
      ? {
          status: error.status,
          code: error.code,
          subcode: error.subcode,
          type: error.type,
          traceId: error.traceId,
        }
      : {}),
  });

export const exchangeLongLivedToken = (
  shortAccessToken: string,
  clientId: string,
  clientSecret: string,
) =>
  fetchJson<TokenResponse>(
    "exchange_long_lived_token",
    "https://graph.instagram.com/access_token?" +
      new URLSearchParams({
        grant_type: "ig_exchange_token",
        client_id: clientId,
        client_secret: clientSecret,
        access_token: shortAccessToken,
      }),
  ).pipe(
    Effect.retry({ times: 2, schedule: Schedule.spaced("500 millis") }),
    Effect.match({
      onFailure: (error): TokenUpgradeResult => ({
        accessToken: shortAccessToken,
        warning: `Long-lived token exchange failed: ${formatMetaError(error)}`,
      }),
      onSuccess: (token): TokenUpgradeResult => ({
        accessToken: token.access_token ?? shortAccessToken,
        ...(token.expires_in !== undefined
          ? { expiresIn: token.expires_in }
          : {}),
      }),
    }),
  );

function subscribeToInstagramWebhooks(
  igUserId: string,
  accessToken: string,
): Effect.Effect<string | undefined, never> {
  return fetchJson<SubscribeResponse>(
    "subscribe_webhooks",
    `${INSTAGRAM_GRAPH_BASE}/${igUserId}/subscribed_apps?` +
      new URLSearchParams({
        subscribed_fields: "comments,mentions",
        access_token: accessToken,
      }),
    { method: "POST" },
  ).pipe(
    Effect.map((response) =>
      response.success === true
        ? undefined
        : "Instagram webhook subscription failed",
    ),
    Effect.match({
      onFailure: formatMetaError,
      onSuccess: (error) => error,
    }),
  );
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
  ): Promise<
    | {
        connected: true;
        accountId: Id<"accounts">;
        externalAccountId: string;
        handle?: string;
      }
    | { connected: false; message: string }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const state = decodeState(args.state);
    if (state.clerkId !== identity.subject)
      throw new Error("Invalid Instagram session");
    if (Date.now() - state.createdAt > 15 * 60 * 1000)
      throw new Error("Instagram session expired");

    const clientId = requireFirstEnv(["INSTAGRAM_APP_ID", "META_APP_ID"]);
    const clientSecret = requireFirstEnv([
      "INSTAGRAM_APP_SECRET",
      "META_APP_SECRET",
    ]);

    const shortTokenResult = await Effect.runPromise(
      fetchJson<TokenResponse>(
        "exchange_authorization_code",
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
      ).pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (value) => ({ ok: true as const, value }),
        }),
      ),
    );
    if (!shortTokenResult.ok) {
      console.error(formatMetaError(shortTokenResult.error));
      return {
        connected: false,
        message:
          "O Instagram recusou a autorização. Tente conectar a conta novamente.",
      };
    }
    const shortToken = shortTokenResult.value;
    if (!shortToken.access_token || !shortToken.user_id) {
      console.error(
        "Instagram authorization response did not include an access token and user id",
      );
      return {
        connected: false,
        message:
          "O Instagram não concluiu a autorização. Tente conectar a conta novamente.",
      };
    }

    const token = await Effect.runPromise(
      exchangeLongLivedToken(shortToken.access_token, clientId, clientSecret),
    );
    if (token.warning) console.warn(token.warning);

    const accessToken = token.accessToken;
    const profileResult = await Effect.runPromise(
      fetchJson<ProfileResponse>(
        "fetch_profile",
        `${INSTAGRAM_GRAPH_BASE}/me?` +
          new URLSearchParams({
            fields: "id,username,name,account_type,media_count",
            access_token: accessToken,
          }),
      ).pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (value) => ({ ok: true as const, value }),
        }),
      ),
    );
    if (!profileResult.ok) {
      console.error(formatMetaError(profileResult.error));
      return {
        connected: false,
        message:
          "Não conseguimos acessar essa conta. Confirme que ela é profissional e tente novamente.",
      };
    }
    const profile = profileResult.value;

    const webhookSubscriptionError = await Effect.runPromise(
      subscribeToInstagramWebhooks(profile.id, accessToken),
    );

    const encrypted = encryptToken(accessToken);
    const connection = await ctx.runMutation(
      internal.instagramGraph.upsertConnectionInternal,
      {
        clerkId: identity.subject,
        externalAccountId: profile.id || String(shortToken.user_id),
        ...(profile.name ? { externalAccountName: profile.name } : {}),
        ...(profile.username ? { handle: profile.username } : {}),
        ...(profile.account_type ? { accountType: profile.account_type } : {}),
        ...(profile.media_count !== undefined
          ? { mediaCount: profile.media_count }
          : {}),
        scopes: [
          "instagram_business_basic",
          "instagram_business_content_publish",
          "instagram_business_manage_insights",
          "instagram_business_manage_comments",
        ],
        ...encrypted,
        ...(token.expiresIn
          ? { tokenExpiresAt: Date.now() + token.expiresIn * 1000 }
          : {}),
      },
    );

    await ctx.runMutation(internal.instagramWebhook.recordSubscriptionError, {
      connectionId: connection._id,
      error:
        [
          token.warning,
          webhookSubscriptionError &&
            `Webhook subscription failed: ${webhookSubscriptionError}`,
        ]
          .filter((value): value is string => value !== undefined)
          .join("\n") || null,
    });

    // Bridge the connection into the product: a business `accounts` row.
    // Idempotent, so reconnecting never duplicates.
    const accountId = await ctx.runMutation(
      internal.connections.promoteConnection,
      {
        connectionId: connection._id,
      },
    );

    return {
      connected: true,
      accountId,
      externalAccountId: connection.externalAccountId,
      ...(connection.handle ? { handle: connection.handle } : {}),
    };
  },
});
