import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const WEBHOOK_PATH = "/integrations/instagram/webhook";

const text = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const bytesToHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const safeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
};

const expectedSignature = async (body: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requireEnv("INSTAGRAM_APP_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${bytesToHex(signature)}`;
};

const verifySignature = async (request: Request, body: string): Promise<boolean> => {
  const received = request.headers.get("x-hub-signature-256");
  if (received === null) return false;
  return safeEqual(received, await expectedSignature(body));
};

const http = httpRouter();

http.route({
  path: WEBHOOK_PATH,
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || challenge === null) return text("bad verification request", 400);
    if (token !== requireEnv("INSTAGRAM_WEBHOOK_VERIFY_TOKEN")) return text("forbidden", 403);
    return text(challenge);
  }),
});

http.route({
  path: WEBHOOK_PATH,
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const body = await request.text();
    if (!(await verifySignature(request, body))) return text("bad signature", 403);

    try {
      JSON.parse(body);
    } catch {
      return text("bad json", 400);
    }

    // Acknowledge only. Comment/mention ingestion returns when the agent has a
    // consumer for it; Meta just needs a 200 to keep the subscription healthy.
    return json({ received: true });
  }),
});

export default http;
