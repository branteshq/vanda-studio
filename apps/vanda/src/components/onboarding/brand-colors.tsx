import { useRef, useState, type ChangeEvent, type ClipboardEvent, type CSSProperties } from "react";
import { useMutation } from "convex/react";
import { useUIMessages } from "@convex-dev/agent/react";
import { ImageIcon, Plus, X } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Input } from "@vanda-studio/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@vanda-studio/ui/components/select";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const ROLES = ["principal", "destaque", "fundo", "texto"] as const;

type Role = (typeof ROLES)[number];

interface PaletteColor {
  key: string;
  hex: string;
  role: Role;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const MAX_COLORS = 6;

const COLOR_QUESTION = /\b(cor|cores|paleta|hex)\b/i;

const HEX = /^#[0-9a-f]{6}$/i;

/** RGB distance under which two sampled colors count as the same one. */
const NEAR_DUPLICATE = 40;

const SAMPLE = 64;

/** Below 3:1 a pair can't carry readable text, even large. */
const MIN_CONTRAST = 3;

/** WCAG relative luminance of a "#rrggbb" color. */
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;

    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** WCAG contrast ratio between two colors (1 to 21). */
const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);

  return (light! + 0.05) / (dark! + 0.05);
};

/** The swatch fill: a valid hex, or transparent while the text is still being typed. */
const swatchOf = (hex: string): string => (HEX.test(hex) ? hex : "transparent");

/**
 * Dominant colors of an image: a 64×64 sample, pixels bucketed by 4 bits per
 * channel, the largest buckets first, near-duplicates dropped.
 */
async function dominantColors(file: Blob): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");

  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) return [];

  context.drawImage(bitmap, 0, 0, SAMPLE, SAMPLE);
  bitmap.close();
  const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);
  const buckets = new Map<number, Rgb & { count: number }>();

  for (let i = 0; i < data.length; i += 4) {
    const [r = 0, g = 0, b = 0, alpha = 0] = data.subarray(i, i + 4);

    if (alpha < 128) continue;

    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };

    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const picked: Rgb[] = [];

  for (const { count, ...sum } of [...buckets.values()].toSorted((a, b) => b.count - a.count)) {
    if (picked.length >= MAX_COLORS) break;

    const color = { r: sum.r / count, g: sum.g / count, b: sum.b / count };

    const distinct = picked.every(
      (other) =>
        Math.hypot(other.r - color.r, other.g - color.g, other.b - color.b) >= NEAR_DUPLICATE,
    );

    if (distinct) picked.push(color);
  }

  return picked.map(
    ({ r, g, b }) =>
      `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`,
  );
}

/**
 * The brand palette in the guide chat: the owner picks, types, pastes or reads
 * colors from an image, then sends them to Caetano as a (dono) message.
 */
export function BrandColors({
  accountId,
  threadId,
}: {
  accountId: Id<"accounts">;
  threadId: string;
}) {
  const sendMessage = useMutation(api.chat.sendMessage);

  const messages = useUIMessages(
    api.chat.listMessages,
    { accountId, threadId },
    { initialNumItems: 2, stream: true },
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [colors, setColors] = useState<PaletteColor[]>([]);
  const [pickerHex, setPickerHex] = useState("#3860be");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);

  // Opens by itself when Caetano's newest reply asks about colors, once the turn has settled.
  const latest = messages.results.findLast((message) => message.role === "assistant");

  const latestText = (latest?.parts ?? []).flatMap((part) =>
    part.type === "text" ? [part.text] : [],
  );

  // Only the closing question counts: "a cor principal" in a recap is not a color question.
  const closingSentence =
    latestText
      .join(" ")
      .split(/[.!]\s/)
      .at(-1) ?? "";

  const open =
    latest !== undefined &&
    latest.status !== "streaming" &&
    COLOR_QUESTION.test(closingSentence) &&
    latest.key !== dismissedKey;

  const dismiss = () => setDismissedKey(latest?.key ?? null);

  const full = colors.length >= MAX_COLORS;
  const valid = colors.filter((color) => HEX.test(color.hex));

  const lowContrast = valid.flatMap((a, index) =>
    valid.slice(index + 1).flatMap((b) => {
      const ratio = contrast(a.hex, b.hex);

      return ratio < MIN_CONTRAST
        ? [`${a.hex} × ${b.hex} = ${ratio.toFixed(1).replace(".", ",")}:1`]
        : [];
    }),
  );

  const addColor = (hex: string) => {
    const normalized = hex.toLowerCase();

    if (full || !HEX.test(normalized)) return;

    if (colors.some((color) => color.hex === normalized)) return;

    const role: Role = colors.length === 0 ? "principal" : "destaque";

    setColors([...colors, { key: crypto.randomUUID(), hex: normalized, role }]);
  };

  const updateColor = (key: string, patch: Partial<Omit<PaletteColor, "key">>) => {
    setColors(colors.map((color) => (color.key === key ? { ...color, ...patch } : color)));
  };

  const readImage = async (file: Blob) => {
    setExtracting(true);
    setImageError(false);

    try {
      setSuggestions(await dominantColors(file));
    } catch {
      setSuggestions([]);
      setImageError(true);
    } finally {
      setExtracting(false);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    const image = Array.from(event.clipboardData.files).find((file) =>
      file.type.startsWith("image/"),
    );

    if (!image) return;

    event.preventDefault();
    void readImage(image);
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) void readImage(file);

    event.target.value = "";
  };

  const onSend = async () => {
    const list = valid.map((color) => `${color.hex} (${color.role})`).join(", ");

    const prompt = lowContrast.length
      ? `Nossas cores: ${list}. Contraste medido: ${lowContrast.join("; ")}.`
      : `Nossas cores: ${list}.`;

    setSending(true);
    setSendError(false);

    try {
      await sendMessage({ accountId, threadId, prompt });
      setColors([]);
      setSuggestions([]);
      dismiss();
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <section
      aria-label="Cores da marca"
      onPaste={onPaste}
      className="rounded-xl border border-border bg-surface p-4"
    >
      <p className="mb-3 text-body font-medium text-text">Escolha as cores da marca</p>

      <ul className="flex flex-col gap-2">
        {colors.map((color, index) => (
          <li key={color.key} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              // SAFETY: React accepts custom properties at runtime; CSSProperties omits their open-ended names. The value is a validated hex or transparent.
              style={{ "--swatch": swatchOf(color.hex) } as CSSProperties}
              className="mt-0.5 size-8 shrink-0 rounded-md border border-border bg-(--swatch)"
            />
            <div className="min-w-0 flex-1">
              <Input
                aria-label={`Cor ${index + 1}`}
                aria-invalid={!HEX.test(color.hex)}
                maxLength={7}
                value={color.hex}
                onChange={(event) =>
                  updateColor(color.key, { hex: event.target.value.trim().toLowerCase() })
                }
              />
              {HEX.test(color.hex) ? null : (
                <p className="mt-1 text-caption text-destructive">Use o formato #rrggbb.</p>
              )}
            </div>
            <Select
              value={color.role}
              onValueChange={(value) => {
                const role = ROLES.find((item) => item === value);

                if (role) updateColor(color.key, { role });
              }}
            >
              <SelectTrigger aria-label={`Papel da cor ${index + 1}`} className="w-24 sm:w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remover cor ${index + 1}`}
              onClick={() => setColors(colors.filter((item) => item.key !== color.key))}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>

      {lowContrast.length ? (
        <p className="mt-3 text-body-sm text-amber">
          Pouco contraste ({lowContrast.join("; ")}): texto com essas cores pode ficar ilegível.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label="Escolher cor"
          value={pickerHex}
          onChange={(event) => setPickerHex(event.target.value)}
          className="size-8 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
        />
        <Button variant="outline" size="sm" disabled={full} onClick={() => addColor(pickerHex)}>
          <Plus />
          Adicionar
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={full || extracting}
          onClick={() => fileRef.current?.click()}
        >
          <ImageIcon />
          Tirar cores de uma imagem
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          aria-label="Imagem com as cores"
          onChange={onFile}
          className="hidden"
        />
      </div>

      {extracting ? <p className="mt-3 text-caption text-text-4">Lendo a imagem…</p> : null}
      {imageError ? (
        <p className="mt-3 text-caption text-destructive">Não consegui ler essa imagem.</p>
      ) : null}
      {suggestions.length > 0 ? (
        <div className="mt-3">
          <p className="text-caption text-text-4">Toque para adicionar</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {suggestions.map((hex) => (
              <li key={hex}>
                <button
                  type="button"
                  aria-label={`Adicionar ${hex}`}
                  disabled={full}
                  onClick={() => addColor(hex)}
                  // SAFETY: React accepts custom properties at runtime; CSSProperties omits their open-ended names. The value is a hex produced by dominantColors.
                  style={{ "--swatch": hex } as CSSProperties}
                  className="size-8 cursor-pointer rounded-md border border-border bg-(--swatch) disabled:cursor-not-allowed disabled:opacity-50"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-end gap-2">
        {sendError ? (
          <p className="mr-auto text-caption text-destructive">
            Não consegui enviar. Tente de novo.
          </p>
        ) : null}
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Fechar
        </Button>
        <Button size="sm" disabled={valid.length === 0 || sending} onClick={() => void onSend()}>
          Enviar para o Caetano
        </Button>
      </div>
    </section>
  );
}
