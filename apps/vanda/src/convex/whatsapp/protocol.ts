import { z } from "zod";

const messageSchema = z.object({
  phone_number_id: z.string(),
  message: z
    .object({
      id: z.string(),
      timestamp: z.string().optional(),
      type: z.string().optional(),
      from: z.string().optional(),
      from_user_id: z.string().optional(),
      text: z.object({ body: z.string() }).optional(),
      biz_opaque_callback_data: z.string().optional(),
      kapso: z
        .object({
          direction: z.string().optional(),
          origin: z.string().optional(),
          statuses: z
            .array(z.object({ biz_opaque_callback_data: z.string().optional() }).passthrough())
            .optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
  conversation: z
    .object({ phone_number: z.string().optional(), business_scoped_user_id: z.string().optional() })
    .passthrough()
    .optional(),
});

export const webhookSchema = z.union([
  z.object({ batch: z.literal(true), data: z.array(messageSchema).max(100) }),
  messageSchema,
]);

type WebhookPayload = z.infer<typeof webhookSchema>;

export type WhatsAppEvent = {
  event: string;
  phoneNumberId: string;
  messageId: string;
  sender: string;
  recipientKind: "phone" | "bsuid";
  phone?: string;
  text: string;
  timestamp: number;
  callbackId?: string;
};

export function parseWebhook(
  body: WebhookPayload,
  event: string,
  configuredNumber: string,
): WhatsAppEvent[] {
  const items = "batch" in body ? body.data : [body];

  return items.flatMap((parsed) => {
    if (parsed.phone_number_id !== configuredNumber) throw new Error("wrong phone number");
    const message = parsed.message;

    if (message.kapso?.origin === "history_sync") return [];

    if (event === "whatsapp.message.received" && message.kapso?.direction !== "inbound") return [];
    const bsuid = message.from_user_id ?? parsed.conversation?.business_scoped_user_id;
    const phone = message.from ?? parsed.conversation?.phone_number;
    const sender = bsuid ?? phone ?? "";

    if (event === "whatsapp.message.received" && !sender) throw new Error("missing sender");
    const timestamp = Number(message.timestamp) * 1000;

    if (event === "whatsapp.message.received" && (!Number.isFinite(timestamp) || timestamp <= 0))
      throw new Error("missing timestamp");

    const callbackId =
      message.biz_opaque_callback_data ??
      message.kapso?.statuses?.find((s) => s.biz_opaque_callback_data)?.biz_opaque_callback_data;

    const result: WhatsAppEvent = {
      event,
      phoneNumberId: parsed.phone_number_id,
      messageId: message.id,
      sender,
      recipientKind: bsuid ? "bsuid" : "phone",
      text: message.type === "text" ? (message.text?.body ?? "").slice(0, 16000) : "",
      timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    };

    if (phone && /^\+?\d{7,15}$/.test(phone)) result.phone = phone.replace(/^\+/, "");

    if (callbackId) result.callbackId = callbackId;

    return [result];
  });
}

export async function sha256(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function verifySignature(
  raw: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const bytes = Uint8Array.from(signature.match(/../g)!, (hex) => Number.parseInt(hex, 16));

  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(raw));
}

/** WhatsApp text is bounded; do not emit streaming fragments or broken UTF-16. */
export function replyParts(text: string): string[] {
  const plain = text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1: $2")
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    .trim();

  const chars = Array.from(plain);
  const parts: string[] = [];

  while (chars.length) parts.push(chars.splice(0, 3000).join(""));

  return parts;
}

export const isStop = (text: string): boolean =>
  /^(parar|pare|stop|cancelar)[.!]?$/i.test(text.trim());

export const linkToken = (text: string): string | null =>
  /^vanda conectar ([0-9a-f]{64})$/i.exec(text.trim())?.[1]?.toLowerCase() ?? null;

export const serviceWindowOpen = (lastInboundAt: number, now = Date.now()): boolean =>
  now < lastInboundAt + 24 * 60 * 60_000;
