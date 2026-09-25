import type { EvalCase } from "./fixtures";

// Fixed copy separates rendering quality from copywriting ability. All brands are fictional.
export const imageBenchmarkCases: (EvalCase & { slides: number })[] = [
  {
    id: "bench-reparos",
    brandId: "prumo-reparos",
    kind: "creative",
    slides: 3,
    prompt:
      'Crie um carrossel educativo de 3 slides 4:5 para um autônomo de reparos. Texto exato, uma ocorrência por slide: 1: "Prateleira firme começa antes do furo" / "3 cuidados antes de instalar". 2: "Parede, bucha e peso" / "Identifique o tipo de parede." / "Escolha a fixação adequada." / "Considere o peso dos objetos.". 3: "Prefere ajuda?" / "Visita de diagnóstico: R$ 80" / "Valor abatido do serviço aprovado." / "Chame a Prumo para avaliar". Inclua Prumo Reparos em todos. Diagramas úteis, sem instruções perigosas ou promessas extras.',
    expectations: [
      "3 slides, copy exata, diagrama útil, legível no celular, identidade consistente",
    ],
  },
  {
    id: "bench-cafe",
    brandId: "cafe-caju",
    kind: "creative",
    slides: 1,
    prompt:
      'Crie uma peça de feed 4:5 fotográfica e acolhedora com coado e pão de queijo. Texto exato: "Café Caju" / "Sua pausa da manhã" / "Coado + pão de queijo" / "R$ 16" / "Terça a domingo · 8h às 18h". Cada trecho uma vez. Sem promoção inventada, entrega ou reservas. Preço visível no celular.',
    expectations: ["Foto atraente, preço e horário exatos, hierarquia clara"],
  },
  {
    id: "bench-cosmeticos",
    brandId: "orvalho-botanica",
    kind: "creative",
    slides: 3,
    prompt:
      'Crie carrossel 4:5 de 3 slides, editorial de cosméticos. Texto exato: 1: "Orvalho Botânica" / "Cuidado que cabe no dia.". 2: "Óleo Facial Sereno" / "30 ml · R$ 68" / "Vegano. Não testado em animais.". 3: "Sabonete Nuvem" / "90 g · R$ 24" / "Conheça a Orvalho Botânica". Frasco âmbar com rótulo creme consistente. Não invente modo de uso, benefícios, certificações ou claims clínicos. Cada trecho uma vez no slide indicado.',
    expectations: ["3 slides coerentes, embalagem consistente, nenhuma alegação inventada"],
  },
  {
    id: "bench-papelaria",
    brandId: "pimba-papelaria",
    kind: "creative",
    slides: 3,
    prompt:
      'Crie carrossel 4:5 de 3 slides gráfico e ousado, para vender sem cara de template genérico. Texto exato: 1: "Pimba! Papelaria" / "Menos drama. Mais ideia.". 2: "Planner Sem Drama" / "R$ 49" / "Capa roxa. Espiral verde.". 3: "Kit Rabisco" / "3 canetas: rosa, roxa e verde" / "R$ 32" / "Bora rabiscar?". Cada trecho uma vez. Ilustre exatamente os produtos descritos, preserve a identidade entre slides, não invente frete grátis.',
    expectations: ["3 slides com energia visual, acentos, produtos e preços corretos"],
  },
  {
    id: "bench-texto-denso",
    brandId: "prumo-reparos",
    kind: "creative",
    slides: 1,
    prompt:
      'Crie card 4:5 de serviços de autônomo, denso mas realmente legível num celular. Texto exato, sem abreviar nem duplicar: "Prumo Reparos" / "O que podemos resolver?" / "Montagem de móveis" / "Instalação de prateleiras" / "Pequenos reparos hidráulicos" / "Não fazemos serviços de gás, obras estruturais ou intervenções no quadro elétrico." / "São Paulo · Segunda a sexta · 9h às 17h" / "Diagnóstico: R$ 80, abatidos do serviço aprovado." / "Chame a Prumo para avaliar". Use hierarquia, espaço e ícones pertinentes; não esconda exclusões em letras minúsculas.',
    expectations: ["Texto completo, exclusões legíveis, acentos e números corretos"],
  },
  {
    id: "bench-revisao",
    brandId: "pimba-papelaria",
    kind: "revision",
    slides: 1,
    referenceId: "pimba-kit-revision",
    prompt:
      "Na imagem anexada, mude apenas o fundo para #FFF4D6. Preserve exatamente os textos, preço, posição, tamanho, cores e forma das três canetas, inclusive a roxa. Não redesenhe a peça. Entregue a imagem revisada, não publique.",
    expectations: ["Só o fundo muda; caneta roxa e texto preservados, contraste suficiente"],
  },
];

export const benchmarkMethods = {
  template:
    "Experimento controlado: use os templates reais de /skills/post-instagram-template. Leia o SKILL.md, escolha e leia o script adequado e adapte-o. Componha TODO texto e layout final por run_code/Pillow. Pode usar paint apenas para ativos visuais sem texto se necessário, nunca para a peça completa. Preserve a qualidade do template e adapte paleta, fontes e espaçamento ao conteúdo. Para revisão, use Python para alterar só a região autorizada.",
  raw: "Experimento controlado: use paint para TODA a composição final, inclusive tipografia, preços e marca; não use run_code, SVG ou overlays para criar ou corrigir pixels. Faça uma imagem por slide. Escreva prompts como especificações de arte: objetivo, hierarquia visual, direção artística, texto exato entre aspas, uma ocorrência por trecho, sem texto extra. Para carrosséis, use o primeiro slide como referência de identidade nos seguintes, explicitando que é referência de estilo, não de conteúdo. Para revisões, use a imagem fornecida como referência e nomeie o que muda e tudo que deve permanecer. Inspecione o resultado, corrigindo defeitos concretos no máximo duas vezes. Não aceite texto ilegível só porque a arte é bonita.",
};
