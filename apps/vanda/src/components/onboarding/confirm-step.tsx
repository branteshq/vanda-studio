import { type ReactNode, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { ArrowRight, Plus, X } from "lucide-react";
import { Button } from "@vanda-studio/ui/components/button";
import { Input } from "@vanda-studio/ui/components/input";
import { ActionTooltip } from "@vanda-studio/ui/components/tooltip";
import { cn } from "@vanda-studio/ui/lib/utils";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { OnboardingHeader, StepIndicator } from "./onboarding-shell";
import type { BrandKindValue, CorpusStats, EditableAnalysis, GroupKey } from "./types";

// --- Field scaffold --------------------------------------------------------

/**
 * A single editable row: a quiet label, then the control. The whole step is just
 * a stack of these separated by hairlines — dense but calm, Linear-style. No
 * confidence dots, no evidence lines, no helper noise: the control is the field.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5 border-t border-border pt-5">
      <span className="text-[13px] font-medium text-text-2">{label}</span>
      <div className="mt-2">{children}</div>
    </div>
  );
}

// --- Editable chips --------------------------------------------------------

function ChipEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");

  function commit() {
    const next = value.trim();
    if (next.length > 0 && !items.includes(next)) onChange([...items, next]);
    setValue("");
    setAdding(false);
  }

  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-inset px-2.5 py-1 text-[13px] text-text-2"
        >
          {item}
          <ActionTooltip label={`Remover ${item}`} side="top">
            <button
              type="button"
              aria-label={`Remover ${item}`}
              className="rounded-sm text-text-5 transition-colors hover:text-text-3 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              onClick={() => onChange(items.filter((i) => i !== item))}
            >
              <X className="size-3" />
            </button>
          </ActionTooltip>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={value}
          aria-label={`Adicionar a ${label}`}
          placeholder="adicionar…"
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              setValue("");
              setAdding(false);
            }
          }}
          className="h-[28px] w-28 rounded-md border border-border-strong bg-transparent px-2 text-[13px] text-text-2 transition-colors outline-none placeholder:text-text-5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border-strong px-2.5 py-1 text-[13px] text-text-4 transition-colors hover:text-text-2 focus-visible:text-text-2 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Plus className="size-3" /> adicionar
        </button>
      )}
    </div>
  );
}

// --- Tipo de marca + reference photos -------------------------------------

function KindOption({
  name,
  value,
  label,
  desc,
  selected,
  onSelect,
}: {
  name: string;
  value: BrandKindValue;
  label: string;
  desc: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "cursor-pointer rounded-xl border px-3.5 py-2.5 transition-colors duration-150 ease-[var(--ease-out)]",
        "border-border bg-surface hover:border-border-strong",
        "has-[:checked]:border-brand-accent has-[:checked]:bg-brand-accent/10",
        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      <span className="block text-[13.5px] font-medium text-text">{label}</span>
      <span className="mt-0.5 block text-[12.5px] text-text-4">{desc}</span>
    </label>
  );
}

function ReferencePhotos({ accountId }: { accountId: Id<"accounts"> }) {
  const photos = useQuery(api.brandProfile.listReferencePhotos, { accountId });
  const generateUploadUrl = useMutation(api.brandProfile.generateUploadUrl);
  const addReferencePhoto = useMutation(api.brandProfile.addReferencePhoto);
  const removeReferencePhoto = useMutation(api.brandProfile.removeReferencePhoto);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const url = await generateUploadUrl();
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error(`upload failed: ${res.status}`);
        const { storageId } = (await res.json()) as { storageId?: Id<"_storage"> };
        if (!storageId) throw new Error("upload returned no storageId");
        await addReferencePhoto({ accountId, storageId });
      }
    } catch {
      setError("Não consegui enviar a foto. Tente de novo.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-inset p-4">
      <p className="text-[13px] text-text-2">Envie algumas fotos suas</p>
      <p className="mt-0.5 text-[12.5px] leading-[1.5] text-text-4">
        A Vanda usa pra criar posts com você — adicionar depois também funciona.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {photos?.map((photo) => (
          <div
            key={photo.id}
            className="group/photo relative size-16 overflow-hidden rounded-lg border border-border bg-surface"
          >
            {photo.url ? <img src={photo.url} alt="" className="size-full object-cover" /> : null}
            <ActionTooltip label="Remover foto" side="top">
              <button
                type="button"
                aria-label="Remover foto"
                onClick={() => void removeReferencePhoto({ imageId: photo.id })}
                className="absolute top-1 right-1 rounded-full bg-app/70 p-0.5 text-text-3 opacity-0 transition-opacity group-hover/photo:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <X className="size-3" />
              </button>
            </ActionTooltip>
          </div>
        ))}
        <ActionTooltip label="Adicionar fotos de referência" side="top">
          <button
            type="button"
            disabled={uploading}
            aria-label="Adicionar fotos de referência"
            onClick={() => inputRef.current?.click()}
            className="flex size-16 items-center justify-center rounded-lg border border-dashed border-border-strong text-text-4 transition-colors hover:text-text-2 focus-visible:text-text-2 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
          >
            <Plus className="size-4" />
          </button>
        </ActionTooltip>
      </div>
      {error ? <p className="mt-2 text-[12.5px] text-amber">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => void onFiles(event.target.files)}
      />
    </div>
  );
}

// --- The step --------------------------------------------------------------

/**
 * Step 3 — Vanda shows what she understood. A calm, single-column form: a short
 * intro, the summary as an obvious input, then each fact as a plain labeled
 * field. Confidence/evidence stay in the data (the schema validates them) but
 * aren't shown — they're signal for Vanda, not chrome for the owner. Everything
 * is held client-side and committed at "Começar" (step 4).
 */
export function ConfirmStep({
  accountId,
  analysis,
  stats,
  onContinue,
}: {
  accountId: Id<"accounts">;
  analysis: EditableAnalysis;
  stats: CorpusStats;
  onContinue: (edited: EditableAnalysis) => void;
}) {
  const [draft, setDraft] = useState<EditableAnalysis>(analysis);

  const setText = (key: "identity" | "summary", text: string) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], text } }));
  const setGroup = (key: GroupKey, items: string[]) =>
    setDraft((d) => ({ ...d, [key]: { ...d[key], items } }));
  const setKind = (value: BrandKindValue) =>
    setDraft((d) => ({ ...d, kind: { ...d.kind, value } }));

  return (
    <div className="flex min-h-svh flex-col bg-app text-text antialiased">
      <header className="mx-auto flex w-full max-w-[680px] items-center justify-between gap-4 px-6 pt-9">
        <OnboardingHeader />
        <StepIndicator current="confirmar" />
      </header>

      <div className="mx-auto w-full max-w-[680px] flex-1 overflow-y-auto px-6 pt-10 pb-12">
        <h1 className="text-[26px] font-semibold tracking-[-0.025em]">
          Confirme o que a Vanda entendeu.
        </h1>
        <p className="mt-2 text-[14px] leading-[1.55] text-text-3">
          A Vanda leu {stats.posts} posts, {stats.comments} comentários e {stats.mentions} menções.
          Ajuste o que precisar — o resto você refine depois no Perfil.
        </p>

        {/* Resumo — the hero, as an obvious input */}
        <div className="mt-7 border-t border-border pt-5">
          <span className="text-[13px] font-medium text-text-2">Resumo</span>
          <textarea
            value={draft.summary.text}
            rows={5}
            aria-label="Resumo"
            onChange={(event) => setText("summary", event.target.value)}
            className="mt-2 w-full resize-y rounded-lg border border-border bg-inset px-3.5 py-3 text-[17px] leading-[1.6] text-text-2 outline-none transition-colors duration-150 ease-[var(--ease-out)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          />
        </div>

        <Field label="Identidade">
          <Input
            aria-label="Identidade"
            value={draft.identity.text}
            onChange={(event) => setText("identity", event.target.value)}
            className="h-10 border-border bg-inset px-3.5 text-[15px] text-text-2 md:text-[15px] dark:bg-inset focus-visible:ring-ring/30"
          />
        </Field>

        <Field label="Tom de voz">
          <ChipEditor
            label="Tom de voz"
            items={draft.voice.items}
            onChange={(items) => setGroup("voice", items)}
          />
        </Field>

        <div className="mt-5 border-t border-border pt-5">
          <span className="text-[13px] font-medium text-text-2">Tipo de marca</span>
          <div
            className="mt-2 grid grid-cols-2 gap-2.5"
            role="radiogroup"
            aria-label="Tipo de marca"
          >
            <KindOption
              name="brand-kind"
              value="negocio"
              label="Negócio"
              desc="Um lugar ou produto"
              selected={draft.kind.value === "negocio"}
              onSelect={() => setKind("negocio")}
            />
            <KindOption
              name="brand-kind"
              value="pessoal"
              label="Pessoal"
              desc="Você é a marca"
              selected={draft.kind.value === "pessoal"}
              onSelect={() => setKind("pessoal")}
            />
          </div>
          {draft.kind.value === "pessoal" ? <ReferencePhotos accountId={accountId} /> : null}
        </div>

        <Field label="Temas recorrentes">
          <ChipEditor
            label="Temas recorrentes"
            items={draft.themes.items}
            onChange={(items) => setGroup("themes", items)}
          />
        </Field>

        <Field label="Personagens">
          <ChipEditor
            label="Personagens"
            items={draft.characters.items}
            onChange={(items) => setGroup("characters", items)}
          />
        </Field>

        <Field label="Restrições">
          <ChipEditor
            label="Restrições"
            items={draft.restrictions.items}
            onChange={(items) => setGroup("restrictions", items)}
          />
        </Field>
      </div>

      <div className="shrink-0 border-t border-border bg-app">
        <div className="mx-auto flex w-full max-w-[680px] items-center gap-4 px-6 py-4">
          <Button variant="brand" size="lg" onClick={() => onContinue(draft)}>
            Continuar
            <ArrowRight />
          </Button>
          <span className="text-[13px] text-text-4">Ajuste o resto depois, no Perfil.</span>
        </div>
      </div>
    </div>
  );
}
