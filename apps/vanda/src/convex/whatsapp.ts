import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { sha256 } from "./whatsapp/protocol";

export const createLink = action({
  args: {},
  handler: async (ctx): Promise<{ url: string; expiresAt: number }> => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error("Not authenticated");
    const number = process.env.KAPSO_WHATSAPP_NUMBER;
    if (
      !number ||
      !/^\d{7,15}$/.test(number) ||
      !process.env.KAPSO_API_KEY ||
      !process.env.KAPSO_PHONE_NUMBER_ID ||
      !process.env.KAPSO_WEBHOOK_SECRET
    ) {
      throw new Error("A conexão com o WhatsApp ainda não foi configurada.");
    }
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const expiresAt = await ctx.runMutation(internal.whatsappData.storeLink, {
      tokenHash: await sha256(token),
    });
    return {
      url: `https://wa.me/${number}?text=${encodeURIComponent(`vanda conectar ${token}`)}`,
      expiresAt,
    };
  },
});

async function send(phoneNumberId: string, body: object): Promise<Response> {
  const key = process.env.KAPSO_API_KEY;
  if (!key) throw new Error("KAPSO_API_KEY missing");
  return fetch(
    `https://api.kapso.ai/meta/whatsapp/v24.0/${encodeURIComponent(phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      signal: AbortSignal.timeout(25_000),
    },
  );
}

export const markRead = internalAction({
  args: { messageId: v.string() },
  handler: async (_ctx, { messageId }) => {
    const number = process.env.KAPSO_PHONE_NUMBER_ID;
    if (!number) return;
    try {
      await send(number, {
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      });
    } catch {
      /* A read receipt must not prevent a reply. */
    }
  },
});

export const deliver = internalAction({
  args: { connectionId: v.id("whatsappConnections") },
  handler: async (ctx, { connectionId }): Promise<void> => {
    const row = await ctx.runMutation(internal.whatsappData.claimDelivery, { connectionId });
    if (!row) return;
    try {
      const response = await send(row.phoneNumberId, {
        ...(row.recipientKind === "bsuid"
          ? { recipient: row.sender, recipient_type: "individual" }
          : { to: row.sender }),
        type: "text",
        text: { body: row.text, preview_url: false },
        biz_opaque_callback_data: String(row._id),
      });
      if (!response.ok) {
        const details = await response.text();
        if (
          (response.status === 400 || response.status === 422) &&
          (/24.hour window/i.test(details) || /"code"\s*:\s*131047/.test(details))
        ) {
          await ctx.runMutation(internal.whatsappData.finishDelivery, {
            id: row._id,
            status: "awaiting_window",
            error: "Envie uma mensagem ao Caetano no WhatsApp para receber esta resposta.",
          });
          return;
        }
        // Only an explicit rate-limit rejection is automatically retried.
        // Timeouts and 5xx may have accepted a send; do not duplicate it blindly.
        await ctx.runMutation(internal.whatsappData.finishDelivery, {
          id: row._id,
          status:
            response.status === 429 && row.attempts < 4
              ? "pending"
              : response.status >= 500
                ? "unknown"
                : "failed",
          error: `WhatsApp HTTP ${response.status}. Confira a entrega antes de reenviar.`,
        });
        return;
      }
      const data = (await response.json()) as { messages?: Array<{ id?: string }> };
      const externalMessageId = data.messages?.[0]?.id;
      await ctx.runMutation(internal.whatsappData.finishDelivery, {
        id: row._id,
        status: externalMessageId ? "sent" : "unknown",
        ...(externalMessageId
          ? { externalMessageId }
          : { error: "Envio sem identificador de confirmação." }),
      });
    } catch {
      await ctx.runMutation(internal.whatsappData.finishDelivery, {
        id: row._id,
        status: "unknown",
        error: "Envio sem confirmação. Confira o WhatsApp antes de reenviar.",
      });
    }
  },
});
