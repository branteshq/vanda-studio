import { useMutation } from "convex/react";
import { useState } from "react";
import { Bookmark, BookmarkX, ChevronDown } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@vanda-studio/ui/components/dropdown-menu";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { GalleryReference } from "../convex/gallery";
import {
  referenceLabelNames,
  referenceLabels,
  type ReferenceLabel,
} from "../convex/pipeline/constants";

/**
 * References in the UI: a reference is a gallery image with labels saying what
 * Vanda and Caetano take from it. The gallery shows and edits them; Perfil only
 * summarizes. No chat components: most of the conversation happens in WhatsApp.
 */

export type ReferenceCounts = Partial<Record<ReferenceLabel, number>>;

/** What each label tells the owner, in one line (menu hints and tooltips). */
export const referenceLabelHints: Record<ReferenceLabel, string> = {
  layout: "a grade do feed: onde ficam foto, título e assinatura",
  style: "cores, luz, letras e acabamento",
  face: "você ou sua equipe, para aparecer nos posts",
  product: "o produto como ele é",
  place: "o seu espaço",
  logo: "a sua marca gráfica",
  avoid: "o que nunca fazer",
};

const AUTHOR_NAMES: Record<NonNullable<GalleryReference["addedBy"]>, string> = {
  owner: "você",
  vanda: "a Vanda",
  caetano: "o Caetano",
};

/** "Layout" or "Layout +1": the tile tag. */
export function referenceTagText(labels: readonly ReferenceLabel[]): string {
  const [first, ...rest] = labels;

  if (!first) return "Referência";

  return rest.length > 0
    ? `${referenceLabelNames[first]} +${rest.length}`
    : referenceLabelNames[first];
}

/** The chip row above the references grid: Todas plus each label in use. */
export function ReferenceLabelFilter({
  counts,
  total,
  value,
  onChange,
}: {
  counts: ReferenceCounts;
  total: number;
  value: ReferenceLabel | "all";
  onChange: (value: ReferenceLabel | "all") => void;
}) {
  const used = referenceLabels.filter((label) => (counts[label] ?? 0) > 0);

  return (
    <div role="toolbar" aria-label="Filtrar por rótulo" className="flex flex-wrap gap-1.5 pb-4">
      <LabelChip pressed={value === "all"} onClick={() => onChange("all")}>
        Todas <span className="tabular-nums text-text-4">{total}</span>
      </LabelChip>
      {used.map((label) => (
        <LabelChip
          key={label}
          pressed={value === label}
          avoid={label === "avoid"}
          onClick={() => onChange(value === label ? "all" : label)}
        >
          {referenceLabelNames[label]}{" "}
          <span className="tabular-nums text-text-4">{counts[label]}</span>
        </LabelChip>
      ))}
    </div>
  );
}

function LabelChip({
  pressed,
  avoid = false,
  onClick,
  title,
  children,
}: {
  pressed: boolean;
  avoid?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-body-sm font-medium outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-brand-accent/60",
        pressed
          ? avoid
            ? "bg-destructive/12 text-destructive"
            : "bg-brand-accent/12 text-brand-accent"
          : "bg-inset text-text-3 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

/** "Marcar como referência ▾": one click per label, for the selection bar. */
export function MarkReferenceMenu({
  disabled,
  onMark,
}: {
  disabled?: boolean;
  onMark: (label: ReferenceLabel) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="secondary" size="sm" disabled={disabled}>
            <Bookmark className="size-3.5" />
            Marcar como referência
            <ChevronDown className="size-3.5 text-text-4" />
          </Button>
        }
      />
      <DropdownMenuContent side="top" align="center" className="w-72">
        <DropdownMenuLabel>Para a Vanda e o Caetano usarem como</DropdownMenuLabel>
        {referenceLabels.map((label) => (
          <DropdownMenuItem key={label} onClick={() => onMark(label)}>
            <span className="flex min-w-0 flex-col">
              <span className={cn("font-medium", label === "avoid" && "text-destructive")}>
                {referenceLabelNames[label]}
              </span>
              <span className="text-note text-text-4">{referenceLabelHints[label]}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The reference part of the image viewer: labels to toggle, the note Vanda
 * reads, where it came from, and a way out that keeps the image.
 */
export function ReferenceSection({
  accountId,
  imageId,
  reference,
}: {
  accountId: Id<"accounts">;
  imageId: Id<"images">;
  reference: GalleryReference | null;
}) {
  const setReference = useMutation(api.gallery.setReference);

  if (!reference) {
    return (
      <div>
        <p className="section-label mb-1.5 text-text-2">Referência</p>
        <p className="mb-2 text-body-sm text-text-4">
          Marque para a Vanda e o Caetano seguirem esta imagem nos próximos posts.
        </p>
        <MarkReferenceMenu
          onMark={(label) => void setReference({ accountId, imageId, labels: [label] })}
        />
      </div>
    );
  }

  const toggle = (label: ReferenceLabel) => {
    const labels = reference.labels.includes(label)
      ? reference.labels.filter((current) => current !== label)
      : [...reference.labels, label];

    // The last label stays: taking it out is the explicit button below.
    if (labels.length > 0) void setReference({ accountId, imageId, labels });
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="section-label mb-1.5 text-text-2">Referência para</p>
        <div className="flex flex-wrap gap-1.5">
          {referenceLabels.map((label) => (
            <LabelChip
              key={label}
              pressed={reference.labels.includes(label)}
              avoid={label === "avoid"}
              title={referenceLabelHints[label]}
              onClick={() => toggle(label)}
            >
              {referenceLabelNames[label]}
            </LabelChip>
          ))}
        </div>
      </div>

      <ReferenceNote
        key={imageId}
        note={reference.note}
        onSave={(note) => void setReference({ accountId, imageId, labels: reference.labels, note })}
      />

      <p className="text-note text-text-4">
        Guardada por {reference.addedBy ? AUTHOR_NAMES[reference.addedBy] : "você"}
        {reference.source && reference.source !== "galeria" ? ` · de ${reference.source}` : ""}
        {reference.useCount > 0
          ? ` · usada em ${reference.useCount} ${reference.useCount === 1 ? "imagem" : "imagens"}`
          : ""}
      </p>

      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={() => void setReference({ accountId, imageId, labels: [] })}
      >
        <BookmarkX className="size-3.5" />
        Tirar das referências
      </Button>
    </div>
  );
}

function ReferenceNote({ note, onSave }: { note: string | null; onSave: (note: string) => void }) {
  const [draft, setDraft] = useState(note ?? "");

  const commit = () => {
    if (draft.trim() !== (note ?? "")) onSave(draft);
  };

  return (
    <label className="block">
      <span className="section-label mb-1 block text-text-2">O que tirar dela</span>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        rows={3}
        maxLength={400}
        placeholder="Ex.: foto minha à direita, arco rosa atrás, título branco em caixa alta"
        className="w-full resize-none rounded-lg bg-muted p-2.5 text-body-sm text-text-2 outline-none placeholder:text-text-4 focus:ring-1 focus:ring-border-strong"
      />
    </label>
  );
}
