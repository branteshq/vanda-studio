// @vitest-environment edge-runtime
import { createThread } from "@convex-dev/agent";
import agentComponent from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import { caetano } from "./caetanoAgent";
import schema from "./schema";
import { enqueueItems, notifyOwner } from "./whatsappData";

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

  it("delivers a turn's presented post and images after the text, in order", async () => {
    const { t, event, userId } = await setup();
    const now = Date.now();

    const { accountId, png, webp, postId } = await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        createdAt: now,
        updatedAt: now,
      });

      const image = async (type: string) =>
        ctx.db.insert("images", {
          accountId,
          origin: "generated",
          storageId: await ctx.storage.store(new Blob(["x"], { type })),
          mimeType: type,
          createdAt: now,
        });

      const slides = [await image("image/png"), await image("image/jpeg")];

      const postId = await ctx.db.insert("posts", {
        accountId,
        type: "feed",
        imageIds: slides,
        caption: "Legenda do carrossel",
        platform: "instagram",
        status: "draft",
        createdAt: now,
      });

      return { accountId, png: slides[0]!, webp: await image("image/webp"), postId };
    });

    await t.mutation(internal.whatsappData.ingest, { deliveryKey: "a", events: [event("m1")] });
    await t.mutation(internal.caetano.startNext, { userId });
    const activity = await t.run((ctx) => ctx.db.query("caetanoThreadActivity").first());
    await t.mutation(internal.threadResources.record, {
      threadId: activity!.threadId,
      anchorMessageId: activity!.promptMessageId,
      toolCallId: "tool1",
      resources: [],
      presented: [
        { kind: "post", accountId, postId },
        { kind: "image", accountId, imageId: png },
        { kind: "image", accountId, imageId: webp },
      ],
    });
    await t.mutation(internal.caetano.deliverTurn, { activityId: activity!._id, text: "Pronto!" });

    const outbox = await t.run((ctx) => ctx.db.query("whatsappOutbox").collect());
    expect(outbox.map((row) => [row.kind ?? "text", row.text])).toEqual([
      ["text", "Pronto!"],
      ["image", ""],
      ["image", ""],
      ["text", "Legenda:\nLegenda do carrossel"],
      ["image", ""],
    ]);
    expect(outbox.at(-1)?.imageId).toBe(webp);
    expect(outbox.some((row) => row.text.includes("/caetano"))).toBe(false);
  });

  it("sends JPEG/PNG as images and other formats as documents", async () => {
    const { t, connectionId, userId } = await setup();
    vi.stubEnv("KAPSO_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.out" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const [png, webp] = await t.run(async (ctx) => {
      const now = Date.now();

      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        createdAt: now,
        updatedAt: now,
      });

      return Promise.all(
        ["image/png", "image/webp"].map(async (type) =>
          ctx.db.insert("images", {
            accountId,
            origin: "generated",
            name: "Capa/verão",
            storageId: await ctx.storage.store(new Blob(["x"], { type })),
            mimeType: type,
            createdAt: now,
          }),
        ),
      );
    });

    await t.run((ctx) =>
      enqueueItems(ctx, connectionId, [
        { kind: "image", imageId: png!, caption: "Capa" },
        { kind: "image", imageId: webp! },
      ]),
    );
    await t.action(internal.whatsapp.deliver, { connectionId });
    await t.action(internal.whatsapp.deliver, { connectionId });

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(bodies[0]).toMatchObject({ type: "image", image: { caption: "Capa" } });
    expect(bodies[0].image.link).toMatch(/^https?:\/\//);
    expect(bodies[1]).toMatchObject({
      type: "document",
      document: { filename: "Capa verão.webp" },
    });
  });

  it("hands a burst with photos to the media step instead of starting a text-only turn", async () => {
    const { t, event } = await setup();
    await t.mutation(internal.whatsappData.ingest, {
      deliveryKey: "photos",
      events: [
        event("m1", "Usa essa foto"),
        { ...event("m2", ""), media: { kind: "image" as const, id: "img1" } },
      ],
    });

    expect(await t.run((ctx) => ctx.db.query("caetanoInbox").collect())).toHaveLength(0);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const prepare = scheduled.find((job) => job.name.includes("prepareTurn"));
    expect(prepare?.args[0]).toMatchObject({
      text: "Usa essa foto",
      media: [{ kind: "image", id: "img1" }],
    });
  });

  it("downloads photos, transcribes a voice note and submits one turn with both", async () => {
    const { t, userId, connectionId } = await setup();
    vi.stubEnv("KAPSO_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_API_KEY", "router-key");
    const now = Date.now();
    await t.run(async (ctx) => {
      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        createdAt: now,
        updatedAt: now,
      });

      await ctx.db.patch(userId, { activeAccountId: accountId });
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://api.kapso.ai/meta/whatsapp/v24.0/")) {
        expect(init?.headers).toMatchObject({ "X-API-Key": "test-key" });

        return Response.json({
          download_url: `https://api.kapso.ai/dl/${url.includes("img") ? "img" : "aud"}`,
        });
      }

      if (url === "https://api.kapso.ai/dl/img")
        return new Response(new Blob(["jpg"], { type: "image/jpeg" }));

      if (url === "https://api.kapso.ai/dl/aud")
        return new Response(new Blob(["ogg"], { type: "audio/ogg" }));

      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        const body = JSON.parse(String(init?.body));
        expect(body.messages[0].content[1]).toMatchObject({
          type: "input_audio",
          input_audio: { format: "ogg" },
        });

        return Response.json({ choices: [{ message: { content: "faz um post com essa foto" } }] });
      }

      throw new Error(`unexpected fetch ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.whatsappMedia.prepareTurn, {
      connectionId,
      text: "",
      media: [
        { kind: "image", id: "img1", mimeType: "image/jpeg" },
        { kind: "audio", id: "aud1", mimeType: "audio/ogg" },
      ],
      externalMessageId: "m1",
    });

    const images = await t.run((ctx) => ctx.db.query("images").collect());
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ origin: "uploaded", mimeType: "image/jpeg" });
    expect(images[0]?.lastAttachedAt).toBeDefined();
    const inbox = await t.run((ctx) => ctx.db.query("caetanoInbox").collect());
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ channel: "whatsapp", connectionId, externalMessageId: "m1" });
    expect(await t.run((ctx) => ctx.db.query("whatsappOutbox").collect())).toHaveLength(0);
  });

  it("tells the sender when a photo cannot be used and still keeps the text", async () => {
    const { t, connectionId } = await setup();
    vi.stubEnv("KAPSO_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));

    await t.action(internal.whatsappMedia.prepareTurn, {
      connectionId,
      text: "Faz um post",
      media: [{ kind: "image", id: "img1" }],
      externalMessageId: "m1",
    });

    const outbox = await t.run((ctx) => ctx.db.query("whatsappOutbox").collect());
    expect(outbox.map((row) => row.text)).toEqual([
      "Não consegui baixar uma das fotos. Pode enviar de novo?",
    ]);
    expect(await t.run((ctx) => ctx.db.query("caetanoInbox").collect())).toHaveLength(1);
  });

  it("sends an owner notification as text in the window and as the template outside it", async () => {
    const { t, userId, connectionId } = await setup();
    vi.stubEnv("KAPSO_API_KEY", "test-key");
    vi.stubEnv("KAPSO_UPDATE_TEMPLATE", "caetano_atualizacao");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ messages: [{ id: "wamid.out" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await t.run((ctx) => notifyOwner(ctx, userId, "Publicado no Instagram.\nhttps://ig/p/1"));
    await t.action(internal.whatsapp.deliver, { connectionId });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
      type: "text",
      text: { body: "Publicado no Instagram.\nhttps://ig/p/1" },
    });

    await t.run((ctx) => ctx.db.patch(connectionId, { lastInboundAt: Date.now() - 86400001 }));
    await t.run((ctx) => notifyOwner(ctx, userId, "A publicação falhou:\ntoken expirado"));
    await t.action(internal.whatsapp.deliver, { connectionId });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      type: "template",
      template: {
        name: "caetano_atualizacao",
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: "A publicação falhou: token expirado" }],
          },
        ],
      },
    });
  });

  it("holds an owner notification for the next message when no template is configured", async () => {
    const { t, userId, connectionId } = await setup();
    await t.run((ctx) => ctx.db.patch(connectionId, { lastInboundAt: Date.now() - 86400001 }));
    await t.run((ctx) => notifyOwner(ctx, userId, "Publicado no Instagram."));
    expect(await t.mutation(internal.whatsappData.claimDelivery, { connectionId })).toBeNull();
    expect((await t.run((ctx) => ctx.db.query("whatsappOutbox").first()))?.status).toBe(
      "awaiting_window",
    );
  });

  it("reports a publication on WhatsApp and records it in Caetano's conversation", async () => {
    const { t, userId } = await setup();
    const now = Date.now();

    const scheduledPostId = await t.run(async (ctx) => {
      const caetanoThreadId = await createThread(ctx, components.agent, {
        userId: `caetano:${userId}`,
      });

      await ctx.db.patch(userId, { caetanoThreadId });

      const accountId = await ctx.db.insert("accounts", {
        ownerUserId: userId,
        handle: "cafelumiar",
        createdAt: now,
        updatedAt: now,
      });

      const postId = await ctx.db.insert("posts", {
        accountId,
        type: "image",
        imageIds: [],
        caption: "Legenda",
        platform: "instagram",
        status: "published",
        createdAt: now,
      });

      return ctx.db.insert("scheduledPosts", {
        accountId,
        postId,
        scheduledFor: now,
        status: "published",
        permalink: "https://instagram.com/p/result",
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(internal.threadResources.postPublicationFollowup, { scheduledPostId });

    const outbox = await t.run((ctx) => ctx.db.query("whatsappOutbox").collect());
    expect(outbox.map((row) => row.text)).toEqual([
      "Publicado no Instagram (@cafelumiar).\nhttps://instagram.com/p/result",
    ]);
    const manifests = await t.run((ctx) => ctx.db.query("threadResourceManifests").collect());
    expect(manifests).toHaveLength(1);
  });

  it("folds a message sent mid-turn into that turn and sends one answer", async () => {
    const { t, event, userId } = await setup();
    await t.mutation(internal.whatsappData.ingest, {
      deliveryKey: "first",
      events: [event("m1", "que ferramentas você tem acesso?")],
    });
    await t.mutation(internal.caetano.startNext, { userId });
    // Arrives after the buffer flushed, while the first turn is running.
    await t.mutation(internal.whatsappData.ingest, {
      deliveryKey: "second",
      events: [event("m2", "me mostra as funções")],
    });

    const [running, queued] = await t.run((ctx) => ctx.db.query("caetanoInbox").collect());
    const activity = await t.run((ctx) => ctx.db.query("caetanoThreadActivity").first());
    const texts = ["rascunho que não sai", "Resposta única para as duas mensagens"];

    // SAFETY: generateResponse reads only consumeStream and text from this stream-result test double.
    const stream = vi.spyOn(caetano, "streamText").mockImplementation(async () =>
      Object.assign(Object.create(null), {
        consumeStream: async () => {},
        text: Promise.resolve(texts.shift() ?? ""),
      }),
    );

    try {
      expect(
        await t.action(internal.caetano.generateResponse, {
          userId,
          threadId: activity!.threadId,
          promptMessageId: activity!.promptMessageId,
          activityId: activity!._id,
        }),
      ).toBe("Resposta única para as duas mensagens");
      expect(stream).toHaveBeenCalledTimes(2);
      expect(stream.mock.calls[1]?.[2]).toMatchObject({
        promptMessageId: queued!.promptMessageId,
        system: expect.stringContaining("O dono mandou mais mensagens"),
      });
    } finally {
      stream.mockRestore();
    }

    expect((await t.run((ctx) => ctx.db.get(queued!._id)))?.status).toBe("merged");
    expect((await t.run((ctx) => ctx.db.get(running!._id)))?.status).toBe("done");
    expect(
      (await t.run((ctx) => ctx.db.query("whatsappOutbox").collect())).map((row) => row.text),
    ).toEqual(["Resposta única para as duas mensagens"]);
  });

  it("marks the newest message of a burst as read", async () => {
    const { t, event } = await setup();
    await t.mutation(internal.whatsappData.ingest, {
      deliveryKey: "burst",
      events: [
        event("m1", "que ferramentas você tem acesso?"),
        event("m2", "me mostra as funções"),
      ],
    });

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const reads = scheduled.filter((job) => job.name.includes("markRead"));
    expect(reads.map((job) => job.args[0])).toEqual([{ messageId: "m2" }]);
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
