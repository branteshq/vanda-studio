import type * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { BrandCanonKind, BrandKind } from "./brand";

export interface BrandCanonEntry {
  readonly kind: BrandCanonKind;
  readonly text: string;
}

export interface BrandContextSnapshot {
  readonly locale: "pt-BR";
  readonly accountName?: string | undefined;
  readonly handle?: string | undefined;
  readonly brandKind?: BrandKind | undefined;
  readonly canon: ReadonlyArray<BrandCanonEntry>;
  readonly themes: ReadonlyArray<{ readonly name: string; readonly summary: string }>;
  readonly referenceImageUrls: ReadonlyArray<string>;
}

export interface BrandContextShape {
  readonly load: (accountId: string) => Effect.Effect<BrandContextSnapshot, Cause.UnknownError>;
}

export class BrandContext extends Context.Service<BrandContext, BrandContextShape>()(
  "@vanda/pipeline/BrandContext",
) {}

const labels: Record<BrandCanonKind, string> = {
  identity: "Identidade",
  positioning: "Posicionamento",
  audience: "Público",
  offer: "Oferta",
  differentiator: "Diferencial",
  proof: "Prova",
  voice: "Voz",
  character: "Personagem",
  objective: "Objetivo",
  location: "Localização",
  restriction: "Restrição obrigatória",
  forbidden_claim: "Afirmação proibida",
  summary: "Resumo",
};

/** Critical, owner-confirmed context is always injected instead of being retrieval-dependent. */
export const renderBrandContext = (brand: BrandContextSnapshot): string => {
  const header = [
    brand.accountName ? `Marca: ${brand.accountName}` : null,
    brand.handle ? `Instagram: @${brand.handle}` : null,
    brand.brandKind ? `Tipo: ${brand.brandKind}` : null,
    `Idioma: ${brand.locale}`,
  ].filter((line): line is string => line !== null);
  const canon = brand.canon.map((entry) => `${labels[entry.kind]}: ${entry.text}`);
  return [...header, ...canon].join("\n");
};
