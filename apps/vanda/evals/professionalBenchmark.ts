import type { EvalBrand, EvalCase } from "./fixtures";

const direction = `Crie um carrossel de EXATAMENTE 2 slides verticais 4:5, apenas com paint, incluindo todo texto e diagrama nos pixels gerados. NÃO use Python, run_code, HTML, SVG, templates ou overlays. Entregue um rascunho, não publique.
As duas imagens anexadas são referências de DIREÇÃO DE ARTE, não de identidade: referência 1 = retrato editorial dominante, degradê escuro na base, manchete serifada branca, texto de apoio e rodapé preciso; referência 2 = página clara, diagrama educativo 2×2, linhas finas, manchete e parágrafo. Use o ritmo, refinamento e densidade das referências, não copie a pessoa, o nome, a logomarca ou textos delas.
Gere uma pessoa inteiramente fictícia conforme o briefing. Use a marca escrita, sem inventar selo ou registro profissional. Fundo opaco em ambos os slides; não gere recortes transparentes. Títulos serifados elegantes, corpo sans-serif, margens amplas, acentos corretos, contraste alto. Corpo deve ser legível a 360 px de largura; reserve espaço para o texto antes de compor a imagem. Repita a identidade entre slides, não o conteúdo. Inclua cada trecho de texto solicitado uma vez no slide indicado. Não invente alegações, contatos ou credenciais. Inclua no rodapé de CADA slide: "Estudo visual · profissional fictício". Inspecione todos os pixels finais e corrija omissões concretas, no máximo duas vezes.`;

export const professionalBrands: EvalBrand[] = [
  {
    id: "iris-estudo",
    name: "Íris Oftalmologia",
    handle: "@iris.exemplo",
    notes:
      "Marca inteiramente fictícia para estudo visual. Dra. Helena Prado é personagem inventada, não uma médica real.",
    kit: {
      colors: [
        { hex: "#0A3042", name: "Petróleo" },
        { hex: "#5DBBDD", name: "Azul claro" },
        { hex: "#F1F6FA", name: "Gelo" },
      ],
      fonts: [
        { family: "Source Serif 4", role: "títulos" },
        { family: "Inter", role: "corpo" },
      ],
      tagline: "Informação para cuidar da visão.",
    },
    preferences:
      "Editorial médico sóbrio, preciso e humano. Nunca inventar CRM/RQE, diagnósticos ou promessas de cura.",
    facts: [
      "Exemplo fictício, não publicar como publicidade médica real.",
      "Conteúdo educativo sobre retinose baseado em MedlinePlus: https://medlineplus.gov/genetics/condition/retinitis-pigmentosa/. A evolução varia entre pessoas.",
    ],
  },
  {
    id: "linha-engenharia",
    name: "Linha Engenharia",
    handle: "@linha.exemplo",
    notes:
      "Escritório e profissional fictícios: Eng. Rafael Nunes. Conteúdo educativo, não diagnóstico de uma edificação.",
    kit: {
      colors: [
        { hex: "#172F36", name: "Grafite" },
        { hex: "#D5A55C", name: "Latão" },
        { hex: "#F5F2EB", name: "Papel" },
      ],
      fonts: [
        { family: "Source Serif 4", role: "títulos" },
        { family: "Inter", role: "corpo" },
      ],
      tagline: "Antes da solução, avaliação.",
    },
    preferences:
      "Precisão técnica sem alarmismo. Não classificar segurança estrutural por foto, largura isolada de fissura ou desenho. Não inventar CREA.",
    facts: [
      "Profissional fictício para benchmark.",
      "Não prometer laudo, preço, prazo ou segurança sem avaliação técnica.",
    ],
  },
  {
    id: "clara-odontologia",
    name: "Clara Odontologia",
    handle: "@clara.exemplo",
    notes: "Marca e dentista inteiramente fictícias: Dra. Marina Azevedo.",
    kit: {
      colors: [
        { hex: "#183D40", name: "Verde profundo" },
        { hex: "#91BAB2", name: "Sálvia" },
        { hex: "#F5F4EF", name: "Marfim" },
      ],
      fonts: [
        { family: "Source Serif 4", role: "títulos" },
        { family: "Inter", role: "corpo" },
      ],
      tagline: "Cuidado começa com informação.",
    },
    preferences:
      "Design clínico acolhedor, sem imagens gráficas de sangue, antes/depois, promessas ou CRO inventado.",
    facts: [
      "Profissional fictícia para benchmark.",
      "Fonte educativa: https://www.nidcr.nih.gov/health-info/gum-disease. Placa pode provocar inflamação; sangramento merece avaliação profissional.",
    ],
  },
];

export const professionalCases: (EvalCase & { slides: number })[] = [
  {
    id: "pro-oftalmologista",
    brandId: "iris-estudo",
    kind: "creative",
    slides: 2,
    prompt: `${direction}
Retrato: mulher brasileira fictícia de cerca de 45 anos, cabelo castanho curto, jaleco branco, consultório discreto, sem imitar o homem da referência.
SLIDE 1, textos exatos: "Íris Oftalmologia"; "RETINOSE PIGMENTAR"; "A noite fica difícil. O campo pode se fechar."; "A retinose pigmentar afeta as células da retina que captam a luz. A dificuldade para enxergar no escuro pode aparecer antes da perda de visão lateral. A evolução varia de pessoa para pessoa."; "Dra. Helena Prado"; "Oftalmologia"; "Converse com seu oftalmologista".
SLIDE 2, textos exatos: "Íris Oftalmologia"; "Como o campo visual pode mudar". Diagrama 2×2 de campos visuais: abertura clara larga, abertura intermediária, abertura estreita e um quadro separado com ícone de acompanhamento (NÃO uma sequência inevitável de cegueira). Rótulos e legendas: "Campo amplo" / "Visão lateral preservada"; "Perda periférica" / "Partes das bordas deixam de ser vistas"; "Visão em túnel" / "O campo visível pode ficar mais estreito"; "Evolução individual" / "O padrão e a velocidade variam". Abaixo: "Não é desatenção. Pode ser perda de campo visual."; "A avaliação pode incluir exame de fundo de olho, campo visual e eletrorretinograma. O acompanhamento ajuda a orientar cuidados, reabilitação visual e investigação genética quando indicada."; "Esquema ilustrativo. Não substitui avaliação individual."; "Dra. Helena Prado · Oftalmologia". Não acrescente promessa de cura ou prazo de progressão.`,
    expectations: [
      "Retrato novo, marca correta, dois slides, todo texto legível, três aberturas progressivamente menores e quarto quadro de acompanhamento, sem cópia de identidade",
    ],
  },
  {
    id: "pro-engenheiro",
    brandId: "linha-engenharia",
    kind: "creative",
    slides: 2,
    prompt: `${direction}
Retrato: homem negro brasileiro fictício de cerca de 40 anos, camisa de trabalho clara, capacete branco na mão, escritório com plantas técnicas discretas, sem copiar o médico da referência.
SLIDE 1, textos exatos: "Linha Engenharia"; "FISSURAS EM PAREDES"; "Antes de pintar, entenda o sinal."; "Uma fissura não revela sua causa sozinha. Localização, evolução e sinais associados precisam ser avaliados em conjunto. Cobrir a marca pode esconder uma informação importante."; "Eng. Rafael Nunes"; "Engenharia civil"; "Procure avaliação técnica".
SLIDE 2, textos exatos: "Linha Engenharia"; "Quatro informações para a avaliação". Diagrama 2×2 com quatro desenhos diferentes: parede e fissura perto de janela; mesma fissura com calendário; parede com mancha de umidade; porta desalinhada. Rótulos e legendas: "Onde aparece" / "Parede, encontro ou abertura"; "Como evolui" / "Registre mudanças ao longo do tempo"; "O que acompanha" / "Observe umidade e deformações"; "Como afeta o uso" / "Anote portas e janelas que travam". Abaixo: "A aparência não basta para concluir."; "Uma avaliação técnica considera a edificação, seu histórico e as condições do local. Não é possível definir causa ou segurança apenas por uma foto ou pela largura da fissura."; "Esquema ilustrativo. Não é um laudo."; "Eng. Rafael Nunes · Engenharia civil". Sem faixas em milímetros, sem afirmar que uma fissura é segura.`,
    expectations: [
      "Dois slides, quatro diagramas pertinentes e distintos, marca coerente, sem diagnóstico estrutural ou registro inventado",
    ],
  },
  {
    id: "pro-dentista",
    brandId: "clara-odontologia",
    kind: "creative",
    slides: 2,
    prompt: `${direction}
Retrato: mulher brasileira fictícia de cerca de 35 anos, cabelo preto cacheado preso, jaleco claro, consultório odontológico sofisticado mas humano, sem copiar a pessoa da referência.
SLIDE 1, textos exatos: "Clara Odontologia"; "SAÚDE DA GENGIVA"; "Sangrar ao escovar merece atenção."; "O acúmulo de placa pode provocar inflamação na gengiva. Vermelhidão, inchaço e sangramento são sinais que merecem avaliação. Só o exame profissional pode orientar o diagnóstico e o cuidado adequado."; "Dra. Marina Azevedo"; "Cirurgiã-dentista"; "Agende uma avaliação".
SLIDE 2, textos exatos: "Clara Odontologia"; "Observe os sinais. Cuide da rotina.". Diagrama 2×2 com ilustrações clínicas simples de gengiva inflamada junto a dente, escova macia, fio dental entre dentes e espelho odontológico. Sem sangue gráfico, sem anatomia impossível. Rótulos e legendas: "Sinais" / "Vermelhidão, inchaço ou sangramento"; "Escovação" / "Higienize com cuidado e regularidade"; "Entre os dentes" / "A limpeza também precisa chegar ali"; "Avaliação" / "O dentista orienta o cuidado adequado". Abaixo: "O cuidado começa antes da dor."; "A higiene diária ajuda a controlar a placa, mas não substitui a avaliação profissional. Se o sangramento se repete, procure seu dentista. Não interrompa os cuidados por conta própria."; "Ilustração educativa. Não substitui consulta."; "Dra. Marina Azevedo · Cirurgiã-dentista". Sem prometer reversão, cura, clareamento ou tratamento específico.`,
    expectations: [
      "Dois slides, quatro ilustrações corretas e legíveis, acentos e nome exatos, sem sangue gráfico ou promessa clínica",
    ],
  },
];
