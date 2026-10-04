import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";

const KAPSO_API = "https://api.kapso.ai/meta/whatsapp/v24.0";

// Chat attachments are capped at 4 images (resolveMessageImages).
const MAX_IMAGES = 4;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// WhatsApp's own ceiling for audio messages.
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

export const TRANSCRIPTION_MODEL = "google/gemini-2.5-flash";

const mediaUrlSchema = z.object({ download_url: z.string().url() });

const transcriptionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

type Media = { kind: "image" | "audio"; id: string; mimeType?: string; url?: string };

/**
 * Kapso's short-lived download URL carries its own token. The webhook's media_url
 * is the fallback and is fetched with the project key.
 */
async function download(media: Media, maxBytes: number): Promise<Blob> {
  const key = process.env.KAPSO_API_KEY;
  const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID;

  if (!key || !phoneNumberId) throw new Error("Kapso is not configured");

  let source: Response | null = null;

  const lookup = await fetch(
    `${KAPSO_API}/${encodeURIComponent(media.id)}?phone_number_id=${encodeURIComponent(phoneNumberId)}`,
    { headers: { "X-API-Key": key }, signal: AbortSignal.timeout(15_000) },
  );

  if (lookup.ok) {
    const parsed = mediaUrlSchema.safeParse(await lookup.json());

    if (parsed.success)
      source = await fetch(parsed.data.download_url, { signal: AbortSignal.timeout(30_000) });
  }

  if (!source?.ok && media.url?.startsWith("https://api.kapso.ai/")) {
    source = await fetch(media.url, {
      headers: { "X-API-Key": key },
      signal: AbortSignal.timeout(30_000),
    });
  }

  if (!source?.ok) throw new Error(`media download failed (${source?.status ?? lookup.status})`);

  const declared = Number(source.headers.get("content-length") ?? 0);

  if (declared > maxBytes) throw new Error("media too large");
  const bytes = await source.arrayBuffer();

  if (bytes.byteLength > maxBytes) throw new Error("media too large");

  const type =
    media.mimeType ??
    source.headers.get("content-type")?.split(";")[0] ??
    "application/octet-stream";

  return new Blob([bytes], { type });
}

const AUDIO_FORMATS = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
} as const;

const isKnownAudioType = (mimeType: string): mimeType is keyof typeof AUDIO_FORMATS =>
  Object.hasOwn(AUDIO_FORMATS, mimeType);

// WhatsApp voice notes are Opus in Ogg, the default when the type is unknown.
const audioFormat = (mimeType: string): string =>
  isKnownAudioType(mimeType) ? AUDIO_FORMATS[mimeType] : "ogg";

function base64(bytes: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));

  return btoa(binary);
}

/** Fallback when Kapso's automatic transcription is off or did not finish in time. */
async function transcribe(audio: Blob): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;

  if (!key) throw new Error("OPENROUTER_API_KEY missing");
  const mimeType = audio.type.split(";")[0] ?? "";

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: TRANSCRIPTION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcreva fielmente este áudio, no idioma falado. Responda somente com a transcrição, sem comentários.",
            },
            {
              type: "input_audio",
              input_audio: {
                data: base64(new Uint8Array(await audio.arrayBuffer())),
                format: audioFormat(mimeType),
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`transcription failed (${response.status})`);
  const text = transcriptionSchema.parse(await response.json()).choices[0]!.message.content?.trim();

  if (!text) throw new Error("empty transcription");

  return text;
}

/** Download a WhatsApp turn's images and voice notes, then submit it to Caetano. */
export const prepareTurn = internalAction({
  args: {
    connectionId: v.id("whatsappConnections"),
    text: v.string(),
    media: v.array(
      v.object({
        kind: v.union(v.literal("image"), v.literal("audio")),
        id: v.string(),
        mimeType: v.optional(v.string()),
        url: v.optional(v.string()),
      }),
    ),
    externalMessageId: v.string(),
  },
  handler: async (ctx, { connectionId, text, media, externalMessageId }): Promise<void> => {
    const transcripts: string[] = [];
    const uploads: { storageId: Id<"_storage">; mimeType: string }[] = [];
    const notes: string[] = [];
    const images = media.filter((item) => item.kind === "image");
    let imageFailures = 0;
    let audioFailures = 0;

    if (images.length > MAX_IMAGES)
      notes.push(`Recebi ${images.length} fotos; vou usar as ${MAX_IMAGES} primeiras.`);

    for (const image of images.slice(0, MAX_IMAGES)) {
      try {
        const blob = await download(image, MAX_IMAGE_BYTES);

        if (!blob.type.startsWith("image/")) throw new Error("not an image");
        uploads.push({ storageId: await ctx.storage.store(blob), mimeType: blob.type });
      } catch (error) {
        console.error("WhatsApp image download failed", { error });
        imageFailures++;
      }
    }

    for (const audio of media.filter((item) => item.kind === "audio")) {
      try {
        transcripts.push(
          `[Áudio transcrito] ${await transcribe(await download(audio, MAX_AUDIO_BYTES))}`,
        );
      } catch (error) {
        console.error("WhatsApp audio transcription failed", { error });
        audioFailures++;
      }
    }

    if (imageFailures > 0)
      notes.push(
        imageFailures === 1
          ? "Não consegui baixar uma das fotos. Pode enviar de novo?"
          : `Não consegui baixar ${imageFailures} fotos. Pode enviar de novo?`,
      );

    if (audioFailures > 0)
      notes.push("Não consegui entender o áudio. Pode mandar de novo ou escrever?");

    await ctx.runMutation(internal.whatsappData.submitMediaTurn, {
      connectionId,
      text: [text, ...transcripts].filter((part) => part.trim()).join("\n"),
      uploads,
      notes,
      externalMessageId,
    });
  },
});
