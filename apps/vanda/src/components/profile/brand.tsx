import { useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "@vanda-studio/ui/components/button";
import { Markdown } from "@vanda-studio/ui/components/markdown";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import { cn } from "@vanda-studio/ui/lib/utils";
import type { Id } from "../../convex/_generated/dataModel";
import {
  BRAND_FILE_SECTIONS,
  brandFileFacts,
  factOrigin,
  type BrandFactOrigin,
} from "../../convex/brandFileText";
import { parseBrandKit } from "../../convex/workspace/brandKit";
import { errorMessage } from "../../errors";
import { useProfileRuntime } from "./runtime";

export function SectionCard({
  title,
  caption,
  action,
  children,
}: {
  title: string;
  caption?: string | undefined;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-body font-semibold">{title}</h2>
          {caption ? <p className="mt-0.5 text-body-sm text-text-3">{caption}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

const formatUpdated = (updatedAt: number | null, updatedBy: string | null): string => {
  if (updatedAt === null) return "Montado a partir do que a Vanda já sabia. Ainda não editado.";
  const who = updatedBy === "owner" ? "você" : "a Vanda";

  return `Atualizado por ${who} em ${new Date(updatedAt).toLocaleDateString("pt-BR")}.`;
};

const ORIGINS = {
  dono: { label: "Dono", dot: "bg-brand-accent", hint: "você disse ou confirmou" },
  observado: { label: "Observado", dot: "bg-green", hint: "aprendido com resultados" },
  vanda: { label: "Vanda", dot: "bg-border-strong", hint: "sugestão, muda quando quiser" },
} as const satisfies Record<
  NonNullable<BrandFactOrigin>,
  { label: string; dot: string; hint: string }
>;

const ORIGIN_ORDER = ["dono", "observado", "vanda"] as const;

const LEGACY_HEADING = "## Notas anteriores";

// Sections made only of short items (tone words, audiences) read better as chips.
const CHIP_MAX = 32;

type GuideItem = ReturnType<typeof brandFileFacts>[number] & ReturnType<typeof factOrigin>;

function OriginDot({ item }: { item: GuideItem }) {
  if (!item.origin) return null;

  const origin = ORIGINS[item.origin];

  return (
    <span
      className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", origin.dot)}
      role="img"
      aria-label={item.detail ? `${origin.label}: ${item.detail}` : origin.label}
      title={item.detail ? `${origin.label}: ${item.detail}` : origin.label}
    />
  );
}

function GuideSection({ title, items }: { title: string; items: readonly GuideItem[] }) {
  const chips = items.length > 0 && items.every((item) => item.text.length <= CHIP_MAX);

  return (
    <section className="rounded-lg border border-border bg-app p-4">
      <h3 className="text-body-sm font-semibold text-text">{title}</h3>
      {items.length === 0 ? <p className="mt-2 text-note text-text-5">Nada ainda.</p> : null}
      {chips ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="inline-flex items-start gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-note text-text-2"
            >
              <OriginDot item={item} />
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}
      {items.length > 0 && !chips ? (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex gap-2 text-body-sm leading-snug text-text-2">
              <OriginDot item={item} />
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The brand file laid out as a guide: one card per section, each item marked
 * with where it came from (a dot keyed in the legend) instead of the raw
 * "(dono)" suffix. Notes carried over from the old memory stay apart, folded.
 */
function BrandGuide({ content }: { content: string }) {
  const legacyAt = content.indexOf(`\n${LEGACY_HEADING}`);

  const items: GuideItem[] = brandFileFacts(
    legacyAt === -1 ? content : content.slice(0, legacyAt),
  ).map((fact) => Object.assign(fact, factOrigin(fact.text)));

  const known = BRAND_FILE_SECTIONS.map((section) => section.title);

  const extra = [...new Set(items.map((item) => item.kind))].filter(
    (kind) => !known.includes(kind),
  );

  const origins = ORIGIN_ORDER.filter((origin) => items.some((item) => item.origin === origin));

  return (
    <div className="space-y-4">
      {origins.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-note text-text-4">
          {origins.map((origin) => (
            <span key={origin} className="inline-flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", ORIGINS[origin].dot)} aria-hidden />
              <span className="font-medium text-text-3">{ORIGINS[origin].label}</span>
              {ORIGINS[origin].hint}
            </span>
          ))}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {[...known, ...extra].map((title) => (
          <GuideSection
            key={title}
            title={title}
            items={items.filter((item) => item.kind === title)}
          />
        ))}
      </div>

      {legacyAt === -1 ? null : (
        <details className="rounded-lg border border-border px-4 py-3">
          <summary className="cursor-pointer text-body-sm font-medium text-text-3">
            Notas anteriores
          </summary>
          <div className="mt-3">
            <Markdown variant="reading">
              {content.slice(legacyAt + LEGACY_HEADING.length + 1)}
            </Markdown>
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * The brand file: what both agents know about this business, one document the
 * owner reads and edits directly. Edits are revisions, like the agents' writes.
 */
export function BrandFileCard({ accountId }: { accountId: Id<"accounts"> }) {
  const { file, save } = useProfileRuntime().useBrandFile(accountId);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bytes = draft === null ? (file?.bytes ?? 0) : new TextEncoder().encode(draft).byteLength;
  const max = file?.maxBytes ?? 24_000;

  const submit = async () => {
    if (draft === null) return;
    setSaving(true);
    setError(null);

    try {
      await save(draft);
      setDraft(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Arquivo da marca"
      caption={file ? formatUpdated(file.updatedAt, file.updatedBy) : undefined}
      action={
        file === undefined ? null : draft === null ? (
          <Button variant="outline" size="sm" onClick={() => setDraft(file.content)}>
            Editar
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={saving} onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button size="sm" disabled={saving || bytes > max} onClick={() => void submit()}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        )
      }
    >
      {file === undefined ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-3.5 w-3/5" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-2/5" />
        </div>
      ) : draft === null ? (
        <BrandGuide content={file.content} />
      ) : (
        <>
          <textarea
            aria-label="Arquivo da marca"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck
            className="min-h-96 w-full resize-y rounded-lg border border-border bg-inset p-3.5 font-mono text-body-sm leading-relaxed text-text outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          />
          <p className={bytes > max ? "mt-2 text-xs text-destructive" : "mt-2 text-xs text-text-4"}>
            {Math.ceil(bytes / 1000)} de {Math.round(max / 1000)} KB. Marque o que vem de você com
            (dono): a Vanda não muda esses itens sem você pedir.
          </p>
        </>
      )}
      {error ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
    </SectionCard>
  );
}

/**
 * The Pomelli-style identity card: swatches with exact hexes, font previews,
 * tagline, rendered straight from /brand/kit.json: what's shown here is what
 * the image prompts use.
 */
export function BrandKitCard({ accountId }: { accountId: Id<"accounts"> }) {
  const file = useProfileRuntime().useWorkspaceFile(accountId, "/brand/kit.json");
  const text = file?.ok && file.file.kind === "text" ? file.file.text : null;
  const kit = text !== null ? parseBrandKit(text) : null;
  const empty = kit === null || (kit.colors.length === 0 && kit.fonts.length === 0 && !kit.tagline);

  return (
    <SectionCard
      title="Identidade visual"
      caption="As cores e fontes exatas que a Vanda usa nas artes."
    >
      {file === undefined ? (
        <div className="flex gap-3" aria-hidden>
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="size-14 rounded-full" />
        </div>
      ) : empty ? (
        <p className="text-body-sm leading-relaxed text-text-3">
          Nenhuma identidade registrada ainda. Diga na conversa algo como{" "}
          <em>"nossas cores são #d81b60 e #fdfcfb, e a fonte é Poppins"</em>, e a Vanda monta o kit.
        </p>
      ) : (
        <div className="space-y-6">
          {kit.colors.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {kit.colors.map((color) => (
                <div key={color.hex} className="overflow-hidden rounded-lg border border-border">
                  <span
                    aria-hidden
                    className="block h-24 w-full bg-(--swatch)"
                    style={
                      // SAFETY: React forwards CSS variables; this is the customer's color swatch, not UI chrome.
                      { "--swatch": color.hex } as CSSProperties
                    }
                  />
                  <div className="p-3">
                    <span className="font-mono text-xs text-text-2">{color.hex}</span>
                    {color.name || color.role ? (
                      <span className="mt-1 block truncate text-note text-text-3">
                        {color.name ?? color.role}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {kit.fonts.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {kit.fonts.map((font) => (
                <div
                  key={`${font.family}-${font.role ?? ""}`}
                  className="flex min-w-36 flex-col rounded-lg border border-border px-5 py-4"
                >
                  <span
                    aria-hidden
                    className="font-(family-name:--brand-font) text-3xl leading-tight text-text"
                    style={
                      // SAFETY: React forwards custom properties; CSSProperties omits their open-ended names.
                      {
                        "--brand-font": `"${font.family}", sans-serif`,
                      } as CSSProperties
                    }
                  >
                    Aa
                  </span>
                  <span className="mt-1 text-body-sm font-medium">{font.family}</span>
                  {font.role ? <span className="text-note text-text-4">{font.role}</span> : null}
                </div>
              ))}
            </div>
          ) : null}

          {kit.tagline ? (
            <p className="border-t border-border pt-5 text-xl leading-relaxed font-medium tracking-tight text-text-2">
              “{kit.tagline}”
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
