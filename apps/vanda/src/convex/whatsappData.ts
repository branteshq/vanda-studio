import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireUser } from "./authz";
import { isStop, replyParts, serviceWindowOpen } from "./whatsapp/protocol";

export const storeLink = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const user = await requireUser(ctx);

    const links = await ctx.db
      .query("whatsappLinks")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    for (const link of links) await ctx.db.delete(link._id);
    const expiresAt = Date.now() + 10 * 60_000;
    await ctx.db.insert("whatsappLinks", { userId: user._id, tokenHash, expiresAt });

    return expiresAt;
  },
});

export const state = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const connections = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const connection = connections.find((c) => c.active);

    const recent = connection
      ? await ctx.db
          .query("whatsappOutbox")
          .withIndex("by_connection", (q) => q.eq("connectionId", connection._id))
          .order("desc")
          .take(10)
      : [];

    return {
      configured: !!(
        process.env.KAPSO_API_KEY &&
        process.env.KAPSO_PHONE_NUMBER_ID &&
        process.env.KAPSO_WEBHOOK_SECRET &&
        process.env.KAPSO_WHATSAPP_NUMBER
      ),
      connected: !!connection,
      sender:
        connection?.phone ?? (connection?.recipientKind === "phone" ? connection.sender : null),
      deliveries: recent.map((row) => ({
        id: row._id,
        status: row.status,
        error: row.error ?? null,
      })),
    };
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const connections = await ctx.db
      .query("whatsappConnections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    for (const connection of connections) await ctx.db.patch(connection._id, { active: false });

    const links = await ctx.db
      .query("whatsappLinks")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    for (const link of links) await ctx.db.delete(link._id);
  },
});

async function enqueue(
  ctx: MutationCtx,
  connectionId: Id<"whatsappConnections">,
  text: string,
  sourceMessageId?: string,
) {
  const connection = await ctx.db.get(connectionId);

  if (!connection?.active) return;

  for (const part of replyParts(text)) {
    const outbox: Omit<Doc<"whatsappOutbox">, "_id" | "_creationTime"> = {
      connectionId,
      text: part,
      attempts: 0,
      status: "pending",
    };

    if (sourceMessageId) outbox.sourceMessageId = sourceMessageId;
    await ctx.db.insert("whatsappOutbox", outbox);
  }

  await ctx.scheduler.runAfter(0, internal.whatsapp.deliver, { connectionId });
}

export const enqueueReply = internalMutation({
  args: {
    connectionId: v.id("whatsappConnections"),
    text: v.string(),
    sourceMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => enqueue(ctx, args.connectionId, args.text, args.sourceMessageId),
});

type DeliveryEventStatus = "sent" | "delivered" | "read" | "failed";

const deliveryStatus = (value: string | undefined): DeliveryEventStatus | null => {
  switch (value) {
    case "sent":
    case "delivered":
    case "read":
    case "failed":
      return value;
    default:
      return null;
  }
};

const deliveryRank = (status: string): number => {
  switch (status) {
    case "sent":
      return 1;
    case "delivered":
      return 2;
    case "read":
      return 3;
    default:
      return 0;
  }
};

const eventValidator = v.object({
  event: v.string(),
  phoneNumberId: v.string(),
  messageId: v.string(),
  sender: v.string(),
  recipientKind: v.union(v.literal("phone"), v.literal("bsuid")),
  phone: v.optional(v.string()),
  text: v.string(),
  timestamp: v.number(),
  callbackId: v.optional(v.string()),
  tokenHash: v.optional(v.string()),
});

/** Persist a scheduled mutation before acknowledging, without doing agent work in HTTP. */
export const accept = internalMutation({
  args: { deliveryKey: v.string(), events: v.array(eventValidator) },
  handler: async (ctx, args) => {
    const key = `accepted:${args.deliveryKey}`;

    if (
      await ctx.db
        .query("whatsappReceipts")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique()
    )
      return;
    await ctx.db.insert("whatsappReceipts", { key, receivedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.whatsappData.ingest, args);
  },
});

export const ingest = internalMutation({
  args: { deliveryKey: v.string(), events: v.array(eventValidator) },
  handler: async (ctx, { deliveryKey, events }) => {
    const seen = async (key: string) => {
      if (
        await ctx.db
          .query("whatsappReceipts")
          .withIndex("by_key", (q) => q.eq("key", key))
          .unique()
      )
        return true;
      await ctx.db.insert("whatsappReceipts", { key, receivedAt: Date.now() });

      return false;
    };

    if (await seen(`delivery:${deliveryKey}`)) return;

    for (let index = 0; index < events.length; index++) {
      const event = { ...events[index]! };

      if (event.phoneNumberId !== process.env.KAPSO_PHONE_NUMBER_ID)
        throw new Error("wrong number");

      if (await seen(`${event.phoneNumberId}:${event.event}:${event.messageId}`)) continue;

      if (event.event !== "whatsapp.message.received") {
        const callback = event.callbackId
          ? ctx.db.normalizeId("whatsappOutbox", event.callbackId)
          : null;

        const row = callback
          ? await ctx.db.get(callback)
          : await ctx.db
              .query("whatsappOutbox")
              .withIndex("by_external", (q) => q.eq("externalMessageId", event.messageId))
              .first();

        if (!row) continue;
        const connection = await ctx.db.get(row.connectionId);

        if (connection?.phoneNumberId !== event.phoneNumberId) continue;
        const status = deliveryStatus(event.event.split(".").at(-1));

        if (status && deliveryRank(status) > deliveryRank(row.status)) {
          await ctx.db.patch(row._id, {
            status,
            externalMessageId: event.messageId,
          });
        } else if (status === "failed" && row.status !== "delivered" && row.status !== "read") {
          await ctx.db.patch(row._id, {
            status: "failed",
            error: "WhatsApp não entregou a mensagem.",
          });
        }

        await ctx.scheduler.runAfter(0, internal.whatsapp.deliver, {
          connectionId: row.connectionId,
        });
        continue;
      }

      // Kapso's per-conversation buffer becomes one turn, while each external
      // message keeps its own dedupe receipt. Never merge across a stop/link.
      if (event.text && !event.tokenHash && !isStop(event.text)) {
        while (index + 1 < events.length) {
          const next = events[index + 1]!;

          if (
            next.event !== event.event ||
            next.phoneNumberId !== event.phoneNumberId ||
            next.sender !== event.sender ||
            !next.text ||
            next.tokenHash ||
            isStop(next.text) ||
            event.text.length + next.text.length > 16000
          )
            break;
          index++;

          if (await seen(`${next.phoneNumberId}:${next.event}:${next.messageId}`)) continue;
          event.text += `\n${next.text}`;
          event.timestamp = Math.max(event.timestamp, next.timestamp);
        }
      }

      let connection = await ctx.db
        .query("whatsappConnections")
        .withIndex("by_sender", (q) =>
          q.eq("phoneNumberId", event.phoneNumberId).eq("sender", event.sender),
        )
        .unique();

      if (event.tokenHash) {
        const link = await ctx.db
          .query("whatsappLinks")
          .withIndex("by_hash", (q) => q.eq("tokenHash", event.tokenHash!))
          .unique();

        if (!link || link.expiresAt < Date.now()) continue;

        if (connection?.active && connection.userId !== link.userId) continue;

        const previous = await ctx.db
          .query("whatsappConnections")
          .withIndex("by_user", (q) => q.eq("userId", link.userId))
          .collect();

        for (const row of previous) await ctx.db.patch(row._id, { active: false });

        // Never reassign an existing row: queued replies from its old owner must stay isolated.
        if (connection && connection.userId !== link.userId) {
          await ctx.db.patch(connection._id, {
            sender: `retired:${connection._id}`,
            active: false,
          });
          connection = null;
        }

        const data: Omit<Doc<"whatsappConnections">, "_id" | "_creationTime"> = {
          userId: link.userId,
          phoneNumberId: event.phoneNumberId,
          sender: event.sender,
          recipientKind: event.recipientKind,
          lastInboundAt: Math.min(event.timestamp, Date.now()),
          connectedAt: Date.now(),
          active: true,
        };

        if (event.phone) data.phone = event.phone;

        const id = connection?._id ?? (await ctx.db.insert("whatsappConnections", data));

        if (connection) await ctx.db.patch(id, data);
        await ctx.db.delete(link._id);
        await enqueue(
          ctx,
          id,
          "WhatsApp conectado ao Vanda Studio. Pode falar comigo por aqui. Para desconectar, abra Perfil no aplicativo.",
        );
        continue;
      }

      if (!connection?.active) continue;

      const connectionPatch: Pick<
        Partial<Doc<"whatsappConnections">>,
        "lastInboundAt" | "phone"
      > = {
        lastInboundAt: Math.max(connection.lastInboundAt, Math.min(event.timestamp, Date.now())),
      };

      if (event.phone) connectionPatch.phone = event.phone;
      await ctx.db.patch(connection._id, connectionPatch);

      const waiting = await ctx.db
        .query("whatsappOutbox")
        .withIndex("by_connection_status", (q) =>
          q.eq("connectionId", connection!._id).eq("status", "awaiting_window"),
        )
        .collect();

      for (const row of waiting) await ctx.db.patch(row._id, { status: "pending" });
      await ctx.scheduler.runAfter(0, internal.whatsapp.deliver, { connectionId: connection._id });

      if (isStop(event.text)) {
        await ctx.runMutation(internal.caetano.stopForOwner, { userId: connection.userId });
        await enqueue(
          ctx,
          connection._id,
          "Interrompi a conversa e limpei os pedidos na fila. Ações já concluídas, como publicações, não são desfeitas.",
        );
      } else if (!event.text) {
        await enqueue(
          ctx,
          connection._id,
          "Por enquanto, envie seu pedido em texto. Para anexar imagens, abra a conversa no Vanda Studio.",
        );
      } else {
        try {
          await ctx.runMutation(internal.caetano.submitMessageForUser, {
            userId: connection.userId,
            prompt: event.text,
            connectionId: connection._id,
            externalMessageId: event.messageId,
          });
          await ctx.scheduler.runAfter(0, internal.whatsapp.markRead, {
            messageId: event.messageId,
          });
        } catch {
          await enqueue(
            ctx,
            connection._id,
            "Não consegui iniciar esse pedido. Confira o limite do plano e a fila de mensagens no Vanda Studio antes de tentar novamente.",
          );
        }
      }
    }
  },
});

export const claimDelivery = internalMutation({
  args: { connectionId: v.id("whatsappConnections") },
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.db.get(connectionId);

    if (!connection?.active) return null;

    const sending = await ctx.db
      .query("whatsappOutbox")
      .withIndex("by_connection_status", (q) =>
        q.eq("connectionId", connectionId).eq("status", "sending"),
      )
      .first();

    if (sending) return null;

    const row = await ctx.db
      .query("whatsappOutbox")
      .withIndex("by_connection_status", (q) =>
        q.eq("connectionId", connectionId).eq("status", "pending"),
      )
      .first();

    if (!row) return null;

    if (row.nextAttemptAt && row.nextAttemptAt > Date.now()) {
      await ctx.scheduler.runAt(row.nextAttemptAt, internal.whatsapp.deliver, { connectionId });

      return null;
    }

    if (!serviceWindowOpen(connection.lastInboundAt)) {
      await ctx.db.patch(row._id, { status: "awaiting_window" });
      await ctx.scheduler.runAfter(0, internal.whatsapp.deliver, { connectionId });

      return null;
    }

    await ctx.db.patch(row._id, { status: "sending", attempts: row.attempts + 1 });
    await ctx.scheduler.runAfter(60_000, internal.whatsappData.deliveryTimeout, {
      id: row._id,
      attempts: row.attempts + 1,
    });

    return {
      ...row,
      attempts: row.attempts + 1,
      sender: connection.phone ?? connection.sender,
      recipientKind: connection.phone ? ("phone" as const) : connection.recipientKind,
      phoneNumberId: connection.phoneNumberId,
    };
  },
});

export const finishDelivery = internalMutation({
  args: {
    id: v.id("whatsappOutbox"),
    status: v.union(
      v.literal("sent"),
      v.literal("pending"),
      v.literal("failed"),
      v.literal("unknown"),
      v.literal("awaiting_window"),
    ),
    externalMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const row = await ctx.db.get(id);

    if (!row) return;

    // Delivery/read webhook may beat the HTTP response.
    if (row.status === "sending") {
      const deliveryPatch = { ...patch };

      if (patch.status === "pending")
        Object.assign(deliveryPatch, { nextAttemptAt: Date.now() + 10_000 * row.attempts });
      await ctx.db.patch(id, deliveryPatch);
    }

    await ctx.scheduler.runAfter(
      patch.status === "pending" ? 10_000 * row.attempts : 0,
      internal.whatsapp.deliver,
      { connectionId: row.connectionId },
    );
  },
});

export const deliveryTimeout = internalMutation({
  args: { id: v.id("whatsappOutbox"), attempts: v.number() },
  handler: async (ctx, { id, attempts }) => {
    const row = await ctx.db.get(id);

    if (row?.status !== "sending" || row.attempts !== attempts) return;
    await ctx.db.patch(id, {
      status: "unknown",
      error: "Envio sem confirmação. Confira o WhatsApp antes de reenviar.",
    });
    await ctx.scheduler.runAfter(0, internal.whatsapp.deliver, { connectionId: row.connectionId });
  },
});

export const retryDelivery = mutation({
  args: { id: v.id("whatsappOutbox") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(id);
    const connection = row ? await ctx.db.get(row.connectionId) : null;

    if (!row || !connection?.active || connection.userId !== user._id)
      throw new Error("mensagem não encontrada");

    if (!["failed", "unknown"].includes(row.status))
      throw new Error("mensagem não pode ser reenviada");
    await ctx.db.patch(id, {
      status: "pending",
      error: undefined,
      nextAttemptAt: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.whatsapp.deliver, { connectionId: row.connectionId });
  },
});
