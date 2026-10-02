import { describe, expect, it } from "vitest";
import {
  isStop,
  linkToken,
  parseWebhook,
  replyParts,
  serviceWindowOpen,
  verifySignature,
  webhookSchema,
} from "./protocol";

const payload = {
  phone_number_id: "sandbox",
  message: {
    id: "m1",
    timestamp: "1730092800",
    type: "text",
    from: "5511999999999",
    text: { body: "Oi" },
    kapso: { direction: "inbound" },
  },
};

type MessagePatch = {
  type: string;
  image?: { id: string; caption?: string };
  audio?: { id: string };
  kapso: {
    direction: string;
    media_url?: string;
    media_data?: { content_type: string };
    transcript?: { text: string };
  };
};

const kapsoMedia = (contentType: string) => ({
  direction: "inbound",
  media_url: "https://api.kapso.ai/media/1",
  media_data: { content_type: contentType },
});

describe("Kapso protocol", () => {
  it("rejects malformed and oversized webhook bodies at the boundary", () => {
    expect(webhookSchema.safeParse({ message: { id: "missing-number" } }).success).toBe(false);
    expect(webhookSchema.safeParse({ batch: true, data: [null] }).success).toBe(false);
    expect(
      webhookSchema.safeParse({ batch: true, data: Array.from({ length: 101 }, () => payload) })
        .success,
    ).toBe(false);
  });

  it("omits unavailable phone and callback fields", () => {
    const body = webhookSchema.parse({
      phone_number_id: "sandbox",
      message: {
        id: "bsuid-only",
        from_user_id: "BR.123",
        timestamp: "1730092800",
        kapso: { direction: "inbound" },
      },
    });

    const event = parseWebhook(body, "whatsapp.message.received", "sandbox")[0];
    expect(event).not.toHaveProperty("phone");
    expect(event).not.toHaveProperty("callbackId");
  });

  it("extracts image captions, Kapso transcripts and media still to download", () => {
    const received = (message: MessagePatch) =>
      parseWebhook(
        webhookSchema.parse({ ...payload, message: { ...payload.message, ...message } }),
        "whatsapp.message.received",
        "sandbox",
      )[0];

    expect(
      received({
        type: "image",
        image: { id: "img1", caption: "Usa essa foto" },
        kapso: kapsoMedia("image/jpeg"),
      }),
    ).toMatchObject({
      text: "Usa essa foto",
      media: {
        kind: "image",
        id: "img1",
        mimeType: "image/jpeg",
        url: "https://api.kapso.ai/media/1",
      },
    });

    const transcribed = received({
      type: "audio",
      audio: { id: "aud1" },
      kapso: { ...kapsoMedia("audio/ogg"), transcript: { text: "faz um post" } },
    });

    expect(transcribed?.text).toBe("[Áudio transcrito] faz um post");
    expect(transcribed).not.toHaveProperty("media");

    expect(
      received({ type: "audio", audio: { id: "aud2" }, kapso: kapsoMedia("audio/ogg") }),
    ).toMatchObject({ text: "", media: { kind: "audio", id: "aud2" } });

    const video = received({ type: "video", kapso: { direction: "inbound" } });
    expect(video?.text).toBe("");
    expect(video).not.toHaveProperty("media");
  });

  it("normalizes single and buffered v2 events", () => {
    const single = parseWebhook(payload, "whatsapp.message.received", "sandbox");
    expect(
      parseWebhook(
        { ...payload, message: { ...payload.message, from_user_id: "BR.123" } },
        "whatsapp.message.received",
        "sandbox",
      )[0],
    ).toMatchObject({ sender: "BR.123", phone: "5511999999999" });
    expect(single[0]).toMatchObject({
      sender: "5511999999999",
      text: "Oi",
      timestamp: 1730092800000,
    });
    expect(
      parseWebhook({ batch: true, data: [payload] }, "whatsapp.message.received", "sandbox"),
    ).toEqual(single);
    expect(() => parseWebhook(payload, "whatsapp.message.received", "foreign")).toThrow();
  });
  it("supports BSUID-only identity and ignores backfill and outbound echoes", () => {
    expect(
      parseWebhook(
        { ...payload, message: { ...payload.message, from: undefined, from_user_id: "US.123" } },
        "whatsapp.message.received",
        "sandbox",
      )[0],
    ).toMatchObject({ sender: "US.123", recipientKind: "bsuid" });

    for (const kapso of [
      { direction: "outbound" },
      { direction: "inbound", origin: "history_sync" },
    ]) {
      expect(
        parseWebhook(
          { ...payload, message: { ...payload.message, kapso } },
          "whatsapp.message.received",
          "sandbox",
        ),
      ).toEqual([]);
    }
  });
  it("verifies the exact signed bytes and safely rejects malformed signatures", async () => {
    const raw = JSON.stringify(payload);

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const sig = Array.from(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");

    expect(await verifySignature(raw, sig, "secret")).toBe(true);
    expect(await verifySignature(`${raw} `, sig, "secret")).toBe(false);
    expect(await verifySignature(raw, null, "secret")).toBe(false);
    expect(await verifySignature(raw, "broken", "secret")).toBe(false);
  });
  it("bounds replies without breaking emoji and converts links", () => {
    const parts = replyParts("🙂".repeat(4000));
    expect(parts).toHaveLength(2);
    expect(parts.join("")).toBe("🙂".repeat(4000));
    expect(replyParts("**Oi** [Abrir](https://example.com)")).toEqual([
      "*Oi* Abrir: https://example.com",
    ]);
  });
  it("recognizes exact control messages and enforces the service window", () => {
    expect(isStop("parar")).toBe(true);
    expect(isStop("não parar")).toBe(false);
    expect(linkToken(`vanda conectar ${"a".repeat(64)}`)).toBe("a".repeat(64));
    expect(linkToken("vanda conectar guess")).toBeNull();
    expect(serviceWindowOpen(1000, 1001)).toBe(true);
    expect(serviceWindowOpen(1000, 1000 + 86400000)).toBe(false);
  });
});
