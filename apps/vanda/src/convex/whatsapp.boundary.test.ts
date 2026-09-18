// @vitest-environment edge-runtime
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const event = (messageId: string, text = "Oi") => ({
  event: "whatsapp.message.received",
  phoneNumberId: "sandbox",
  messageId,
  sender: "55119999",
  recipientKind: "phone" as const,
  text,
  timestamp: Date.now(),
});

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup() {
  vi.stubEnv("KAPSO_PHONE_NUMBER_ID", "sandbox");
  const t = convexTest(schema, modules);
  agentComponent.register(t);

  const userId = await t.run((ctx) =>
    ctx.db.insert("users", { clerkId: "ana", name: "Ana", email: "ana@example.com" }),
  );

  const otherId = await t.run((ctx) =>
    ctx.db.insert("users", { clerkId: "bia", name: "Bia", email: "bia@example.com" }),
  );

  const connectionId = await t.run((ctx) =>
    ctx.db.insert("whatsappConnections", {
      userId,
      phoneNumberId: "sandbox",
      sender: "55119999",
      recipientKind: "phone",
      active: true,
      connectedAt: Date.now(),
      lastInboundAt: Date.now(),
    }),
  );

  return { t, userId, otherId, connectionId, event, owner: t.withIdentity({ subject: "ana" }) };
}

describe("WhatsApp and canonical Caetano queue", () => {
  it("deduplicates batch retries and individual redelivery, merging a burst into one turn", async () => {
    const { t, event, userId } = await setup();
    const events = [event("m1", "Caetano"), event("m2", "Peça um post para amanhã")];
    await t.mutation(internal.whatsappData.ingest, { deliveryKey: "one", events });
    await t.mutation(internal.whatsappData.ingest, { deliveryKey: "one", events });
    await t.mutation(internal.whatsappData.ingest, {
      deliveryKey: "different",
      events: [events[1]!],
    });
    const inbox = await t.run((ctx) => ctx.db.query("caetanoInbox").collect());
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ userId, channel: "whatsapp", status: "queued" });
  });

  it("serializes web and WhatsApp in the same thread and delivers only WhatsApp-origin replies", async () => {
    const { t, owner, userId, event } = await setup();
    const web = await owner.mutation(api.caetano.sendMessage, { prompt: "Pedido web" });
    await t.mutation(internal.whatsappData.ingest, { deliveryKey: "wa", events: [event("m1")] });
    const inbox = await t.run((ctx) => ctx.db.query("caetanoInbox").collect());
    expect(inbox).toHaveLength(2);
    expect(inbox.every((row) => row.threadId === web.threadId)).toBe(true);
    await t.mutation(internal.caetano.startNext, { userId });
    await t.mutation(internal.caetano.startNext, { userId });
    let active = await t.run((ctx) => ctx.db.query("caetanoThreadActivity").collect());
    expect(active).toHaveLength(1);
    await t.mutation(internal.caetano.deliverTurn, {
      activityId: active[0]!._id,
      text: "Resposta web",
    });
    expect(await t.run((ctx) => ctx.db.query("whatsappOutbox").collect())).toHaveLength(0);
    await t.mutation(internal.caetano.finishActivity, { activityId: active[0]!._id });
    await t.mutation(internal.caetano.startNext, { userId });
    active = await t.run((ctx) => ctx.db.query("caetanoThreadActivity").collect());
    await t.mutation(internal.caetano.deliverTurn, {
      activityId: active[0]!._id,
      text: "Resposta WhatsApp",
    });
    expect(await t.run((ctx) => ctx.db.query("whatsappOutbox").collect())).toHaveLength(1);
  });

  it("stops a running turn and queued work without delivering a late completion", async () => {
    const { t, event, userId } = await setup();
    await t.mutation(internal.whatsappData.ingest, { deliveryKey: "a", events: [event("m1")] });
    await t.mutation(internal.caetano.startNext, { userId });
    const active = await t.run((ctx) => ctx.db.query("caetanoThreadActivity").first());
    await t.mutation(internal.whatsappData.ingest, {
      deliveryKey: "b",
      events: [event("m2"), event("m3", "parar")],
    });
    await t.mutation(internal.caetano.deliverTurn, { activityId: active!._id, text: "Too late" });
    expect(
      (await t.run((ctx) => ctx.db.query("caetanoInbox").collect())).every(
        (row) => row.status === "stopped",
      ),
    ).toBe(true);
    const outbox = await t.run((ctx) => ctx.db.query("whatsappOutbox").collect());
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.text).toContain("Interrompi");
  });

  it("consumes an expiring owner link once and refuses takeover of an active identity", async () => {
    const { t, event, otherId, owner, connectionId } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("whatsappLinks", {
        userId: otherId,
        tokenHash: "hash",
        expiresAt: Date.now() + 60000,
      }),
    );
    await t.mutation(internal.whatsappData.ingest, {
      deliveryKey: "a",
      events: [{ ...event("m1", ""), tokenHash: "hash" }],
    });
    expect((await t.run((ctx) => ctx.db.get(connectionId)))?.userId).not.toBe(otherId);
    await owner.mutation(api.whatsappData.disconnect, {});
    await t.mutation(internal.whatsappData.ingest, {
      deliveryKey: "b",
      events: [{ ...event("m2", ""), tokenHash: "hash" }],
    });

    const connection = await t.run((ctx) =>
      ctx.db
        .query("whatsappConnections")
        .withIndex("by_sender", (q) => q.eq("phoneNumberId", "sandbox").eq("sender", "55119999"))
        .unique(),
    );

    expect(connection?.userId).toBe(otherId);
    expect(connection?._id).not.toBe(connectionId);
    expect(await t.run((ctx) => ctx.db.query("whatsappLinks").collect())).toHaveLength(0);
  });

  it("waits for an open window and prevents foreign retries", async () => {
    const { t, event, connectionId } = await setup();
    await t.mutation(internal.whatsappData.enqueueReply, { connectionId, text: "Resultado salvo" });
    await t.run((ctx) => ctx.db.patch(connectionId, { lastInboundAt: Date.now() - 86400001 }));
    expect(await t.mutation(internal.whatsappData.claimDelivery, { connectionId })).toBeNull();
    let row = await t.run((ctx) => ctx.db.query("whatsappOutbox").first());
    expect(row?.status).toBe("awaiting_window");
    await t.mutation(internal.whatsappData.ingest, { deliveryKey: "new", events: [event("m1")] });
    row = await t.run((ctx) => ctx.db.get(row!._id));
    expect(row?.status).toBe("pending");
    await t.run((ctx) => ctx.db.patch(row!._id, { status: "unknown" }));
    await expect(
      t.withIdentity({ subject: "bia" }).mutation(api.whatsappData.retryDelivery, { id: row!._id }),
    ).rejects.toThrow("mensagem não encontrada");
  });

  it("keeps read status when a slower send response or delivered webhook arrives", async () => {
    const { t, connectionId } = await setup();
    await t.mutation(internal.whatsappData.enqueueReply, { connectionId, text: "Oi" });
    const row = await t.mutation(internal.whatsappData.claimDelivery, { connectionId });
    expect(await t.mutation(internal.whatsappData.claimDelivery, { connectionId })).toBeNull();

    for (const status of ["read", "delivered"])
      await t.mutation(internal.whatsappData.ingest, {
        deliveryKey: status,
        events: [
          {
            event: `whatsapp.message.${status}`,
            phoneNumberId: "sandbox",
            messageId: "out1",
            sender: "",
            recipientKind: "phone",
            text: "",
            timestamp: Date.now(),
            callbackId: row!._id,
          },
        ],
      });
    await t.mutation(internal.whatsappData.finishDelivery, {
      id: row!._id,
      status: "sent",
      externalMessageId: "out1",
    });
    expect((await t.run((ctx) => ctx.db.get(row!._id)))?.status).toBe("read");
  });

  it("sends stored replies through the sandbox endpoint without rerunning Caetano", async () => {
    const { t, connectionId } = await setup();
    vi.stubEnv("KAPSO_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.out" }] }));
    vi.stubGlobal("fetch", fetchMock);
    await t.mutation(internal.whatsappData.enqueueReply, { connectionId, text: "Resposta pronta" });
    await t.action(internal.whatsapp.deliver, { connectionId });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.kapso.ai/meta/whatsapp/v24.0/sandbox/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "X-API-Key": "test-key" }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      to: "55119999",
      type: "text",
      text: { body: "Resposta pronta" },
    });
    expect((await t.run((ctx) => ctx.db.query("whatsappOutbox").first()))?.status).toBe("sent");
    expect(await t.run((ctx) => ctx.db.query("caetanoInbox").collect())).toHaveLength(0);
  });

  it("uses the supplied phone for sandbox delivery while preserving the BSUID identity", async () => {
    const { t, connectionId, owner } = await setup();
    await t.run((ctx) => ctx.db.patch(connectionId, { sender: "BR.123", recipientKind: "bsuid" }));
    expect((await owner.query(api.whatsappData.state, {})).sender).toBeNull();
    await t.mutation(internal.whatsappData.ingest, {
      deliveryKey: "phone-update",
      events: [
        {
          event: "whatsapp.message.received",
          phoneNumberId: "sandbox",
          messageId: "phone-msg",
          sender: "BR.123",
          recipientKind: "bsuid",
          phone: "55119999",
          text: "Oi",
          timestamp: Date.now(),
        },
      ],
    });
    await t.mutation(internal.whatsappData.enqueueReply, { connectionId, text: "Resposta" });
    expect(await t.mutation(internal.whatsappData.claimDelivery, { connectionId })).toMatchObject({
      sender: "55119999",
      recipientKind: "phone",
    });
    expect((await t.run((ctx) => ctx.db.get(connectionId)))?.sender).toBe("BR.123");
    expect((await owner.query(api.whatsappData.state, {})).sender).toBe("55119999");
  });

  it("holds a reply when Kapso rejects a closed service window", async () => {
    const { t, connectionId } = await setup();
    vi.stubEnv("KAPSO_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Cannot send non-template messages outside the 24-hour window.",
          }),
          { status: 422 },
        ),
      ),
    );
    await t.mutation(internal.whatsappData.enqueueReply, { connectionId, text: "Resultado" });
    await t.action(internal.whatsapp.deliver, { connectionId });
    expect((await t.run((ctx) => ctx.db.query("whatsappOutbox").first()))?.status).toBe(
      "awaiting_window",
    );
  });

  it("marks ambiguous sends unknown rather than automatically duplicating them", async () => {
    const { t, connectionId } = await setup();
    vi.stubEnv("KAPSO_API_KEY", "test-key");
    const fetchMock = vi.fn().mockRejectedValue(new Error("timeout"));
    vi.stubGlobal("fetch", fetchMock);
    await t.mutation(internal.whatsappData.enqueueReply, { connectionId, text: "Resposta pronta" });
    await t.action(internal.whatsapp.deliver, { connectionId });
    await t.action(internal.whatsapp.deliver, { connectionId });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await t.run((ctx) => ctx.db.query("whatsappOutbox").first()))?.status).toBe("unknown");
  });

  it("requires a valid signature at the HTTP boundary and durably accepts signed events", async () => {
    const { t } = await setup();
    vi.stubEnv("KAPSO_WEBHOOK_SECRET", "secret");

    const body = JSON.stringify({
      phone_number_id: "sandbox",
      message: {
        id: "http1",
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        from: "55119999",
        text: { body: "Oi" },
        kapso: { direction: "inbound" },
      },
    });

    expect((await t.fetch("/webhooks/kapso", { method: "POST", body })).status).toBe(401);

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signature = Array.from(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");

    expect(
      (
        await t.fetch("/webhooks/kapso", {
          method: "POST",
          body,
          headers: {
            "X-Webhook-Signature": signature,
            "X-Webhook-Event": "whatsapp.message.received",
          },
        })
      ).status,
    ).toBe(200);
    expect(await t.run((ctx) => ctx.db.query("whatsappReceipts").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("caetanoInbox").collect())).toHaveLength(0);
  });

  it("does not process messages from unlinked senders or wrong business numbers", async () => {
    const { t, event } = await setup();
    await t.mutation(internal.whatsappData.ingest, {
      deliveryKey: "a",
      events: [{ ...event("m1"), sender: "stranger" }],
    });
    expect(await t.run((ctx) => ctx.db.query("caetanoInbox").collect())).toHaveLength(0);
    await expect(
      t.mutation(internal.whatsappData.ingest, {
        deliveryKey: "b",
        events: [{ ...event("m2"), phoneNumberId: "foreign" }],
      }),
    ).rejects.toThrow("wrong number");
  });
});
