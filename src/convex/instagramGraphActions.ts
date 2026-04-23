'use node';

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const GRAPH_VERSION = "v23.0";
const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

type MetaError = {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
};

type MetaTokenResponse = {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    user_id?: number;
    error?: MetaError;
};

type MetaInstagramProfileResponse = {
    id: string;
    username?: string;
    name?: string;
    account_type?: string;
    media_count?: number;
    error?: MetaError;
};

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing ${name}`);
    }
    return value;
}

function requireFirstEnv(names: string[]): string {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) {
            return value;
        }
    }
    throw new Error(`Missing ${names.join(" or ")}`);
}

function encodeBase64Url(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
    return Buffer.from(value, "base64url").toString("utf8");
}

function buildStatePayload(clerkId: string): string {
    const nonce = randomBytes(18).toString("base64url");
    return encodeBase64Url(JSON.stringify({
        clerkId,
        nonce,
        createdAt: Date.now(),
    }));
}

function parseStatePayload(state: string): { clerkId: string; createdAt: number } {
    try {
        const parsed = JSON.parse(decodeBase64Url(state)) as {
            clerkId?: unknown;
            createdAt?: unknown;
        };
        if (typeof parsed.clerkId !== "string" || typeof parsed.createdAt !== "number") {
            throw new Error("Invalid Instagram state");
        }
        return { clerkId: parsed.clerkId, createdAt: parsed.createdAt };
    } catch {
        throw new Error("Invalid Instagram state");
    }
}

function encryptToken(token: string): {
    tokenCiphertext: string;
    tokenIv: string;
    tokenAuthTag: string;
} {
    const keyMaterial = requireEnv("INSTAGRAM_TOKEN_ENCRYPTION_KEY");
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
    const data = await response.json() as T;

    if (!response.ok || (data as { error?: MetaError }).error) {
        const error = (data as { error?: MetaError }).error;
        throw new Error(error?.message ?? `Meta API request failed with ${response.status}`);
    }

    return data;
}

export const getConnectUrl = action({
    args: {
        redirectUri: v.string(),
    },
    handler: async (ctx, args): Promise<{ url: string }> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Não autenticado");
        }

        const clientId = requireFirstEnv(["INSTAGRAM_APP_ID", "META_APP_ID"]);
        const state = buildStatePayload(identity.subject);
        const scope = [
            "instagram_business_basic",
            "instagram_business_content_publish",
        ].join(",");

        const url = new URL("https://www.instagram.com/oauth/authorize");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", args.redirectUri);
        url.searchParams.set("state", state);
        url.searchParams.set("scope", scope);
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
    handler: async (ctx, args): Promise<{
        connected: boolean;
        handle?: string;
        pageName?: string;
        externalAccountId: string;
    }> => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Não autenticado");
        }

        const parsedState = parseStatePayload(args.state);
        if (parsedState.clerkId !== identity.subject) {
            throw new Error("Sessão de conexão do Instagram inválida");
        }
        if (Date.now() - parsedState.createdAt > 15 * 60 * 1000) {
            throw new Error("Sessão de conexão do Instagram expirada");
        }

        const clientId = requireFirstEnv(["INSTAGRAM_APP_ID", "META_APP_ID"]);
        const clientSecret = requireFirstEnv(["INSTAGRAM_APP_SECRET", "META_APP_SECRET"]);

        const shortToken = await fetchJson<MetaTokenResponse>(
            "https://api.instagram.com/oauth/access_token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: "authorization_code",
                    redirect_uri: args.redirectUri,
                    code: args.code,
                }),
            }
        );
        if (!shortToken.access_token || !shortToken.user_id) {
            throw new Error("Instagram não retornou token de acesso");
        }

        const longToken = await fetchJson<MetaTokenResponse>(
            "https://graph.instagram.com/access_token?" + new URLSearchParams({
                grant_type: "ig_exchange_token",
                client_id: clientId,
                client_secret: clientSecret,
                access_token: shortToken.access_token,
            })
        );
        const userAccessToken = longToken.access_token ?? shortToken.access_token;
        const tokenExpiresAt = longToken.expires_in
            ? Date.now() + longToken.expires_in * 1000
            : undefined;

        const profile = await fetchJson<MetaInstagramProfileResponse>(
            `${INSTAGRAM_GRAPH_BASE}/me?` + new URLSearchParams({
                fields: "id,username,name,account_type,media_count",
                access_token: userAccessToken,
            })
        );

        const externalAccountId = profile.id || String(shortToken.user_id);
        const encrypted = encryptToken(userAccessToken);
        const connectionArgs = {
            clerkId: identity.subject,
            platform: "instagram",
            provider: "instagram_graph",
            status: "connected",
            externalAccountId,
            scopes: [
                "instagram_business_basic",
                "instagram_business_content_publish",
            ],
            ...encrypted,
            ...(profile.name
                ? { externalAccountName: profile.name }
                : {}),
            ...(profile.username
                ? { handle: profile.username }
                : {}),
            ...(tokenExpiresAt ? { tokenExpiresAt } : {}),
        };
        const user = await ctx.runMutation(internal.instagramGraph.upsertConnectionInternal, connectionArgs);

        return {
            connected: true,
            externalAccountId: user.externalAccountId,
            ...(user.handle ? { handle: user.handle } : {}),
            ...(user.pageName ? { pageName: user.pageName } : {}),
        };
    },
});
