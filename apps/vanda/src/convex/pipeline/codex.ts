import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * Adapters for the ChatGPT subscription backend (the Conectado plan): the
 * same Responses dialect and image endpoints the Codex CLI uses, authorized
 * by the user's OAuth token instead of an API key. Verified live against
 * gpt-5.6-terra, gpt-5.6-luna and gpt-image-2.
 *
 * The token only ever travels to chatgpt.com — enforced here, like pi does.
 */

const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

export const CODEX_QUOTA_MESSAGE =
  "O limite do seu plano ChatGPT foi atingido — aguarde a janela renovar ou tente mais tarde.";

export interface CodexAuth {
  access: string;
  accountId: string;
}

const codexHeaders = (auth: CodexAuth): Record<string, string> => ({
  "chatgpt-account-id": auth.accountId,
  originator: "vanda",
});

const assertChatGptUrl = (url: string): void => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com") {
    throw new Error(`Refusing to send ChatGPT credentials to ${parsed.origin}`);
  }
};

/**
 * The agent's language model on the subscription route. The fetch wrapper
 * pins the body fields the codex backend requires (`store: false`) on top of
 * whatever the AI SDK provider emits.
 */
export const codexChatModel = (auth: CodexAuth, modelId: string): LanguageModel => {
  const provider = createOpenAI({
    baseURL: CODEX_BASE_URL,
    apiKey: auth.access,
    headers: { ...codexHeaders(auth), "OpenAI-Beta": "responses=experimental" },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      assertChatGptUrl(url);
      let body = init?.body;
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>;
          parsed.store = false;
          body = JSON.stringify(parsed);
        } catch {
          // non-JSON body passes through untouched
        }
      }
      const response = await fetch(url, { ...init, body: body ?? null });
      if (response.status === 429) throw new Error(CODEX_QUOTA_MESSAGE);
      return response;
    }) as typeof fetch,
  });
  return provider.responses(modelId);
};

/**
 * One-shot text completion over the codex SSE stream (the backend only
 * streams) — used by the titling model on the subscription route.
 */
export const codexResponsesText = async (args: {
  auth: CodexAuth;
  model: string;
  system: string;
  prompt: string;
}): Promise<string> => {
  const url = `${CODEX_BASE_URL}/responses`;
  assertChatGptUrl(url);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...codexHeaders(args.auth),
      Authorization: `Bearer ${args.auth.access}`,
      "OpenAI-Beta": "responses=experimental",
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: args.model,
      store: false,
      stream: true,
      instructions: args.system,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: args.prompt }],
        },
      ],
      text: { verbosity: "low" },
      include: [],
      tool_choice: "auto",
      parallel_tool_calls: true,
    }),
  });
  if (response.status === 429) throw new Error(CODEX_QUOTA_MESSAGE);
  if (!response.ok || !response.body) {
    throw new Error(`codex responses HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const event = JSON.parse(line.slice(6)) as {
          type?: string;
          delta?: string;
        };
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        }
      } catch {
        // partial/keepalive frames
      }
    }
  }
  return text.trim();
};

/** aspectRatio → gpt-image-2 size (multiples of 16, within pixel bounds). */
export const CODEX_IMAGE_SIZES: Record<string, string> = {
  "1:1": "1024x1024",
  "4:5": "1024x1280",
  "9:16": "864x1536",
  "16:9": "1536x864",
};

const dataUrlOf = async (url: string, signal?: AbortSignal): Promise<string> => {
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) throw new Error(`reference fetch HTTP ${response.status}`);
  const mimeType = response.headers.get("content-type")?.split(";")[0] ?? "image/png";
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

/**
 * Generate (or edit, when references are present) through the subscription
 * image endpoint — always gpt-image-2, billed to the user's ChatGPT plan.
 */
export const codexGenerateImage = async (args: {
  auth: CodexAuth;
  prompt: string;
  aspectRatio: string;
  referenceUrls?: readonly string[] | undefined;
  signal?: AbortSignal | undefined;
}): Promise<{ bytes: Uint8Array; mimeType: string; costUsd: number }> => {
  const references = args.referenceUrls ?? [];
  const images = await Promise.all(
    references.slice(0, 5).map(async (url) => ({ image_url: await dataUrlOf(url, args.signal) })),
  );
  const path = images.length > 0 ? "images/edits" : "images/generations";
  const url = `${CODEX_BASE_URL}/${path}`;
  assertChatGptUrl(url);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...codexHeaders(args.auth),
      Authorization: `Bearer ${args.auth.access}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      prompt: args.prompt,
      background: "auto",
      model: "gpt-image-2",
      quality: "high",
      size: CODEX_IMAGE_SIZES[args.aspectRatio] ?? "1024x1024",
      ...(images.length > 0 ? { images } : {}),
    }),
    ...(args.signal ? { signal: args.signal } : {}),
  });
  if (response.status === 429) throw new Error(CODEX_QUOTA_MESSAGE);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`codex image HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  const json = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("codex image response sem dados");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  // Billed to the user's subscription — zero cost on the Vanda meter.
  return { bytes, mimeType: "image/png", costUsd: 0 };
};
