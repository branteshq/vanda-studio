---
name: post-ad-quadro-branco
description: "Formato de anúncio quadro branco — explicar uma regra, valor ou condição à mão num quadro, com desenho, seta e foto presa com fita."
allowed-tools: paint create_post
---

# Formato de anúncio: quadro branco

- Objetivo: explicar uma regra, valor ou condição do negócio como anotação à mão num quadro branco.
- Herói: o que o dono oferece, na foto instantânea presa ao quadro: produto, prato, ferramenta, objeto-símbolo do serviço (cartão, chave, documento) ou o resultado. Com foto do dono, passe-a em referenceImageIds e gere uma imagem nova (editOfImageId só corrige a peça gerada). Pessoa real só com foto dela. Sem foto, descreva só o confirmado.
- Adaptação (o mundo do herói): comida e bebida, um ingrediente e um copo; oficina, uma peça e uma engrenagem; saúde e estética, um dente e uma escova, sem paciente; finanças, um cofre e uma seta, cartão sem número; educação, um livro e um lápis; loja de roupa, um cabide e uma etiqueta; tecnologia, um cadeado e uma seta, aparelho sem tela.
- Composição: quadro branco ocupando a peça, fundo opaco. De cima para baixo: (1) nota principal em marcador preto, a maior letra, 60% da largura; (2) desenho simples de até dois elementos do mundo do herói e uma seta curta de causa para resultado; (3) foto instantânea de [HERO] presa com fita no canto inferior direito, 25% da largura, sem rostos. Sem raios, selos ou faixas.
- Texto: nota de até 6 palavras (ou o valor, se for número); apoio de até 8 palavras, menor que a nota; assinatura pequena com o nome da marca, embaixo. Três blocos no máximo; cada número aparece uma vez.
- Prompt-base: comece o prompt do paint por este texto, em inglês, preenchendo os campos entre colchetes com os fatos do pedido e do arquivo da marca (sem deixar colchetes): "Photoreal photo of an opaque white dry-erase board filling the [ASPECT_RATIO] frame, slightly imperfect, soft natural daylight, straight-on camera. Black marker handwriting that looks real: the main note [HEADLINE] in the largest letters, about 60% of the board width. Below it, one simple marker drawing of [TWO ELEMENTS FROM THE HERO'S WORLD] and one short curved arrow from cause to result. An instant photo of [HERO], no faces, taped in the lower right corner at 25% of the width with a small [BRAND COLOR] strip of tape. Plain board: no rays, badges, underlines, highlighter bands or app icons. Render exactly this text, nothing else: [HEADLINE], [SUPPORT_LINE], [BRAND_SIGNATURE]."
- Revisão: Reprove e corrija com editOfImageId se: nota acima de 6 palavras, apoio acima de 8 ou mais de três blocos; número ou preço repetido; letra sem cara de marcador; assinatura ilegível a 360 px; raios, sublinhados ou selos; desenho com cara de tela ou botão de app; seta que não liga causa e resultado; foto chapada, sem o herói, com rosto ou logotipo; o herói ou os elementos não combinam com o negócio; erro de grafia ou valor.
- Evite: quadro lotado, escrita ilegível, texto fora da copy aprovada (horário, endereço, prazo, "grátis"), ícones de app ou sistema, marcas de terceiros; inventar regras, valores, prazos, avaliações ou alegações.
- Fatos necessários: regra, valor ou condição confirmados pela marca; o herói real; horário, endereço e prazo só se confirmados.
- Propósito comum: educacional ou produto.
