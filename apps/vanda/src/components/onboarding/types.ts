/**
 * The onboarding wizard holds the analysis client-side across the Confirm and Mode
 * steps, then commits it with `approveBrandProfile`. `analyzeAccount` returns the
 * analysis as deeply-readonly (Schema-derived); `toEditable` clones it into the
 * mutable working shape the Confirm step edits and the approve mutation accepts.
 */

export type BrandKindValue = "negocio" | "pessoal";

// --- Readonly (as returned by analyzeAccount) -----------------------------

export interface ReadonlyText {
  readonly text: string;
  readonly evidence: string;
  readonly confidence: number;
}

export interface ReadonlyGroup {
  readonly items: readonly string[];
  readonly evidence: string;
  readonly confidence: number;
}

export interface ReadonlyKind {
  readonly value: BrandKindValue;
  readonly evidence: string;
  readonly confidence: number;
}

export interface ReadonlyAnalysis {
  readonly identity: ReadonlyText;
  readonly summary: ReadonlyText;
  readonly kind: ReadonlyKind;
  readonly voice: ReadonlyGroup;
  readonly themes: ReadonlyGroup;
  readonly characters: ReadonlyGroup;
  readonly restrictions: ReadonlyGroup;
  readonly opportunities: ReadonlyGroup;
}

export interface CorpusStats {
  readonly posts: number;
  readonly comments: number;
  readonly mentions: number;
}

// --- Editable working copy (the Confirm step + approve args) ---------------

export interface EditableText {
  text: string;
  evidence: string;
  confidence: number;
}

export interface EditableGroup {
  items: string[];
  evidence: string;
  confidence: number;
}

export interface EditableKind {
  value: BrandKindValue;
  evidence: string;
  confidence: number;
}

export interface EditableAnalysis {
  identity: EditableText;
  summary: EditableText;
  kind: EditableKind;
  voice: EditableGroup;
  themes: EditableGroup;
  characters: EditableGroup;
  restrictions: EditableGroup;
  opportunities: EditableGroup;
}

/** The multi-value groups the Confirm step edits as chips. */
export type GroupKey = "voice" | "themes" | "characters" | "restrictions";

/** Clone one readonly group into its mutable working copy (shared by `toEditable`). */
const cloneGroup = (g: ReadonlyGroup): EditableGroup => ({
  items: [...g.items],
  evidence: g.evidence,
  confidence: g.confidence,
});

/** Deep-clone the readonly analysis into the mutable working copy. */
export function toEditable(a: ReadonlyAnalysis): EditableAnalysis {
  return {
    identity: { ...a.identity },
    summary: { ...a.summary },
    kind: { ...a.kind },
    voice: cloneGroup(a.voice),
    themes: cloneGroup(a.themes),
    characters: cloneGroup(a.characters),
    restrictions: cloneGroup(a.restrictions),
    opportunities: cloneGroup(a.opportunities),
  };
}
