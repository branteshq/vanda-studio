import type { EvalCase } from "./fixtures";

/**
 * Skill coverage benchmark: every post type (image, carousel, infinite carousel,
 * story) and every post purpose skill, on the four fictional brands, with real
 * image generation. Prompts state the facts a post needs, so a missing fact is
 * the agent's fault, not the fixture's. `repeats` runs a case several times to
 * see whether quality holds from one run to the next.
 */
export interface SkillCase extends EvalCase {
  readonly type: "image" | "carousel" | "story";
  /** The type skill the agent should load (infinite carousel is a carousel with its own skill). */
  readonly typeSkill:
    | "post-type-image"
    | "post-type-carousel"
    | "post-type-infinite-carousel"
    | "post-type-story";
  readonly purpose: string;
  readonly repeats?: number;
}

const creative = (entry: Omit<SkillCase, "kind" | "expectations"> & { expectations?: string[] }) =>
  ({ kind: "creative", expectations: [], ...entry }) satisfies SkillCase;

export const skillCases: readonly SkillCase[] = [
  creative({
    id: "skill-image-promocional",
    brandId: "cafe-caju",
    type: "image",
    typeSkill: "post-type-image",
    purpose: "promocional",
    repeats: 2,
    prompt:
      "Faz um post de uma imagem só divulgando o combo da manhã (coado + pão de queijo por R$ 16), válido de terça a sexta.",
  }),
  creative({
    id: "skill-image-anuncio",
    brandId: "pimba-papelaria",
    type: "image",
    typeSkill: "post-type-image",
    purpose: "anuncio",
    prompt:
      "Cria um post de uma imagem anunciando que a nova linha de planners 2027 chega à loja neste sábado.",
  }),
  creative({
    id: "skill-image-produto",
    brandId: "orvalho-botanica",
    type: "image",
    typeSkill: "post-type-image",
    purpose: "produto",
    prompt:
      "Quero um post de uma imagem apresentando o Óleo Facial Sereno (30 ml, R$ 68): o produto em destaque e como ele entra na rotina da noite.",
  }),
  creative({
    id: "skill-image-prova-social",
    brandId: "prumo-reparos",
    type: "image",
    typeSkill: "post-type-image",
    purpose: "prova_social",
    prompt:
      'Faz um post de uma imagem com este depoimento real de cliente: "Resolveram a infiltração do banheiro em um dia e deixaram tudo limpo." — Marta, Boa Viagem.',
  }),
  creative({
    id: "skill-image-expressao-cultural",
    brandId: "cafe-caju",
    type: "image",
    typeSkill: "post-type-image",
    purpose: "expressao_cultural",
    prompt: "Faz um post de uma imagem celebrando o São João aqui no Recife, sem vender nada.",
  }),
  creative({
    id: "skill-carousel-educacional",
    brandId: "prumo-reparos",
    type: "carousel",
    typeSkill: "post-type-carousel",
    purpose: "educacional",
    repeats: 2,
    prompt:
      "Cria um carrossel de 4 slides ensinando 3 sinais de infiltração que o morador consegue ver sozinho, fechando com quando chamar um profissional.",
  }),
  creative({
    id: "skill-carousel-informativo",
    brandId: "cafe-caju",
    type: "carousel",
    typeSkill: "post-type-carousel",
    purpose: "informativo",
    prompt:
      "Faz um carrossel de 3 slides avisando o horário do feriado: dia 15 abrimos das 9h às 14h, e lembrando que não fazemos entrega nem reserva.",
  }),
  creative({
    id: "skill-carousel-dados",
    brandId: "orvalho-botanica",
    type: "carousel",
    typeSkill: "post-type-carousel",
    purpose: "dados",
    prompt:
      "Monta um carrossel de 3 slides com o resultado da nossa enquete com 212 clientes: 64% usam o óleo à noite, 23% de manhã e 13% nos dois.",
  }),
  creative({
    id: "skill-carousel-storytelling",
    brandId: "pimba-papelaria",
    type: "carousel",
    typeSkill: "post-type-carousel",
    purpose: "storytelling",
    prompt:
      "Conta num carrossel de 4 slides como a Pimba começou: uma mesa de feira em 2019, os primeiros cadernos costurados à mão e a loja própria de hoje.",
  }),
  creative({
    id: "skill-carousel-bastidores",
    brandId: "cafe-caju",
    type: "carousel",
    typeSkill: "post-type-carousel",
    purpose: "bastidores",
    prompt:
      "Faz um carrossel de 3 slides mostrando os bastidores da nossa torra de sexta de manhã.",
  }),
  creative({
    id: "skill-carousel-institucional",
    brandId: "prumo-reparos",
    type: "carousel",
    typeSkill: "post-type-carousel",
    purpose: "institucional",
    prompt:
      "Cria um carrossel de 3 slides apresentando quem é a Prumo: o que fazemos, onde atendemos e o nosso jeito de trabalhar.",
  }),
  creative({
    id: "skill-carousel-employer-branding",
    brandId: "prumo-reparos",
    type: "carousel",
    typeSkill: "post-type-carousel",
    purpose: "employer_branding",
    prompt:
      "Estamos contratando técnico de manutenção predial. Faz um carrossel de 3 slides sobre como é trabalhar na Prumo e como se candidatar pelo direct.",
  }),
  creative({
    id: "skill-story-comunidade",
    brandId: "cafe-caju",
    type: "story",
    typeSkill: "post-type-story",
    purpose: "comunidade",
    prompt:
      "Faz um story chamando o pessoal pra votar: coado ou espresso, qual é o café da sua manhã?",
  }),
  creative({
    id: "skill-story-editorial",
    brandId: "orvalho-botanica",
    type: "story",
    typeSkill: "post-type-story",
    purpose: "editorial",
    prompt:
      "Cria um story com uma dica editorial: como simplificar a rotina de cuidados no inverno.",
  }),
  creative({
    id: "skill-infinite-educacional",
    brandId: "prumo-reparos",
    type: "carousel",
    typeSkill: "post-type-infinite-carousel",
    purpose: "educacional",
    repeats: 3,
    prompt:
      "Preciso de um carrossel infinito de 4 slides sobre como evitar mofo no apartamento, com um cenário contínuo de um cômodo para o outro.",
  }),
  creative({
    id: "skill-infinite-produto",
    brandId: "pimba-papelaria",
    type: "carousel",
    typeSkill: "post-type-infinite-carousel",
    purpose: "produto",
    repeats: 3,
    prompt:
      "Faz um carrossel infinito de 4 slides mostrando a nova linha de planners numa mesa contínua, um planner atravessando cada corte.",
  }),
  creative({
    id: "skill-infinite-storytelling",
    brandId: "cafe-caju",
    type: "carousel",
    typeSkill: "post-type-infinite-carousel",
    purpose: "storytelling",
    repeats: 3,
    prompt:
      "Cria um carrossel infinito de 4 slides contando uma manhã na varanda do Caju, do primeiro coado ao movimento do meio-dia, em uma cena contínua.",
  }),
];

/** Each case once per repeat, as distinct ids: skill-x, skill-x-r2, skill-x-r3. */
export const expandedSkillCases = (): SkillCase[] =>
  skillCases.flatMap((entry) =>
    Array.from({ length: entry.repeats ?? 1 }, (_, index) =>
      index === 0 ? entry : { ...entry, id: `${entry.id}-r${index + 1}` },
    ),
  );

export const skillCaseFor = (id: string): SkillCase | undefined =>
  skillCases.find((entry) => id === entry.id || id.startsWith(`${entry.id}-r`));
