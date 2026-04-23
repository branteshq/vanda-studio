'use node';

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const GRAPH_VERSION = "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

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
    error?: MetaError;
};

type MetaAccountsResponse = {
    data?: Array<{
        id: string;
        name?: string;
        access_token?: string;
        tasks?: string[];
        instagram_business_account?: {
            id: string;
            username?: string;
            name?: string;
        };
    }>;
    error?: MetaError;
};

type MetaInstagramProfileResponse = {
    id: string;
    username?: string;
    name?: string;
    error?: MetaError;
};

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing ${name}`);
    }
    return value;
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

        const clientId = requireEnv("META_APP_ID");
        const state = buildStatePayload(identity.subject);
        const scope = [
            "pages_show_list",
            "pages_read_engagement",
            "instagram_basic",
            "instagram_content_publish",
        ].join(",");

        const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", args.redirectUri);
        url.searchParams.set("state", state);
        url.searchParams.set("scope", scope);
        url.searchParams.set("response_type", "code");

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

        const clientId = requireEnv("META_APP_ID");
        const clientSecret = requireEnv("META_APP_SECRET");

        const shortToken = await fetchJson<MetaTokenResponse>(
            `${GRAPH_BASE}/oauth/access_token?` + new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: args.redirectUri,
                code: args.code,
            })
        );
        if (!shortToken.access_token) {
            throw new Error("Meta não retornou token de acesso");
        }

        const longToken = await fetchJson<MetaTokenResponse>(
            `${GRAPH_BASE}/oauth/access_token?` + new URLSearchParams({
                grant_type: "fb_exchange_token",
                client_id: clientId,
                client_secret: clientSecret,
                fb_exchange_token: shortToken.access_token,
            })
        );
        const userAccessToken = longToken.access_token ?? shortToken.access_token;
        const tokenExpiresAt = longToken.expires_in
            ? Date.now() + longToken.expires_in * 1000
            : undefined;

        const accounts = await fetchJson<MetaAccountsResponse>(
            `${GRAPH_BASE}/me/accounts?` + new URLSearchParams({
                fields: "id,name,access_token,tasks,instagram_business_account{id,username,name}",
                access_token: userAccessToken,
            })
        );

        const account = accounts.data?.find((item) => item.instagram_business_account?.id);
        if (!account?.instagram_business_account?.id || !account.access_token) {
            throw new Error("Nenhuma conta profissional do Instagram conectada a uma Página foi encontrada");
        }

        const igAccount = account.instagram_business_account;
        let profile: MetaInstagramProfileResponse | null = null;
        try {
            profile = await fetchJson<MetaInstagramProfileResponse>(
                `${GRAPH_BASE}/${igAccount.id}?` + new URLSearchParams({
                    fields: "id,username,name",
                    access_token: account.access_token,
                })
            );
        } catch {
            profile = null;
        }

        const encrypted = encryptToken(account.access_token);
        const connectionArgs = {
            clerkId: identity.subject,
            platform: "instagram",
            provider: "instagram_graph",
            status: "connected",
            externalAccountId: igAccount.id,
            pageId: account.id,
            scopes: [
                "pages_show_list",
                "pages_read_engagement",
                "instagram_basic",
                "instagram_content_publish",
            ],
            ...encrypted,
            ...((profile?.name ?? igAccount.name)
                ? { externalAccountName: profile?.name ?? igAccount.name }
                : {}),
            ...((profile?.username ?? igAccount.username)
                ? { handle: profile?.username ?? igAccount.username }
                : {}),
            ...(account.name ? { pageName: account.name } : {}),
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
