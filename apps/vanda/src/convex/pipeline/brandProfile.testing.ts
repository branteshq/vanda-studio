import { CAETANO_HELLO } from "../brandProfile";
import type { BrandAnalysis } from "./brand";
import { stubLanguageModelLayer } from "./testLanguageModel";

/** Stub `LanguageModel` for the brand stage: `generateObject` returns `analyze(prompt)`. */
export const makeStubAnalyst = (analyze: (prompt: string) => BrandAnalysis) =>
  stubLanguageModelLayer(analyze);

/** A representative analysis (the Café Lumiar fixture from the product context). */
export const cafeLumiarAnalysis: BrandAnalysis = {
  identity: {
    text: "Café Lumiar — cafeteria pet-friendly em Pinheiros",
    evidence: "Do perfil e bio",
    confidence: 0.95,
  },
  summary: {
    text: "O Café Lumiar é uma cafeteria pet-friendly em Pinheiros, de tom acolhedor e informal. O público volta pelos cachorros, pelo café especial e pela sensação de bairro.",
    evidence: "Síntese de 18 posts e 40 comentários",
    confidence: 0.9,
  },
  kind: {
    value: "negocio",
    evidence: "Conta business de um lugar",
    confidence: 0.85,
  },
  location: {
    text: "Pinheiros, São Paulo",
    evidence: "Do perfil e bio",
    confidence: 0.9,
  },
  positioning: {
    text: "O café do bairro onde seu cachorro é bem-vindo",
    evidence: "Inferido de 9 posts",
    confidence: 0.5,
  },
  offers: {
    items: ["café especial coado", "combo de inverno"],
    evidence: "Citados em 6 posts",
    confidence: 0.6,
  },
  audience: {
    items: ["moradores de Pinheiros com cachorro"],
    evidence: "Inferido dos comentários",
    confidence: 0.4,
  },
  voice: {
    items: ["acolhedor", "informal", "local", "afetuoso com pets"],
    evidence: "Detectado em 18 posts",
    confidence: 0.9,
  },
  themes: {
    items: ["café especial", "inverno", "dogs", "clientes fiéis"],
    evidence: "Aparecem em 12 posts recentes",
    confidence: 0.6,
  },
  characters: {
    items: ["golden retriever", "baristas", "clientes com pets"],
    evidence: "Citados em 7 comentários",
    confidence: 0.4,
  },
  proof: {
    items: [],
    evidence: "Nada nos dados",
    confidence: 0,
  },
  restrictions: {
    items: ["evitar promessas médicas", "evitar temas políticos"],
    evidence: "Sugestão da Vanda",
    confidence: 0.3,
  },
  opportunities: {
    items: ["combo de inverno", "posts com cachorro", "bastidores"],
    evidence: "Baseado no que mais engaja",
    confidence: 0.6,
  },
  opener: `${CAETANO_HELLO} Vi que o combo de inverno faz sucesso por aí. Quanto ele custa?`,
};
