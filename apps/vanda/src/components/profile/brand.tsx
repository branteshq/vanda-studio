import { useState, type CSSProperties } from "react";
import { Ban } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Skeleton } from "@vanda-studio/ui/components/skeleton";
import type { FunctionReturnType } from "convex/server";
import type { BrandFileDesign } from "../../convex/brandFile";
import type { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { errorMessage } from "../../errors";
import { ProfileSection } from "./layout";
import { useProfileRuntime } from "./runtime";

const formatUpdated = (updatedAt: number | null, updatedBy: string | null): string => {
  if (updatedAt === null) return "Montado a partir do que a Vanda já sabia. Ainda não editado.";
  const who = updatedBy === "owner" ? "você" : "a Vanda";

  return `Atualizado por ${who} em ${new Date(updatedAt).toLocaleDateString("pt-BR")}.`;
};

// The Design section's identity labels, shown in the strip instead of the cards. Literals on
// purpose: importing brandFile.ts here would pull server code into the client bundle.
const DESIGN = "Design";

const NEVER = "Nunca fazer";

const IDENTITY_LABELS = new Set(["Paleta", "Logo", "Tipografia"]);

const IMAGE_LINKS = /!\[[^\]]*\]\(image:[^)\s]+\)/g;

/** What `api.brandFile.get` returns: the file, its outline and its design. */
export type BrandFileRead = FunctionReturnType<typeof api.brandFile.get>;

const hasIdentity = (design: BrandFileDesign): boolean =>
  Boolean(design.logoUrl) || design.palette.length > 0 || Boolean(design.typography);

/** Each section with the items the read view shows: image links and the identity labels are dropped. */
const visibleSections = (outline: BrandFileRead["outline"]) =>
  outline.map((section) => ({
    section,
    items: section.items
      .map((item) => ({ ...item, text: item.text.replace(IMAGE_LINKS, "").trim() }))
      .filter(
        (item) =>
          item.text !== "" &&
          !(section.title === DESIGN && item.label !== null && IDENTITY_LABELS.has(item.label)),
      ),
  }));

const originBadge = (origin: string): string => {
  if (origin.startsWith("dono")) return "Você";

  if (origin.startsWith("observado")) return "Observado";

  return "Sugestão da Vanda";
};

/** Logo, palette and typeface of the Design section, above the sections. */
function BrandIdentity({ design }: { design: BrandFileDesign }) {
  const { palette, typography, logoUrl } = design;

  if (!hasIdentity(design)) return null;

  // The first family of the typography line: "Gotham Narrow, Arial" to "Gotham Narrow".
  const font = typography
    .split(/[,;/(]/)[0]!
    .replace(/["']/g, "")
    .trim();

  return (
    <div className="mb-8 flex flex-wrap items-start gap-x-8 gap-y-5">
      {logoUrl ? (
        <div className="rounded-lg bg-inset p-3">
          <img src={logoUrl} alt="Logo" className="max-h-20 w-auto object-contain" />
        </div>
      ) : null}
      {palette.length > 0 ? (
        <div>
          <p className="text-caption tracking-wide text-text-4 uppercase">Paleta</p>
          <ul className="mt-2 flex flex-wrap gap-4">
            {palette.map((swatch) => (
              <li key={`${swatch.hex}-${swatch.name}`} className="w-20">
                <div
                  // SAFETY: React accepts custom properties at runtime; CSSProperties omits their open-ended names. The value is a hex matched by the server's swatch parser.
                  style={{ "--swatch": swatch.hex } as CSSProperties}
                  className="size-10 rounded-lg border border-border bg-(--swatch)"
                />
                <p className="mt-1.5 font-mono text-caption text-text-3">{swatch.hex}</p>
                {swatch.name ? <p className="text-caption text-text-2">{swatch.name}</p> : null}
                {swatch.role ? <p className="text-caption text-text-4">{swatch.role}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {typography ? (
        <div className="min-w-0">
          <p className="text-caption tracking-wide text-text-4 uppercase">Tipografia</p>
          <p
            // SAFETY: React accepts custom properties at runtime; CSSProperties omits their open-ended names. The value is a quoted family name.
            style={{ "--brand-font": `"${font}", var(--font-sans, sans-serif)` } as CSSProperties}
            className="mt-2 font-(family-name:--brand-font) text-body text-text"
          >
            {typography}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The brand file, read-only: the identity strip, then each filled section as a
 * title over its items. Empty sections share one line instead of repeating the
 * same empty state.
 */
function BrandFileView({ file }: { file: BrandFileRead }) {
  const sections = visibleSections(file.outline);
  const filled = sections.filter(({ items }) => items.length > 0);
  const empty = sections.filter(({ section }) => section.items.length === 0);

  return (
    <div className="pt-4">
      <BrandIdentity design={file.design} />
      <div className="space-y-7">
        {filled.map(({ section, items }) => (
          <section key={section.title} className="min-w-0">
            <h3 className="text-body font-medium">{section.title}</h3>
            <ul className="mt-2.5 space-y-2.5">
              {items.map((item) => (
                <li key={`${item.label ?? ""}:${item.text}`} className="min-w-0">
                  {item.label ? (
                    <p className="text-caption tracking-wide text-text-4 uppercase">{item.label}</p>
                  ) : null}
                  <p className="text-body text-text-2">
                    {section.title === NEVER ? (
                      <Ban aria-hidden className="mr-1 inline size-3.5 text-destructive" />
                    ) : null}
                    {item.text}
                    <span title={item.origin} className="ml-2 text-caption text-text-4">
                      {originBadge(item.origin)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {empty.length > 0 ? (
          <p className="text-body-sm text-text-4">
            Ainda vazio: {empty.map(({ section }) => section.title).join(", ")}. O Caetano pergunta
            no guia da marca.
          </p>
        ) : null}
      </div>
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
    <ProfileSection
      title="Arquivo da marca"
      caption={file ? formatUpdated(file.updatedAt, file.updatedBy) : undefined}
      action={
        file === undefined ? null : draft === null ? (
          <Button variant="subtle" size="sm" onClick={() => setDraft(file.content)}>
            Editar
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="subtle" size="sm" disabled={saving} onClick={() => setDraft(null)}>
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
        <BrandFileView file={file} />
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
        <p className="mt-3 text-body-sm text-destructive">
          {error}
        </p>
      ) : null}
    </ProfileSection>
  );
}
