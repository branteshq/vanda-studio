import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import {
  linkToken,
  parseWebhook,
  sha256,
  verifySignature,
  webhookSchema,
} from "./whatsapp/protocol";

const http = httpRouter();

const events = new Set([
  "whatsapp.message.received",
  "whatsapp.message.sent",
  "whatsapp.message.delivered",
  "whatsapp.message.read",
  "whatsapp.message.failed",
]);

http.route({
  path: "/webhooks/kapso",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.KAPSO_WEBHOOK_SECRET;
    const number = process.env.KAPSO_PHONE_NUMBER_ID;

    if (!secret || !number) return new Response("not configured", { status: 503 });
    const reader = request.body?.getReader();

    if (!reader) return new Response("empty body", { status: 400 });
    const chunks: Uint8Array[] = [];
    let length = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;
      length += value.length;

      if (length > 256_000) {
        await reader.cancel();

        return new Response("payload too large", { status: 413 });
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(length);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }

    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);

    if (!(await verifySignature(raw, request.headers.get("X-Webhook-Signature"), secret))) {
      return new Response("invalid signature", { status: 401 });
    }

    const event = request.headers.get("X-Webhook-Event") ?? "";

    if (!events.has(event)) return new Response("ok");
    let parsed;

    try {
      parsed = parseWebhook(webhookSchema.parse(JSON.parse(raw)), event, number);
    } catch {
      return new Response("invalid payload", { status: 400 });
    }

    const normalized = await Promise.all(
      parsed.map(async (item) => {
        const token = linkToken(item.text);

        return token ? Object.assign(item, { text: "", tokenHash: await sha256(token) }) : item;
      }),
    );

    // Hash the signed payload, not just the unsigned delivery header. Per-message
    // dedupe also covers a failed batch redelivered as individual messages.
    await ctx.runMutation(internal.whatsappData.accept, {
      deliveryKey: await sha256(`${event}:${raw}`),
      events: normalized,
    });

    return new Response("ok");
  }),
});

export default http;
