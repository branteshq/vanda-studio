import { v } from "convex/values";

/**
 * Post purpose — why a post exists, orthogonal to its format (`posts.type`).
 * Each id has an entry in the post skill's purposes.md.
 */
export const postPurposes = [
  "institucional",
  "educacional",
  "informativo",
  "produto",
  "promocional",
  "prova_social",
  "editorial",
  "storytelling",
  "bastidores",
  "comunidade",
  "anuncio",
  "dados",
  "expressao_cultural",
  "employer_branding",
] as const;

export type PostPurpose = (typeof postPurposes)[number];

export const postPurposeValidator = v.union(...postPurposes.map((purpose) => v.literal(purpose)));
