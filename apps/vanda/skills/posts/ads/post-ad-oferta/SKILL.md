---
name: post-ad-oferta
description: "Formato de anúncio oferta — preço ou percentual em destaque, item ou serviço ao lado e chamada curta. Para combo, preço especial ou dias da semana."
allowed-tools: paint create_post
---

# Formato de anúncio: oferta

- Objetivo: a primeira leitura é a vantagem aprovada; o herói mostra do que se trata.
- Herói: o que representa a oferta neste post, escolhido pelo pedido e pelo arquivo da marca: produto, prato, pessoa, lugar ou um objeto-símbolo do serviço (cartão, chave, ferramenta, documento). Com foto do dono, passe-a em referenceImageIds e gere uma imagem nova (editOfImageId só corrige a peça gerada). Pessoa real só com foto dela. Sem foto, descreva só o que o dono confirmou.
- Adaptação (o herói muda, o texto não): comida, o prato ou o combo; beleza e moda, a peça ou o kit; reparos, a ferramenta ou a peça; educação, o material do curso; finanças, um cartão ou cofrinho na cor da marca, sem cédulas; tecnologia, um aparelho de tela apagada.
- Composição: [HERO] inteiro à esquerda, cerca de 45% da largura, com margem de 7%. À direita: título pequeno no topo, oferta grande no centro, condição abaixo, CTA em pílula na cor de destaque. Assinatura pequena embaixo. Combo: todos os componentes inteiros. Serviço sem objeto: um símbolo do serviço. Com foto, mantenha nome, cor e material. Sem moldura ou tarja.
- Texto: três blocos, além de título opcional e assinatura: (1) oferta, exata como aprovada, de 1 a 3 palavras, o maior texto; (2) condição, até 6 palavras, com altura de pelo menos um quarto da oferta; (3) CTA, até 4 palavras com verbo. Título menor que a oferta.
- Prompt-base: comece o prompt do paint por este texto, em inglês, preenchendo os campos entre colchetes com os fatos do pedido e do arquivo da marca (sem deixar colchetes): "[ASPECT_RATIO] feed promotional key visual for [BRAND]. Left side: the complete [HERO] in sharp focus, about 45% of the frame width, faithful to the reference photo when given, soft natural daylight, gentle shadows, true colors and realistic materials. Right side: a small [TITLE] line at the top, the offer [OFFER] set very large and bold as the dominant element, the condition [CONDITION] in a smaller readable line beneath it, and a [CTA] button as a solid [BRAND COLOR] pill. Small [SIGNATURE] in a bottom corner. Warm clean background, generous margins, no frames, no badges, no extra copies of the hero. Render exactly this text, nothing else."
- Revisão: Reprove e corrija com editOfImageId se: a oferta não é o maior texto; título ou CTA competem com ela; a condição é menor que um quarto da oferta ou está longe dela; há texto além dos blocos pedidos; texto falta, repete ou tem grafia errada; valores diferem do aprovado; o herói está cortado, distorcido, incompleto ou com nome ou cor trocados; o herói ou os elementos não combinam com o negócio; algo toca a borda; a assinatura é ilegível; uma tarja cobre o herói.
- Evite: letras miúdas, valores conflitantes, preço, avaliações, depoimentos, estoque ou saúde inventados, contagem regressiva, falsa escassez, interface de app, marcas de terceiros e pessoas reais sem foto própria.
- Fatos necessários: preço ou percentual, validade, condição e nome do herói (item ou serviço) confirmados. Se faltar algum, pergunte antes.
- Propósito comum: promocional.
